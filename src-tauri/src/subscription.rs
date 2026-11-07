//! Local display metadata only. Token contents never cross the Rust boundary.
use crate::model::account_key;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::DateTime;
use serde_json::Value;

/// Return only the subscription period end of the currently displayed account.
pub fn active_until(expected_key: &str) -> Option<i64> {
    let auth = crate::credential_store::load()?;
    let tokens = &auth["tokens"];
    ["id_token", "access_token"].iter().find_map(|field| {
        let token = tokens[*field].as_str()?;
        let payload = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
        let claims = serde_json::from_slice(&payload).ok()?;
        date_for_account(&claims, tokens["account_id"].as_str(), expected_key)
    })
}

/// Bind the date to the same workspace and user as the displayed RPC snapshot.
fn date_for_account(claims: &Value, selected_id: Option<&str>, expected_key: &str) -> Option<i64> {
    let auth = &claims["https://api.openai.com/auth"];
    let id = auth["chatgpt_account_id"].as_str()?;
    let email = claims["email"]
        .as_str()
        .or_else(|| claims["https://api.openai.com/profile"]["email"].as_str())?;
    if id.is_empty()
        || email.is_empty()
        || selected_id.is_some_and(|s| s != id)
        || account_key(id, email) != expected_key
    {
        return None;
    }
    let value = &auth["chatgpt_subscription_active_until"];
    let seconds = if let Some(ts) = value
        .as_i64()
        .or_else(|| value.as_str()?.parse::<i64>().ok())
    {
        if ts >= 1_000_000_000_000 {
            ts / 1000
        } else {
            ts
        }
    } else {
        DateTime::parse_from_rfc3339(value.as_str()?)
            .ok()?
            .timestamp()
    };
    (1..=253402300799).contains(&seconds).then_some(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_matched_subscription_claim_is_displayable() {
        let key = account_key("workspace-a", "user@example.test");
        let mut claims = json!({"email":"user@example.test", "exp":1735689600,
          "https://api.openai.com/auth":{"chatgpt_account_id":"workspace-a"}});
        assert_eq!(date_for_account(&claims, None, &key), None);
        for value in [
            json!("2025-01-01T00:00:00Z"),
            json!(1735689600),
            json!("1735689600000"),
        ] {
            claims["https://api.openai.com/auth"]["chatgpt_subscription_active_until"] = value;
            assert_eq!(
                date_for_account(&claims, Some("workspace-a"), &key),
                Some(1735689600)
            );
        }
        assert_eq!(date_for_account(&claims, Some("other"), &key), None);
        assert_eq!(
            date_for_account(
                &claims,
                None,
                &account_key("workspace-a", "other@example.test")
            ),
            None
        );
    }
}

#[cfg(test)]
#[test]
#[ignore = "requires a local Codex subscription; run explicitly on a signed-in test Mac"]
fn live_subscription_matches_current_rpc_account() {
    let mut rpc = crate::rpc::Rpc::connect().expect("start Codex");
    let current = crate::provider::read_snapshot(&mut rpc).expect("read current account");
    assert!(active_until(&current.account.key).is_some(), "no matched local subscription date");
}
