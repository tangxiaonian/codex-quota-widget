mod cli;
mod native;
mod server;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub groups: Vec<Group>,
    pub fetched_at: i64,
    pub plan: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Group {
    pub name: String,
    pub windows: Vec<Window>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub remaining: Option<f64>,
    pub resets_at: Option<i64>,
}

/// Prefer the running desktop language server and fall back to the official `agy` CLI.
/// Neither route reads or transmits Google OAuth credentials.
pub fn refresh() -> Result<Snapshot, String> {
    let server_outcome = server::fetch();
    match server_outcome {
        server::ServerOutcome::Snapshot(snapshot) => return Ok(snapshot),
        server::ServerOutcome::NoLimits
        | server::ServerOutcome::NotAnswering
        | server::ServerOutcome::NotRunning => {}
    }

    match cli::fetch() {
        cli::CliOutcome::Snapshot(snapshot) => Ok(snapshot),
        cli::CliOutcome::NoLimits => Err("Antigravity 暂未返回可用额度".to_owned()),
        cli::CliOutcome::NotAvailable | cli::CliOutcome::Failed => match server_outcome {
            server::ServerOutcome::NoLimits => Err("Antigravity 暂未返回可用额度".to_owned()),
            server::ServerOutcome::NotAnswering => {
                Err("Antigravity 桌面端未返回额度，请稍后重试".to_owned())
            }
            server::ServerOutcome::NotRunning => {
                Err("请先打开 Antigravity 桌面端，或安装并登录 agy CLI".to_owned())
            }
            server::ServerOutcome::Snapshot(_) => unreachable!(),
        },
    }
}

/// Normalize quota groups from either the local language server or `agy -p "/usage"`.
pub(super) fn parse_report(
    report: &Value,
    plan: Option<String>,
    source: &str,
) -> Result<Snapshot, String> {
    let payload = report
        .get("response")
        .filter(|v| v.is_object())
        .unwrap_or(report);
    let groups: Vec<_> = payload["groups"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|group| {
            let name = group["displayName"]
                .as_str()
                .or_else(|| group["name"].as_str())?
                .trim()
                .to_owned();
            if name.is_empty() {
                return None;
            }
            let mut windows: Vec<_> = group["buckets"]
                .as_array()?
                .iter()
                .filter_map(parse_window)
                .collect();
            // Show shorter windows (e.g. 5h) before weekly so the tightest cadence leads.
            windows.sort_by_key(|w| window_order(&w.kind));
            (!windows.is_empty()).then_some(Group { name, windows })
        })
        .collect();
    if !groups.iter().any(|group| {
        group
            .windows
            .iter()
            .any(|window| window.remaining.is_some())
    }) {
        return Err("Antigravity 暂未返回可用额度".to_owned());
    }
    Ok(Snapshot {
        groups,
        fetched_at: crate::model::now(),
        plan,
        source: source.to_owned(),
    })
}

fn window_order(kind: &str) -> u8 {
    match kind {
        "session" => 0,
        "daily" => 1,
        "weekly" => 2,
        "monthly" => 3,
        _ => 4,
    }
}

/// Keep missing or out-of-range fractions unknown; zero is a measured exhausted window.
fn parse_window(bucket: &Value) -> Option<Window> {
    if bucket["enabled"].as_bool() == Some(false) {
        return None;
    }
    let id = bucket["bucketId"]
        .as_str()
        .or_else(|| bucket["id"].as_str())?
        .to_owned();
    let identifier = id.to_ascii_lowercase();
    let cadence = bucket["window"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let kind = if cadence.contains("weekly") || identifier.contains("weekly") {
        "weekly".into()
    } else if matches!(cadence.as_str(), "session" | "five_hour" | "5h")
        || identifier.contains("5h")
    {
        "session".into()
    } else if !cadence.is_empty() {
        cadence
    } else {
        "unknown".into()
    };
    let remaining = bucket["remainingFraction"]
        .as_f64()
        .or_else(|| bucket["remaining_fraction"].as_f64())
        .or_else(|| bucket["remaining"]["remainingFraction"].as_f64())
        .filter(|n| n.is_finite() && (0.0..=1.0).contains(n))
        .map(|fraction| fraction * 100.0);
    let resets_at = bucket["resetTime"]
        .as_str()
        .or_else(|| bucket["reset_time"].as_str())
        .or_else(|| bucket["remaining"]["resetTime"].as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|time| time.timestamp());
    let fallback_name = match kind.as_str() {
        "session" => "5 小时",
        "weekly" => "周",
        _ => "额度",
    };
    Some(Window {
        id,
        kind,
        remaining,
        resets_at,
        name: bucket["displayName"]
            .as_str()
            .unwrap_or(fallback_name)
            .to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_local_server_summary_and_orders_windows() {
        let report = json!({
            "response": {
                "groups": [
                    {
                        "displayName": "Gemini Models",
                        "buckets": [
                            {"bucketId": "gemini-weekly", "window": "weekly", "remainingFraction": 0.99, "resetTime": "2026-11-30T08:00:00Z"},
                            {"bucketId": "gemini-5h", "window": "5h", "remainingFraction": 0.0, "resetTime": "2026-11-25T18:00:00Z"}
                        ]
                    },
                    {
                        "displayName": "New model group",
                        "buckets": [
                            {"bucketId": "new-disabled", "enabled": false, "window": "5h", "remainingFraction": 1.0},
                            {"bucketId": "new-invalid", "window": "weekly", "remainingFraction": 1.2},
                            {"bucketId": "new-5h", "window": "5h", "remainingFraction": 0.63, "resetTime": "2026-11-25T18:00:00Z"}
                        ]
                    }
                ]
            }
        });
        let result = parse_report(&report, Some("Pro".to_owned()), "languageServer").unwrap();
        assert_eq!(result.plan.as_deref(), Some("Pro"));
        assert_eq!(result.source, "languageServer");
        assert_eq!(result.groups[0].windows.len(), 2);
        assert_eq!(result.groups[0].windows[0].kind, "session");
        assert_eq!(result.groups[0].windows[0].remaining, Some(0.0));
        assert_eq!(result.groups[0].windows[1].kind, "weekly");
        assert_eq!(result.groups[1].windows[0].kind, "session");
        assert_eq!(result.groups[1].windows[0].remaining, Some(63.0));
        assert_eq!(result.groups[1].windows[1].remaining, None);
        assert!(parse_report(&json!({"response": {"groups": []}}), None, "languageServer").is_err());
    }

    #[test]
    #[ignore = "reads live local Antigravity language server or agy CLI"]
    fn live_local_or_cli_quota() {
        let snapshot = refresh().expect("live Antigravity quota read failed");
        assert!(!snapshot.groups.is_empty());
        println!(
            "antigravity live ok: source={}, plan={:?}, groups={}",
            snapshot.source,
            snapshot.plan,
            snapshot.groups.len()
        );
    }
}
