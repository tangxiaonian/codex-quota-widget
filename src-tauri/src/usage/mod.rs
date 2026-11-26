mod antigravity;
mod codex;
mod pricing;
mod workbuddy;

use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::storage::{Storage, UsageRollupRow};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPoint {
    pub day: String,
    pub total_tokens: i64,
    pub codex_tokens: i64,
    pub workbuddy_tokens: i64,
    pub antigravity_tokens: i64,
    pub estimated_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub source: String,
    pub input_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub output_tokens: i64,
    pub unclassified_tokens: i64,
    pub total_tokens: i64,
    pub estimated_usd: Option<f64>,
    pub is_partial: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSummary {
    pub source: String,
    pub model: String,
    pub input_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub output_tokens: i64,
    pub unclassified_tokens: i64,
    pub total_tokens: i64,
    pub estimated_usd: Option<f64>,
    pub is_partial: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub days: Option<u32>,
    pub scanned_files: usize,
    pub updated_files: usize,
    pub total_tokens: i64,
    pub input_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub output_tokens: i64,
    pub unclassified_tokens: i64,
    pub estimated_usd: f64,
    pub has_unpriced: bool,
    pub has_partial: bool,
    pub daily: Vec<DailyPoint>,
    pub by_source: Vec<SourceSummary>,
    pub by_model: Vec<ModelSummary>,
    pub generated_at: i64,
}

pub struct ParsedBatch {
    pub live_paths: HashSet<String>,
    pub changed: Vec<(String, String, i64, i64, i64, Vec<UsageRollupRow>)>,
    pub now: i64,
}

/// Discover and parse only new/modified local session files without holding the SQLite mutex.
pub fn parse_changed_files(existing: &HashMap<String, (i64, i64)>) -> ParsedBatch {
    let now = crate::model::now();

    let mut targets: Vec<(&'static str, PathBuf)> = Vec::new();
    for p in codex::discover_files() {
        targets.push(("codex", p));
    }
    for p in workbuddy::discover_files() {
        targets.push(("workbuddy", p));
    }
    for p in antigravity::discover_files() {
        targets.push(("antigravity", p));
    }

    let mut live_paths = HashSet::with_capacity(targets.len());
    let mut changed = Vec::new();

    for (source, path) in &targets {
        let Ok(meta) = std::fs::metadata(path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let size = meta.len().min(i64::MAX as u64) as i64;
        let path_key = path.to_string_lossy().into_owned();
        live_paths.insert(path_key.clone());

        if existing.get(&path_key) == Some(&(mtime, size)) {
            continue;
        }

        let rows = match *source {
            "codex" => codex::parse_file(path),
            "workbuddy" => workbuddy::parse_file(path),
            "antigravity" => antigravity::parse_file(path),
            _ => Vec::new(),
        };
        changed.push((path_key, (*source).to_owned(), mtime, size, now, rows));
    }

    ParsedBatch {
        live_paths,
        changed,
        now,
    }
}

/// Persist a parsed batch in one SQLite transaction and build the aggregated usage report.
pub fn commit_and_report(
    storage: &mut Storage,
    batch: ParsedBatch,
    days: Option<u32>,
) -> Result<UsageReport, String> {
    let updated_files = batch.changed.len();
    let scanned_files = batch.live_paths.len();
    storage.replace_usage_files_batch(&batch.changed)?;
    storage.prune_usage_files(&batch.live_paths)?;

    let since_day = days.and_then(|d| {
        let offset = (d.saturating_sub(1) as i64) * 86_400;
        local_day(batch.now.saturating_sub(offset))
    });
    let rollups = storage.query_usage_rollups(since_day.as_deref())?;
    Ok(build_report(
        rollups,
        days,
        scanned_files,
        updated_files,
        batch.now,
    ))
}

/// Convenience helper combining parse and commit (used in tests).
#[cfg(test)]
pub fn scan_and_report(storage: &mut Storage, days: Option<u32>) -> Result<UsageReport, String> {
    let existing = storage.usage_file_states()?;
    let batch = parse_changed_files(&existing);
    commit_and_report(storage, batch, days)
}

fn build_report(
    rollups: Vec<UsageRollupRow>,
    days: Option<u32>,
    scanned_files: usize,
    updated_files: usize,
    generated_at: i64,
) -> UsageReport {
    let mut total_tokens = 0i64;
    let mut input_tokens = 0i64;
    let mut cache_read_tokens = 0i64;
    let mut cache_write_tokens = 0i64;
    let mut output_tokens = 0i64;
    let mut unclassified_tokens = 0i64;
    let mut estimated_usd = 0.0f64;
    let mut has_unpriced = false;
    let mut has_partial = false;

    let mut daily_map: BTreeMap<String, DailyPoint> = BTreeMap::new();
    let mut source_map: HashMap<String, SourceSummary> = HashMap::new();
    let mut model_map: HashMap<(String, String), ModelSummary> = HashMap::new();

    for row in rollups {
        let row_total = row.input_tokens
            + row.cache_read_tokens
            + row.cache_write_tokens
            + row.output_tokens
            + row.unclassified_tokens;
        if row_total <= 0 {
            continue;
        }
        let row_usd = pricing::estimate_usd(
            &row.model,
            row.input_tokens,
            row.cache_read_tokens,
            row.cache_write_tokens,
            row.output_tokens,
        );
        if row_usd.is_none() || row.unclassified_tokens > 0 {
            has_unpriced = true;
        }
        if row.is_partial {
            has_partial = true;
        }
        let usd_val = row_usd.unwrap_or(0.0);

        total_tokens += row_total;
        input_tokens += row.input_tokens;
        cache_read_tokens += row.cache_read_tokens;
        cache_write_tokens += row.cache_write_tokens;
        output_tokens += row.output_tokens;
        unclassified_tokens += row.unclassified_tokens;
        estimated_usd += usd_val;

        let dp = daily_map.entry(row.day.clone()).or_insert_with(|| DailyPoint {
            day: row.day.clone(),
            total_tokens: 0,
            codex_tokens: 0,
            workbuddy_tokens: 0,
            antigravity_tokens: 0,
            estimated_usd: 0.0,
        });
        dp.total_tokens += row_total;
        dp.estimated_usd += usd_val;
        match row.source.as_str() {
            "codex" => dp.codex_tokens += row_total,
            "workbuddy" => dp.workbuddy_tokens += row_total,
            "antigravity" => dp.antigravity_tokens += row_total,
            _ => {}
        }

        let ss = source_map
            .entry(row.source.clone())
            .or_insert_with(|| SourceSummary {
                source: row.source.clone(),
                input_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                output_tokens: 0,
                unclassified_tokens: 0,
                total_tokens: 0,
                estimated_usd: None,
                is_partial: false,
            });
        ss.input_tokens += row.input_tokens;
        ss.cache_read_tokens += row.cache_read_tokens;
        ss.cache_write_tokens += row.cache_write_tokens;
        ss.output_tokens += row.output_tokens;
        ss.unclassified_tokens += row.unclassified_tokens;
        ss.total_tokens += row_total;
        ss.is_partial |= row.is_partial;
        if let Some(u) = row_usd {
            ss.estimated_usd = Some(ss.estimated_usd.unwrap_or(0.0) + u);
        }

        let ms = model_map
            .entry((row.source.clone(), row.model.clone()))
            .or_insert_with(|| ModelSummary {
                source: row.source,
                model: row.model,
                input_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
                output_tokens: 0,
                unclassified_tokens: 0,
                total_tokens: 0,
                estimated_usd: None,
                is_partial: false,
            });
        ms.input_tokens += row.input_tokens;
        ms.cache_read_tokens += row.cache_read_tokens;
        ms.cache_write_tokens += row.cache_write_tokens;
        ms.output_tokens += row.output_tokens;
        ms.unclassified_tokens += row.unclassified_tokens;
        ms.total_tokens += row_total;
        ms.is_partial |= row.is_partial;
        if let Some(u) = row_usd {
            ms.estimated_usd = Some(ms.estimated_usd.unwrap_or(0.0) + u);
        }
    }

    let mut by_source: Vec<_> = source_map.into_values().collect();
    by_source.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    let mut by_model: Vec<_> = model_map.into_values().collect();
    by_model.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    UsageReport {
        days,
        scanned_files,
        updated_files,
        total_tokens,
        input_tokens,
        cache_read_tokens,
        cache_write_tokens,
        output_tokens,
        unclassified_tokens,
        estimated_usd,
        has_unpriced,
        has_partial,
        daily: daily_map.into_values().collect(),
        by_source,
        by_model,
        generated_at,
    }
}

/// Format a Unix timestamp in seconds as local `YYYY-MM-DD` without requiring extra timezone crates.
pub(super) fn local_day(secs: i64) -> Option<String> {
    if secs <= 0 {
        return None;
    }
    let raw = secs as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let res = unsafe { libc::localtime_r(&raw, &mut tm) };
    if res.is_null() {
        return None;
    }
    Some(format!(
        "{:04}-{:02}-{:02}",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday
    ))
}

/// Recursively collect files with matching extension while ignoring broken symlinks.
pub(super) fn collect_files_by_ext(dir: &Path, ext: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_by_ext(&path, ext, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some(ext) {
            out.push(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "scans real local Codex/WorkBuddy/Antigravity session logs in temp SQLite"]
    fn live_local_usage_scan() {
        let db_path =
            std::env::temp_dir().join(format!("usage-live-{}.sqlite", uuid::Uuid::new_v4()));
        let mut storage = Storage::open(&db_path).expect("open temp db");
        let report = scan_and_report(&mut storage, Some(30)).expect("scan local usage");
        println!(
            "usage live scan ok: files={}, updated={}, total_tokens={}, est_usd={:.2}, sources={}",
            report.scanned_files,
            report.updated_files,
            report.total_tokens,
            report.estimated_usd,
            report.by_source.len()
        );
        for s in &report.by_source {
            println!(
                "  source={}: total={}, in={}, cache_read={}, out={}, unclassified={}, partial={}",
                s.source,
                s.total_tokens,
                s.input_tokens,
                s.cache_read_tokens,
                s.output_tokens,
                s.unclassified_tokens,
                s.is_partial
            );
        }
        drop(storage);
        let _ = std::fs::remove_file(&db_path);
    }
}
