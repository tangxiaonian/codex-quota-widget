use crate::{
    model::{normalize, now, Snapshot},
    rpc::Transport,
};
use serde_json::{json, Value};

/// Read the account and usage through one connection so the snapshot has a clear identity.
pub fn read_snapshot(rpc: &mut impl Transport) -> Result<Snapshot, String> {
    let account = rpc.call("account/read", json!({"refreshToken":false}))?;
    if account["account"].is_null() {
        return Err("尚未登录 Codex，请先在 Codex 中登录".into());
    }
    let usage = rpc.call("account/rateLimits/read", json!({}))?;
    let after = rpc.call("account/read", json!({"refreshToken":false}))?;
    if account["account"] != after["account"] {
        return Err("账号已改变，请重新刷新".into());
    }
    normalize(&after, &usage, now())
}
/// Called only from the explicit confirmation command; never from refresh or lifecycle code.
pub fn consume(
    rpc: &mut impl Transport,
    account_key: &str,
    credit_id: &str,
    attempt_id: &str,
) -> Result<String, String> {
    if credit_id.trim().is_empty() || uuid::Uuid::parse_str(attempt_id).is_err() {
        return Err("卡片或操作标识无效".into());
    }
    let snapshot = read_snapshot(rpc)?;
    if snapshot.account.key != account_key {
        return Err("当前账号已改变，请关闭确认框并重新选择卡片".into());
    }
    let card = snapshot
        .credits
        .iter()
        .find(|c| c.id == credit_id)
        .ok_or("这张卡片已不可用，请刷新列表")?;
    if !card.available(now()) {
        return Err("这张卡片已过期或不可使用".into());
    }
    let response = rpc
        .call(
            "account/rateLimitResetCredit/consume",
            json!({"creditId":credit_id,"idempotencyKey":attempt_id}),
        )
        .map_err(|_| "消费请求结果待确认，请刷新卡片状态；不要立即重复使用".to_string())?;
    match response.get("outcome").and_then(Value::as_str) {
        Some(outcome @ ("reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit")) => {
            Ok(outcome.into())
        }
        _ => Err("消费请求结果待确认，请刷新卡片状态".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Fake {
        calls: Vec<(String, Value)>,
        fail: bool,
    }
    impl Transport for Fake {
        fn call(&mut self, m: &str, p: Value) -> Result<Value, String> {
            self.calls.push((m.into(), p));
            match m {
                "account/read" => {
                    Ok(json!({"account":{"type":"chatgpt","email":"demo@example.com"}}))
                }
                "account/rateLimits/read" => Ok(
                    json!({"accountId":"account-A","rateLimits":{},"rateLimitResetCredits":{"availableCount":2,"credits":[{"id":"earlier-A","status":"available","expiresAt":4102444700i64},{"id":"selected-B","status":"available","expiresAt":4102444800i64}]}}),
                ),
                "account/rateLimitResetCredit/consume" if self.fail => Err("timeout".into()),
                "account/rateLimitResetCredit/consume" => Ok(json!({"outcome":"reset"})),
                _ => panic!("unexpected method"),
            }
        }
    }
    #[test]
    fn selects_exact_card_and_never_auto_retries() {
        let mut f = Fake {
            calls: vec![],
            fail: true,
        };
        let s = read_snapshot(&mut f).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(consume(&mut f, &s.account.key, "selected-B", &id).is_err());
        let requests: Vec<_> = f
            .calls
            .iter()
            .filter(|(m, _)| m.ends_with("/consume"))
            .collect();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].1["creditId"], "selected-B");
        assert_eq!(requests[0].1["idempotencyKey"], id);
    }
    #[test]
    fn changed_account_never_consumes() {
        let mut f = Fake {
            calls: vec![],
            fail: false,
        };
        assert!(consume(
            &mut f,
            "different-account",
            "selected-B",
            &uuid::Uuid::new_v4().to_string()
        )
        .is_err());
        assert!(!f.calls.iter().any(|(m, _)| m.ends_with("/consume")));
    }
    #[test]
    fn read_only_flow_cannot_consume() {
        let mut f = Fake {
            calls: vec![],
            fail: false,
        };
        read_snapshot(&mut f).unwrap();
        assert!(f
            .calls
            .iter()
            .all(|(m, _)| ["account/read", "account/rateLimits/read"].contains(&m.as_str())));
    }
}
