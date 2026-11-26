use chrono::DateTime;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use crate::storage::UsageRollupRow;

/// Discover WorkBuddy local transcript files (`.jsonl`), falling back to `workbuddy.db`
/// only when no JSONL transcripts exist so both channels are never double-counted.
pub fn discover_files() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    let roots = [home.join(".workbuddy"), home.join(".workbuddy-ai")];
    let mut jsonl_files = Vec::new();
    let mut db_files = Vec::new();
    for root in roots {
        if !root.exists() {
            continue;
        }
        collect_workbuddy_files(&root, &mut jsonl_files, &mut db_files);
    }
    if !jsonl_files.is_empty() {
        jsonl_files
    } else {
        db_files
    }
}

fn collect_workbuddy_files(dir: &Path, jsonl: &mut Vec<PathBuf>, dbs: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if name == "binaries" || name == "node_modules" {
            continue;
        }
        if path.is_dir() {
            collect_workbuddy_files(&path, jsonl, dbs);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            jsonl.push(path);
        } else if path.file_name().and_then(|n| n.to_str()) == Some("workbuddy.db") {
            dbs.push(path);
        }
    }
}

/// Dispatch WorkBuddy file parsing based on extension.
pub fn parse_file(path: &Path) -> Vec<UsageRollupRow> {
    if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
        parse_jsonl(path)
    } else {
        parse_sqlite(path)
    }
}

#[derive(Clone)]
struct MsgRecord {
    day: String,
    model: String,
    input: i64,
    cache_read: i64,
    cache_write: i64,
    output: i64,
    unclassified: i64,
}

impl MsgRecord {
    fn total(&self) -> i64 {
        self.input + self.cache_read + self.cache_write + self.output + self.unclassified
    }
}

