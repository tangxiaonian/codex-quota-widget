use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub key: String,
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub workspace_name: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub minutes: i64,
    pub used_percent: Option<f64>,
    pub resets_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credit {
    pub id: String,
    pub status: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub reset_type: Option<String>,
    pub expires_at: Option<i64>,
    pub granted_at: Option<i64>,
}
impl Credit {
    /// Only an explicitly available, unexpired credit can be selected for redemption.
    pub fn available(&self, now: i64) -> bool {
        !self.id.is_empty()
            && self.status == "available"
            && self.expires_at.map_or(true, |t| t > now)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub account: Account,
    pub windows: Vec<QuotaWindow>,
    pub available_count: Option<i64>,
    pub detail_state: String,
    pub credits: Vec<Credit>,
    pub fetched_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default = "default_true")]
    pub codex_enabled: bool,
    #[serde(default = "default_true")]
    pub workbuddy_enabled: bool,
    #[serde(default)]
    pub antigravity_enabled: bool,
    #[serde(default = "default_source")]
    pub selected_source: String,
    #[serde(default = "default_compact_view")]
    pub compact_view: String,
    /// Logical points; absent in older saved preferences.
    #[serde(default)]
    pub expanded_size: Option<WindowSize>,
    #[serde(default)]
    pub show_subscription: bool,
    pub compact: bool,
    pub auto_refresh: bool,
    pub refresh_minutes: u32,
    pub always_on_top: bool,
    pub follow_codex: bool,
    /// Older stored payloads lack this field; it defaults to visible on read.
    #[serde(default = "default_true")]
    pub show_tray_icon: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_tray_title_mode")]
    pub tray_title_mode: String,
    #[serde(default)]
    pub hide_from_capture: bool,
    #[serde(default = "default_desktop_mode")]
    pub desktop_mode: String,
    #[serde(default = "default_rail_edge")]
    pub rail_edge: String,
    #[serde(default)]
    pub rail_auto_collapse: bool,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default = "default_usd_to_cny")]
    pub usd_to_cny: f64,
    pub x: Option<i32>,
    pub y: Option<i32>,
}
fn default_source() -> String {
    "codex".into()
}
fn default_compact_view() -> String {
    "all".into()
}
fn default_true() -> bool {
    true
}
fn default_theme() -> String {
    "system".into()
}
fn default_tray_title_mode() -> String {
    "none".into()
}
fn default_desktop_mode() -> String {
    "rail".into()
}
fn default_rail_edge() -> String {
    "right".into()
}
fn default_currency() -> String {
    "CNY".into()
}
fn default_usd_to_cny() -> f64 {
    7.2
}
impl Default for Preferences {
    /// New installs begin in the unobtrusive side-rail layout with tray reading enabled.
    fn default() -> Self {
        Self {
            codex_enabled: true,
            workbuddy_enabled: true,
            antigravity_enabled: false,
            selected_source: default_source(),
            compact_view: default_compact_view(),
            expanded_size: None,
            show_subscription: false,
            compact: true,
            auto_refresh: true,
            refresh_minutes: 5,
            always_on_top: false,
            follow_codex: true,
            show_tray_icon: true,
            theme: default_theme(),
            tray_title_mode: default_tray_title_mode(),
            hide_from_capture: false,
            desktop_mode: default_desktop_mode(),
            rail_edge: default_rail_edge(),
            rail_auto_collapse: false,
            currency: default_currency(),
            usd_to_cny: default_usd_to_cny(),
            x: None,
            y: None,
        }
    }
}
impl Preferences {
    /// Reject invalid intervals rather than silently persisting an unusable timer.
    pub fn validate(&self) -> Result<(), String> {
        if !self.codex_enabled && !self.workbuddy_enabled && !self.antigravity_enabled {
            return Err("请至少启用一个额度来源".into());
        }
        let selected_enabled = match self.selected_source.as_str() {
            "codex" => self.codex_enabled,
            "workbuddy" => self.workbuddy_enabled,
            "antigravity" => self.antigravity_enabled,
            _ => false,
        };
        if !selected_enabled || !["all", "current"].contains(&self.compact_view.as_str()) {
            return Err("额度视图设置无效".into());
        }
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            return Err("主题设置无效".into());
        }
        if !["none", "tightest", "all"].contains(&self.tray_title_mode.as_str()) {
            return Err("菜单栏读数模式无效".into());
        }
        if !["rail", "mini", "hidden"].contains(&self.desktop_mode.as_str()) {
            return Err("桌面显示形态无效".into());
        }
        if !["left", "right"].contains(&self.rail_edge.as_str()) {
            return Err("贴边方向设置无效".into());
        }
        if !["CNY", "USD"].contains(&self.currency.as_str()) {
            return Err("币种设置无效".into());
        }
        if !self.usd_to_cny.is_finite() || self.usd_to_cny <= 0.0 || self.usd_to_cny > 100.0 {
            return Err("汇率须为正数且不超过 100".into());
        }
        if let Some(size) = &self.expanded_size {
            if !size.width.is_finite()
                || !size.height.is_finite()
                || size.width < 330.0
                || size.height < 260.0
            {
                return Err("展开卡片尺寸不能小于 330×260".into());
            }
        }
        if (1..=60).contains(&self.refresh_minutes) {
            Ok(())
        } else {
            Err("刷新间隔须为 1–60 分钟".into())
        }
    }
}
/// Use Unix seconds at storage and transport boundaries.
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
/// Stable identity shared by the RPC snapshot and local subscription lookup.
pub fn account_key(id: &str, email: &str) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{}\0{}", id, email).as_bytes())
    )
}
/// Extract non-secret view data; unknown fields and missing windows remain unknown.
pub fn normalize(account: &Value, usage: &Value, now: i64) -> Result<Snapshot, String> {
    let a = &account["account"];
    if a.is_null() {
        return Err("尚未登录 Codex，请先在 Codex 中登录".into());
    }
    if a["type"].as_str() != Some("chatgpt") {
        return Err("当前认证方式不提供 ChatGPT 订阅额度".into());
    }
    let id = usage["accountId"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("当前 Codex 未返回账户标识，请升级后重试")?;
    let email = string(a, "email");
    // The backend account ID scopes the workspace; email adds the user within that workspace.
    let key = account_key(id, email.as_deref().unwrap_or(""));
    let bucket = usage
        .get("rateLimitsByLimitId")
        .and_then(|v| v.get("codex"))
        .unwrap_or(&usage["rateLimits"]);
    if bucket["limitId"].as_str().is_some_and(|s| s != "codex") {
        return Err("服务端未提供 Codex 主额度桶".into());
    }
    let windows = ["primary", "secondary"]
        .iter()
        .filter_map(|role| {
            let v = &bucket[*role];
            let minutes = v["windowDurationMins"].as_i64()?;
            if ![300, 10080].contains(&minutes) {
                return None;
            }
            Some(QuotaWindow {
                minutes,
                used_percent: v["usedPercent"]
                    .as_f64()
                    .filter(|n| n.is_finite() && (0.0..=100.0).contains(n)),
                resets_at: v["resetsAt"].as_i64(),
            })
        })
        .collect();
    let summary = &usage["rateLimitResetCredits"];
    let available_count = summary["availableCount"].as_i64().filter(|n| *n >= 0);
    let rows = summary["credits"].as_array();
    let mut credits: Vec<Credit> = rows
        .into_iter()
        .flatten()
        .filter_map(|v| {
            Some(Credit {
                id: v["id"].as_str().filter(|s| !s.is_empty())?.into(),
                status: v["status"].as_str().unwrap_or("unknown").into(),
                title: string(v, "title"),
                description: string(v, "description"),
                reset_type: string(v, "resetType"),
                expires_at: v["expiresAt"].as_i64(),
                granted_at: v["grantedAt"].as_i64(),
            })
        })
        .collect();
    credits.sort_by_key(|c| (c.expires_at.unwrap_or(i64::MAX), c.id.clone()));
    let detail_state = if rows.is_none() {
        "unknown"
    } else if available_count.unwrap_or(0)
        > credits.iter().filter(|c| c.available(now)).count() as i64
    {
        "partial"
    } else if credits.is_empty() {
        "empty"
    } else {
        "present"
    };
    Ok(Snapshot {
        account: Account {
            key,
            email,
            plan_type: string(a, "planType"),
            workspace_name: string(a, "workspaceName"),
        },
        windows,
        available_count,
        detail_state: detail_state.into(),
        credits,
        fetched_at: now,
    })
}
/// Keep optional backend display fields optional instead of inventing values.
fn string(v: &Value, key: &str) -> Option<String> {
    v[key].as_str().map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn maps_by_duration_and_does_not_invent_missing_values() {
        let s=normalize(&json!({"account":{"type":"chatgpt","email":"demo@example.com"}}), &json!({"accountId":"workspace-1","rateLimits":{"primary":{"windowDurationMins":10080,"usedPercent":40},"secondary":{"windowDurationMins":300,"usedPercent":120}}}), 10).unwrap();
        assert_eq!(s.windows[0].minutes, 10080);
        assert_eq!(s.windows[1].used_percent, None);
        assert_eq!(s.detail_state, "unknown");
        assert_eq!(s.available_count, None);
    }
    #[test]
    fn summary_count_survives_partial_details() {
        let s=normalize(&json!({"account":{"type":"chatgpt"}}),&json!({"accountId":"a","rateLimits":{},"rateLimitResetCredits":{"availableCount":2,"credits":[]}}),10).unwrap();
        assert_eq!(s.available_count, Some(2));
        assert_eq!(s.detail_state, "partial");
    }
    #[test]
    fn identity_is_not_email_only() {
        let a = json!({"account":{"type":"chatgpt","email":"same@example.com"}});
        let one = normalize(&a, &json!({"accountId":"one","rateLimits":{}}), 0).unwrap();
        let two = normalize(&a, &json!({"accountId":"two","rateLimits":{}}), 0).unwrap();
        assert_ne!(one.account.key, two.account.key);
    }
    #[test]
    fn legacy_preferences_default_to_visible_tray() {
        let p: Preferences = serde_json::from_str(
            r#"{"compact":true,"autoRefresh":true,"refreshMinutes":5,"alwaysOnTop":false,"followCodex":true}"#,
        )
        .unwrap();
        assert!(p.show_tray_icon);
        assert!(!p.antigravity_enabled);
        assert!(p.expanded_size.is_none());
    }
}
