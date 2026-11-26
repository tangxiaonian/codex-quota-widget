use rusqlite::{Connection, OpenFlags};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::storage::UsageRollupRow;

/// Discover Antigravity local conversation databases (desktop, IDE, and CLI).
pub fn discover_files() -> Vec<PathBuf> {
    let root = std::env::var_os("GEMINI_CLI_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".gemini")));
    let Some(root) = root else {
        return Vec::new();
    };
    let mut files = Vec::new();
    for folder in ["antigravity", "antigravity-ide", "antigravity-cli"] {
        super::collect_files_by_ext(&root.join(folder).join("conversations"), "db", &mut files);
    }
    files
}

/// Read one Antigravity conversation SQLite file strictly read-only.
/// Only verified protobuf usage fields (#2 fresh input, #5 cache read, #9 output, #10 reasoning) are counted.
pub fn parse_file(path: &Path) -> Vec<UsageRollupRow> {
    let Ok(conn) = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return Vec::new();
    };

    let anchor_ts = read_anchor_timestamp(&conn);
    let (step_by_resp, step_by_idx) = read_step_timestamps(&conn);
    let gens = read_generations(&conn);
    if gens.is_empty() {
        return Vec::new();
    }

    let mut label_models: HashMap<String, HashSet<String>> = HashMap::new();
    let mut all_models: HashSet<String> = HashSet::new();
    for g in &gens {
        if let Some(model) = g.model.as_deref() {
            if !is_routing_label(model) {
                all_models.insert(model.to_owned());
                if let Some(label) = g.label.as_deref() {
                    label_models
                        .entry(label.to_owned())
                        .or_default()
                        .insert(model.to_owned());
                }
            }
        }
    }
    let sole_model = (all_models.len() == 1)
        .then(|| all_models.iter().next().cloned())
        .flatten();

    let mut seen_resp = HashSet::new();
    let mut buckets: HashMap<(String, String), UsageRollupRow> = HashMap::new();

    for g in gens {
        let Some(ref u) = g.usage else {
            continue;
        };
        if u.fresh + u.cache_read + u.output + u.reasoning <= 0 {
            continue;
        }
        if let Some(resp_id) = u.response_id.as_ref() {
            if !seen_resp.insert(resp_id.clone()) {
                continue;
            }
        }
        let ts = g
            .explicit_ts
            .or_else(|| u.response_id.as_ref().and_then(|r| step_by_resp.get(r).copied()))
            .or_else(|| step_by_idx.get(&g.index).copied())
            .or(anchor_ts);
        let Some(secs) = ts else {
            continue;
        };
        let Some(day) = super::local_day(secs) else {
            continue;
        };
        let model = resolve_model(&g, &label_models, sole_model.as_deref());

        let entry = buckets
            .entry((day.clone(), model.clone()))
            .or_insert_with(|| UsageRollupRow {
                day,
                source: "antigravity".into(),
                model,
                input_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                output_tokens: 0,
                unclassified_tokens: 0,
                // `#1` is excluded as unverified; mark partial honestly.
                is_partial: true,
            });
        entry.input_tokens += u.fresh;
        entry.cache_read_tokens += u.cache_read;
        entry.output_tokens += u.output + u.reasoning;
    }

    buckets.into_values().collect()
}

fn is_routing_label(model: &str) -> bool {
    matches!(model, "gemini-default" | "gemini-pro-default")
}

fn resolve_model(
    g: &Generation,
    labels: &HashMap<String, HashSet<String>>,
    sole: Option<&str>,
) -> String {
    if let Some(m) = g.model.as_deref() {
        if !is_routing_label(m) {
            return m.to_owned();
        }
    }
    if let Some(label) = g.label.as_deref() {
        if let Some(set) = labels.get(label) {
            if set.len() == 1 {
                if let Some(only) = set.iter().next() {
                    return only.clone();
                }
            }
        }
        if let Some(mapped) = match label {
            "Gemini 3.5 Flash (Low)" => Some("gemini-3.5-flash-extra-low"),
            "Gemini 3.5 Flash (Medium)" => Some("gemini-3.5-flash-medium"),
            "Gemini 3.5 Flash (High)" => Some("gemini-3.5-flash-high"),
            "Gemini 3.1 Pro (High)" => Some("gemini-3.1-pro-preview-high"),
            _ => None,
        } {
            return mapped.to_owned();
        }
    }
    if let Some(s) = sole {
        return s.to_owned();
    }
    g.model.clone().unwrap_or_else(|| "unknown".to_owned())
}

struct UsageFields {
    fresh: i64,
    cache_read: i64,
    output: i64,
    reasoning: i64,
    response_id: Option<String>,
}

struct Generation {
    index: i64,
    model: Option<String>,
    label: Option<String>,
    usage: Option<UsageFields>,
    explicit_ts: Option<i64>,
}

fn read_anchor_timestamp(conn: &Connection) -> Option<i64> {
    let mut stmt = conn
        .prepare("SELECT data FROM trajectory_metadata_blob LIMIT 1")
        .ok()?;
    let blob: Vec<u8> = stmt.query_row([], |r| r.get(0)).ok()?;
    let msg = wire_decode(&blob)?;
    proto_timestamp(msg.nested(2).as_ref())
}