/// Parse WorkBuddy JSONL transcripts, deduplicating mirrored messages by identity.
fn parse_jsonl(path: &Path) -> Vec<UsageRollupRow> {
    let Ok(file) = File::open(path) else {
        return Vec::new();
    };
    let reader = BufReader::new(file);
    let mut by_id: HashMap<String, MsgRecord> = HashMap::new();
    let mut unidentified: Vec<MsgRecord> = Vec::new();

    for line in reader.lines().map_while(Result::ok) {
        let Ok(row) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let rtype = row["type"].as_str().unwrap_or("");
        let role = row["role"].as_str().unwrap_or("");
        if !((rtype == "message" && role == "assistant") || rtype == "function_call") {
            continue;
        }
        if let Some(status) = row["status"].as_str() {
            if status != "completed" {
                continue;
            }
        }
        let Some(day) = parse_day(row.get("timestamp")) else {
            continue;
        };
        let message = &row["message"];
        let provider = &row["providerData"];
        let usage = message
            .get("usage")
            .filter(|u| u.is_object())
            .or_else(|| provider.get("usage").filter(|u| u.is_object()))
            .or_else(|| provider.get("rawUsage").filter(|u| u.is_object()));
        let Some(usage) = usage else {
            continue;
        };

        let raw_input = first_count(usage, &["input_tokens", "inputTokens", "prompt_tokens"]);
        let cache_read = first_count(
            usage,
            &[
                "cache_read_input_tokens",
                "cacheReadInputTokens",
                "cacheTokens",
                "prompt_cache_hit_tokens",
                "cached_tokens",
            ],
        );
        let cache_write = first_count(
            usage,
            &[
                "cache_creation_input_tokens",
                "cacheCreationInputTokens",
                "cachedWriteTokens",
                "prompt_cache_write_tokens",
            ],
        );
        let output = first_count(
            usage,
            &["output_tokens", "outputTokens", "completion_tokens"],
        );
        let exclusive = first_count(usage, &["cachedMissTokens", "cacheMissTokens"]);
        let total_field = first_count(usage, &["total_tokens", "totalTokens"]);

        let fresh_input = if exclusive > 0 {
            exclusive
        } else if raw_input >= cache_read + cache_write {
            raw_input - cache_read - cache_write
        } else {
            raw_input
        };
        let accounted = fresh_input + cache_read + cache_write + output;
        let unclassified = if accounted == 0 && total_field > 0 {
            total_field
        } else {
            0
        };
        if accounted + unclassified <= 0 {
            continue;
        }

        let model = provider["model"]
            .as_str()
            .or_else(|| provider["requestModelId"].as_str())
            .or_else(|| message["model"].as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("workbuddy")
            .to_owned();

        let rec = MsgRecord {
            day,
            model,
            input: fresh_input,
            cache_read,
            cache_write,
            output,
            unclassified,
        };
        let id = provider["messageId"]
            .as_str()
            .or_else(|| provider["traceId"].as_str())
            .or_else(|| row["id"].as_str());
        if let Some(id) = id {
            let key = format!("{}:{id}", row["sessionId"].as_str().unwrap_or(""));
            if by_id
                .get(&key)
                .is_none_or(|existing| rec.total() > existing.total())
            {
                by_id.insert(key, rec);
            }
        } else {
            unidentified.push(rec);
        }
    }

    let mut buckets: HashMap<(String, String), UsageRollupRow> = HashMap::new();
    for rec in by_id.into_values().chain(unidentified) {
        let entry = buckets
            .entry((rec.day.clone(), rec.model.clone()))
            .or_insert_with(|| UsageRollupRow {
                day: rec.day,
                source: "workbuddy".into(),
                model: rec.model,
                input_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                output_tokens: 0,
                unclassified_tokens: 0,
                is_partial: false,
            });
        entry.input_tokens += rec.input;
        entry.cache_read_tokens += rec.cache_read;
        entry.cache_write_tokens += rec.cache_write;
        entry.output_tokens += rec.output;
        entry.unclassified_tokens += rec.unclassified;
    }
    buckets.into_values().collect()
}

/// Fallback: read WorkBuddy's aggregate SQLite database strictly as unclassified totals.
fn parse_sqlite(path: &Path) -> Vec<UsageRollupRow> {
    let Ok(conn) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };
    let mut models: HashMap<String, String> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT id, model FROM sessions") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            ))
        }) {
            for (id, model) in rows.flatten() {
                if !model.trim().is_empty() {
                    models.insert(id, model.trim().to_owned());
                }
            }
        }
    }
    let mut buckets: HashMap<(String, String), UsageRollupRow> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT session_id, used, updated_at FROM session_usage") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        }) {
            for (sid, used, updated) in rows.flatten() {
                if used <= 0 || updated <= 0 {
                    continue;
                }
                let secs = if updated > 10_000_000_000 {
                    updated / 1000
                } else {
                    updated
                };
                let Some(day) = super::local_day(secs) else {
                    continue;
                };
                let model = models
                    .get(&sid)
                    .cloned()
                    .unwrap_or_else(|| "auto".to_owned());
                let entry = buckets
                    .entry((day.clone(), model.clone()))
                    .or_insert_with(|| UsageRollupRow {
                        day,
                        source: "workbuddy".into(),
                        model,
                        input_tokens: 0,
                        cache_read_tokens: 0,
                        cache_write_tokens: 0,
                        output_tokens: 0,
                        unclassified_tokens: 0,
                        is_partial: true,
                    });
                entry.unclassified_tokens += used;
            }
        }
    }
    buckets.into_values().collect()
}

fn first_count(obj: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|k| obj.get(*k).and_then(Value::as_i64))
        .unwrap_or(0)
        .max(0)
}

fn parse_day(ts: Option<&Value>) -> Option<String> {
    if let Some(n) = ts.and_then(Value::as_i64) {
        let secs = if n > 10_000_000_000 { n / 1000 } else { n };
        return super::local_day(secs);
    }
    ts.and_then(Value::as_str)
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .and_then(|dt| super::local_day(dt.timestamp()))
}
