use chrono::DateTime;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use crate::storage::UsageRollupRow;

/// Discover Codex session JSONL files under `$CODEX_HOME` or `~/.codex`.
pub fn discover_files() -> Vec<PathBuf> {
    let root = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".codex")));
    let Some(root) = root else {
        return Vec::new();
    };
    let mut files = Vec::new();
    for sub in ["sessions", "archived_sessions"] {
        super::collect_files_by_ext(&root.join(sub), "jsonl", &mut files);
    }
    files
}

/// Parse one Codex session JSONL using cumulative differences so turns are never double-counted.
pub fn parse_file(path: &Path) -> Vec<UsageRollupRow> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    let reader = BufReader::new(file);
    let mut current_model = "unknown".to_owned();
    let mut prev_total: Option<(i64, i64, i64)> = None;
    let mut buckets: HashMap<(String, String), UsageRollupRow> = HashMap::new();

    for line in reader.lines().map_while(Result::ok) {
        if line.is_empty() || !line.contains('{') {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(model) = extract_model(&v) {
            current_model = model;
        }
        let Some((day, fresh_input, cache_read, output)) =
            extract_usage_delta(&v, &mut prev_total)
        else {
            continue;
        };
        if fresh_input + cache_read + output <= 0 {
            continue;
        }
        let entry = buckets
            .entry((day.clone(), current_model.clone()))
            .or_insert_with(|| UsageRollupRow {
                day,
                source: "codex".into(),
                model: current_model.clone(),
                input_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                output_tokens: 0,
                unclassified_tokens: 0,
                is_partial: false,
            });
        entry.input_tokens += fresh_input;
        entry.cache_read_tokens += cache_read;
        entry.output_tokens += output;
    }

    buckets.into_values().collect()
}

fn extract_model(v: &Value) -> Option<String> {
    let candidates = [
        v.pointer("/payload/model"),
        v.pointer("/payload/turn_context/model"),
        v.pointer("/payload/info/model"),
        v.get("model"),
    ];
    candidates
        .into_iter()
        .flatten()
        .find_map(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn extract_usage_delta(
    v: &Value,
    prev_total: &mut Option<(i64, i64, i64)>,
) -> Option<(String, i64, i64, i64)> {
    let payload = v.get("payload")?;
    let event_type = payload.get("type").and_then(Value::as_str).unwrap_or("");
    if event_type != "token_count" {
        return None;
    }
    let info = payload.get("info")?;
    if info.is_null() {
        return None;
    }
    let day = parse_day(v.get("timestamp"))?;

    // Prefer running total diffs over per-turn `last_token_usage` to avoid replay drift.
    if let Some(total) = info.get("total_token_usage").filter(|u| u.is_object()) {
        let (raw_in, cached, out) = read_usage_triple(total);
        let fresh = (raw_in - cached).max(0);
        let (d_fresh, d_cached, d_out) = if let Some((p_in, p_cached, p_out)) = *prev_total {
            if fresh >= p_in && cached >= p_cached && out >= p_out {
                (fresh - p_in, cached - p_cached, out - p_out)
            } else {
                // Counter reset inside the file; treat as fresh baseline.
                (fresh, cached, out)
            }
        } else {
            (fresh, cached, out)
        };
        *prev_total = Some((fresh, cached, out));
        return Some((day, d_fresh, d_cached, d_out));
    }

    let last = info.get("last_token_usage").filter(|u| u.is_object())?;
    let (raw_in, cached, out) = read_usage_triple(last);
    Some((day, (raw_in - cached).max(0), cached, out))
}

fn read_usage_triple(obj: &Value) -> (i64, i64, i64) {
    let input = obj["input_tokens"].as_i64().unwrap_or(0).max(0);
    let cached = obj["cached_input_tokens"].as_i64().unwrap_or(0).max(0);
    let output = obj["output_tokens"].as_i64().unwrap_or(0).max(0);
    (input, cached, output)
}

fn parse_day(ts: Option<&Value>) -> Option<String> {
    if let Some(s) = ts.and_then(Value::as_str) {
        if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
            return super::local_day(dt.timestamp());
        }
    }
    if let Some(n) = ts.and_then(Value::as_i64) {
        let secs = if n > 10_000_000_000 { n / 1000 } else { n };
        return super::local_day(secs);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn codex_diffs_running_totals_and_separates_cached_input() {
        let path = std::env::temp_dir().join(format!("codex-usage-{}.jsonl", uuid::Uuid::new_v4()));
        let mut f = File::create(&path).unwrap();
        writeln!(
            f,
            r#"{{"timestamp":"2026-11-25T10:00:00Z","payload":{{"type":"turn_context","model":"gpt-5.2-codex"}}}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"timestamp":"2026-11-25T10:01:00Z","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":1000,"cached_input_tokens":600,"output_tokens":120}}}}}}}}"#
        )
        .unwrap();
        writeln!(
            f,
            r#"{{"timestamp":"2026-11-25T10:05:00Z","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":2500,"cached_input_tokens":1800,"output_tokens":320}}}}}}}}"#
        )
        .unwrap();
        let rows = parse_file(&path);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(rows.len(), 1);
        // Total fresh input = (1000-600) + ((2500-1800) - 400) = 700, cached = 1800, output = 320.
        assert_eq!(rows[0].input_tokens, 700);
        assert_eq!(rows[0].cache_read_tokens, 1800);
        assert_eq!(rows[0].output_tokens, 320);
        assert_eq!(rows[0].model, "gpt-5.2-codex");
    }
}