fn read_step_timestamps(conn: &Connection) -> (HashMap<String, i64>, HashMap<i64, i64>) {
    let mut by_resp = HashMap::new();
    let mut by_idx = HashMap::new();
    let Ok(mut stmt) = conn.prepare("SELECT metadata FROM steps WHERE step_type = 15") else {
        return (by_resp, by_idx);
    };
    let Ok(rows) = stmt.query_map([], |r| r.get::<_, Vec<u8>>(0)) else {
        return (by_resp, by_idx);
    };
    for blob in rows.flatten() {
        let Some(msg) = wire_decode(&blob) else {
            continue;
        };
        let Some(ts) = proto_timestamp(msg.nested(1).as_ref()) else {
            continue;
        };
        if let Some(resp) = msg.nested(9).and_then(|m| m.string(11)) {
            by_resp.insert(resp, ts);
        }
        if let Some(idx) = msg.nested(20).and_then(|m| m.varint(3)) {
            by_idx.insert(idx as i64, ts);
        }
    }
    (by_resp, by_idx)
}

fn read_generations(conn: &Connection) -> Vec<Generation> {
    let mut out = Vec::new();
    let Ok(mut stmt) = conn.prepare("SELECT idx, data FROM gen_metadata ORDER BY idx") else {
        return out;
    };
    let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Vec<u8>>(1)?)))
    else {
        return out;
    };
    for (index, blob) in rows.flatten() {
        let Some(msg) = wire_decode(&blob) else {
            continue;
        };
        let Some(chat) = msg.nested(1) else {
            continue;
        };
        let model = chat.string(19);
        let label = chat.string(21);
        let explicit_ts = chat
            .nested(9)
            .and_then(|m| m.nested(4))
            .and_then(|m| proto_timestamp(Some(&m)));
        let usage = chat.nested(4).map(|u| UsageFields {
            fresh: u.varint(2).unwrap_or(0).min(i64::MAX as u64) as i64,
            cache_read: u.varint(5).unwrap_or(0).min(i64::MAX as u64) as i64,
            output: u.varint(9).unwrap_or(0).min(i64::MAX as u64) as i64,
            reasoning: u.varint(10).unwrap_or(0).min(i64::MAX as u64) as i64,
            response_id: u.string(11),
        });
        out.push(Generation {
            index,
            model,
            label,
            usage,
            explicit_ts,
        });
    }
    out
}

fn proto_timestamp(msg: Option<&WireMessage>) -> Option<i64> {
    let secs = msg?.varint(1)?;
    (secs > 0 && secs < 1_000_000_000_000).then_some(secs as i64)
}

enum WireValue {
    Varint(u64),
    Bytes(Vec<u8>),
    Fixed,
}

struct WireMessage {
    fields: HashMap<u32, Vec<WireValue>>,
}

impl WireMessage {
    fn varint(&self, num: u32) -> Option<u64> {
        self.fields.get(&num)?.iter().find_map(|v| match v {
            WireValue::Varint(n) => Some(*n),
            _ => None,
        })
    }

    fn string(&self, num: u32) -> Option<String> {
        let bytes = self.fields.get(&num)?.iter().find_map(|v| match v {
            WireValue::Bytes(b) => Some(b),
            _ => None,
        })?;
        let text = std::str::from_utf8(bytes).ok()?.trim();
        (!text.is_empty()).then(|| text.to_owned())
    }

    fn nested(&self, num: u32) -> Option<WireMessage> {
        let bytes = self.fields.get(&num)?.iter().find_map(|v| match v {
            WireValue::Bytes(b) => Some(b),
            _ => None,
        })?;
        wire_decode(bytes)
    }
}

/// Bounds-checked minimal protobuf wire decoder; malformed input aborts cleanly.
fn wire_decode(bytes: &[u8]) -> Option<WireMessage> {
    let mut idx = 0;
    let mut fields: HashMap<u32, Vec<WireValue>> = HashMap::new();
    while idx < bytes.len() {
        let tag = read_varint(bytes, &mut idx)?;
        let num = (tag >> 3) as u32;
        if num == 0 {
            return None;
        }
        let val = match tag & 7 {
            0 => WireValue::Varint(read_varint(bytes, &mut idx)?),
            1 => {
                if bytes.len() - idx < 8 {
                    return None;
                }
                idx += 8;
                WireValue::Fixed
            }
            2 => {
                let len = read_varint(bytes, &mut idx)? as usize;
                if len > bytes.len() - idx {
                    return None;
                }
                let slice = bytes[idx..idx + len].to_vec();
                idx += len;
                WireValue::Bytes(slice)
            }
            5 => {
                if bytes.len() - idx < 4 {
                    return None;
                }
                idx += 4;
                WireValue::Fixed
            }
            _ => return None,
        };
        fields.entry(num).or_default().push(val);
    }
    Some(WireMessage { fields })
}

fn read_varint(bytes: &[u8], idx: &mut usize) -> Option<u64> {
    let mut result = 0u64;
    let mut shift = 0u32;
    for _ in 0..10 {
        let byte = *bytes.get(*idx)?;
        *idx += 1;
        if shift == 63 && byte > 1 {
            return None;
        }
        result |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some(result);
        }
        shift += 7;
    }
    None
}
