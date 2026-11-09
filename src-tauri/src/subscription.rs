//! Match subscription dates to the active account before returning them to the UI.
mod online;
use crate::{
    model::{account_key, now},
    rpc::{Rpc, Transport},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::DateTime;
use serde_json::Value;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

// Short refresh intervals must not rotate credentials repeatedly for a genuinely ended plan.
struct Attempt {
    key: String,
    at: Instant,
    online_date: Option<i64>,
}
static LAST_REFRESH: Mutex<Option<Attempt>> = Mutex::new(None);
const RETRY_INTERVAL: Duration = Duration::from_secs(15 * 60);

/// Prefer local metadata, and consult ChatGPT for the current period when the previous one ends.
pub fn active_until(expected_key: &str) -> Option<i64> {
    let until = local_until(expected_key)?;
    if until > now() {
        return Some(until);
    }
    {
        let mut last = LAST_REFRESH.lock().ok()?;
        if let Some(attempt) = last
            .as_ref()
            .filter(|a| a.key == expected_key && a.at.elapsed() < RETRY_INTERVAL)
        {
            return attempt.online_date.or(Some(until));
        }
        *last = Some(Attempt {
            key: expected_key.into(),
            at: Instant::now(),
            online_date: None,
        });
    }
    let mut date = online::active_until(expected_key);
    if date.is_none() {
        if let Ok(mut rpc) = Rpc::connect() {
            let _ = rpc.call("account/read", serde_json::json!({"refreshToken": true}));
        }
        let renewed = local_until(expected_key)?;
        date = if renewed > now() {
            Some(renewed)
        } else {
            online::active_until(expected_key)
        };
    }
    if let Some(attempt) = LAST_REFRESH
        .lock()
        .ok()?
        .as_mut()
        .filter(|a| a.key == expected_key)
    {
        attempt.online_date = date;
    }
    date.or_else(|| local_until(expected_key))
}

/// Read just the current account's entitlement date from Codex's selected credential store.
fn local_until(expected_key: &str) -> Option<i64> {
    let auth = crate::credential_store::load()?;
    let tokens = &auth["tokens"];
    let dates = ["id_token", "access_token"].map(|field| {
        let token = tokens[field].as_str()?;
        let claims = token_claims(token)?;
        date_for_account(&claims, tokens["account_id"].as_str(), expected_key)
    });
    dates
        .into_iter()
        .flatten()
        .find(|&date| date > now())
        .or(dates[0])
        .or(dates[1])
}

/// Bind the date to the same workspace and user as the displayed RPC snapshot.
fn date_for_account(claims: &Value, selected_id: Option<&str>, expected_key: &str) -> Option<i64> {
    matched_workspace(claims, selected_id, expected_key)?;
    parse_date(&claims["https://api.openai.com/auth"]["chatgpt_subscription_active_until"])
}

/// Decode local display claims without logging the credential.
fn token_claims(token: &str) -> Option<Value> {
    let payload = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
    serde_json::from_slice(&payload).ok()
}

/// Require the workspace and user in the token to match the RPC snapshot.
fn matched_workspace<'a>(
    claims: &'a Value,
    selected_id: Option<&str>,
    expected_key: &str,
) -> Option<&'a str> {
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
    Some(id)
}

/// Accept ISO timestamps or Unix timestamps in seconds or milliseconds.
fn parse_date(value: &Value) -> Option<i64> {
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
    let date = active_until(&current.account.key).expect("no matched local subscription date");
    assert!(
        date > now(),
        "server has not provided a new subscription date"
    );
    println!(
        "matched_subscription_date={}",
        DateTime::from_timestamp(date, 0)
            .unwrap()
            .format("%F %T UTC")
    );
}
