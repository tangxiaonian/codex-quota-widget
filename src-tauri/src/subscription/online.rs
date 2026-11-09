use super::{matched_workspace, parse_date, token_claims};
use serde_json::Value;
use std::ffi::{c_char, c_void, CStr, CString};

extern "C" {
    fn cq_subscription_json(
        token: *const c_char,
        workspace: *const c_char,
        detail: bool,
    ) -> *mut c_char;
    fn free(ptr: *mut c_void);
}

/// Query ChatGPT with the matched access token. Only an expiry timestamp leaves this module.
pub(super) fn active_until(expected_key: &str) -> Option<i64> {
    let auth = crate::credential_store::load()?;
    let tokens = &auth["tokens"];
    let access = tokens["access_token"].as_str()?;
    let claims = token_claims(access)?;
    let id = matched_workspace(&claims, tokens["account_id"].as_str(), expected_key)?;
    let fetch = |detail| fetch_json(access, id, detail);
    let entitlement = fetch(false).and_then(|body| account_date(&body, id));
    if entitlement.is_some_and(|date| date > crate::model::now()) {
        return entitlement;
    }
    let detail = fetch(true)?;
    if detail["account_id"]
        .as_str()
        .is_some_and(|response_id| response_id != id)
    {
        return None;
    }
    parse_date(&detail["active_until"])
        .or_else(|| parse_date(&detail["expires_at"]))
        .or(entitlement)
}

/// Ignore other workspaces even if they appear first or have a paid subscription.
fn account_date(body: &Value, id: &str) -> Option<i64> {
    let read = |key: Option<&str>, row: &Value| {
        let account = row.get("account").unwrap_or(row);
        let record_id = ["account_id", "id", "chatgpt_account_id", "workspace_id"]
            .iter()
            .find_map(|field| account[*field].as_str())
            .or(key)?;
        if record_id != id {
            return None;
        }
        parse_date(&row["entitlement"]["expires_at"]).or_else(|| parse_date(&account["expires_at"]))
    };
    match body.get("accounts").unwrap_or(body) {
        Value::Object(map) => map.iter().find_map(|(k, v)| read(Some(k), v)),
        Value::Array(rows) => rows.iter().find_map(|v| read(None, v)),
        _ => None,
    }
}

/// Read a short-lived response from the native HTTPS client and release its buffer.
fn fetch_json(access: &str, id: &str, detail: bool) -> Option<Value> {
    let access = CString::new(access).ok()?;
    let id = CString::new(id).ok()?;
    unsafe {
        let ptr = cq_subscription_json(access.as_ptr(), id.as_ptr(), detail);
        if ptr.is_null() {
            return None;
        }
        let result = serde_json::from_slice(CStr::from_ptr(ptr).to_bytes()).ok();
        free(ptr.cast());
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn online_entitlement_belongs_to_requested_workspace() {
        let body = serde_json::json!({"accounts":{"foreign":{"account":{"id":"b"},"entitlement":{"expires_at":2000}},"mine":{"account":{"id":"a"},"entitlement":{"expires_at":1000}}}});
        assert_eq!(account_date(&body, "a"), Some(1000));
        assert_eq!(account_date(&body, "unknown"), None);
    }
}
