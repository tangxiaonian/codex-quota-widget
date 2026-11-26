use crate::model::{Preferences, Snapshot};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageRollupRow {
    pub day: String,
    pub source: String,
    pub model: String,
    pub input_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub output_tokens: i64,
    pub unclassified_tokens: i64,
    pub is_partial: bool,
}

pub struct Storage {
    connection: Connection,
}

impl Storage {
    /// Open only the widget's database and run idempotent schema migrations (v1 -> v2).
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "无法创建卡片数据目录")?;
        }
        let c = Connection::open(path).map_err(|_| "无法打开本地数据库")?;
        c.execute_batch(
            "PRAGMA foreign_keys=ON;
            CREATE TABLE IF NOT EXISTS app_preferences(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS account_cache(account_key TEXT PRIMARY KEY,payload TEXT NOT NULL,fetched_at INTEGER NOT NULL,available_count INTEGER,detail_state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS quota_window(account_key TEXT NOT NULL REFERENCES account_cache(account_key) ON DELETE CASCADE,minutes INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(account_key,minutes));
            CREATE TABLE IF NOT EXISTS reset_credit(account_key TEXT NOT NULL REFERENCES account_cache(account_key) ON DELETE CASCADE,credit_id TEXT NOT NULL,status TEXT NOT NULL,expires_at INTEGER,payload TEXT NOT NULL,PRIMARY KEY(account_key,credit_id));
            CREATE INDEX IF NOT EXISTS idx_credit_account_status_expiry ON reset_credit(account_key,status,expires_at);",
        )
        .map_err(|_| "初始化本地数据库失败")?;

        let version: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|_| "读取数据库版本失败")?;
        if version < 2 {
            c.execute_batch(
                "BEGIN;
                CREATE TABLE IF NOT EXISTS usage_file_state(
                    path TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    mtime INTEGER NOT NULL,
                    size INTEGER NOT NULL,
                    parsed_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS usage_file_rollup(
                    path TEXT NOT NULL REFERENCES usage_file_state(path) ON DELETE CASCADE,
                    day TEXT NOT NULL,
                    source TEXT NOT NULL,
                    model TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    unclassified_tokens INTEGER NOT NULL DEFAULT 0,
                    is_partial INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(path, day, source, model)
                );
                CREATE INDEX IF NOT EXISTS idx_usage_rollup_day ON usage_file_rollup(day, source);
                PRAGMA user_version=2;
                COMMIT;",
            )
            .map_err(|_| "升级本地数据库至 v2 失败")?;
        }
        Ok(Self { connection: c })
    }

    /// Missing settings use defaults; malformed stored data is reported instead of erased.
    pub fn preferences(&self) -> Result<Preferences, String> {
        let raw: Option<String> = self
            .connection
            .query_row("SELECT payload FROM app_preferences WHERE id=1", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| "读取设置失败")?;
        match raw {
            Some(s) => serde_json::from_str(&s).map_err(|_| "本地设置无法解析".into()),
            None => Ok(Preferences::default()),
        }
    }

    /// Persist validated preferences without creating any system login item.
    pub fn save_preferences(&self, p: &Preferences) -> Result<(), String> {
        p.validate()?;
        let raw = serde_json::to_string(p).map_err(|_| "设置编码失败")?;
        self.connection
            .execute(
                "INSERT INTO app_preferences VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                [raw],
            )
            .map_err(|_| "保存设置失败")?;
        Ok(())
    }

    /// Replace the current account snapshot atomically; keep preferences and usage rollups untouched.
    pub fn save_snapshot(&mut self, s: &Snapshot) -> Result<(), String> {
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "无法开始缓存事务")?;
        let result = (|| -> rusqlite::Result<()> {
            tx.execute("DELETE FROM account_cache", [])?;
            tx.execute(
                "INSERT INTO account_cache VALUES(?1,?2,?3,?4,?5)",
                params![
                    s.account.key,
                    serde_json::to_string(&s.account).unwrap(),
                    s.fetched_at,
                    s.available_count,
                    s.detail_state
                ],
            )?;
            for w in &s.windows {
                tx.execute(
                    "INSERT INTO quota_window VALUES(?1,?2,?3)",
                    params![s.account.key, w.minutes, serde_json::to_string(w).unwrap()],
                )?;
            }
            for c in &s.credits {
                tx.execute(
                    "INSERT INTO reset_credit VALUES(?1,?2,?3,?4,?5)",
                    params![
                        s.account.key,
                        c.id,
                        c.status,
                        c.expires_at,
                        serde_json::to_string(c).unwrap()
                    ],
                )?;
            }
            Ok(())
        })();
        result.map_err(|_| "写入额度缓存失败")?;
        tx.commit().map_err(|_| "提交额度缓存失败".into())
    }

    /// Reconstruct only explicitly saved snapshot data; cached values are never considered fresh.
    pub fn snapshot(&self) -> Result<Option<Snapshot>, String> {
        let row: Option<(String, String, i64, Option<i64>, String)> = self
            .connection
            .query_row(
                "SELECT account_key,payload,fetched_at,available_count,detail_state FROM account_cache LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()
            .map_err(|_| "读取额度缓存失败")?;
        let Some((key, account, fetched_at, available_count, detail_state)) = row else {
            return Ok(None);
        };
        Ok(Some(Snapshot {
            account: serde_json::from_str(&account).map_err(|_| "账号缓存无法解析")?,
            windows: self.rows("SELECT payload FROM quota_window WHERE account_key=?1", &key)?,
            credits: self.rows(
                "SELECT payload FROM reset_credit WHERE account_key=?1 ORDER BY expires_at IS NULL, expires_at, credit_id",
                &key,
            )?,
            fetched_at,
            available_count,
            detail_state,
        }))
    }

    /// Read previously indexed local usage file fingerprints `(mtime, size)` for incremental scans.
    pub fn usage_file_states(&self) -> Result<HashMap<String, (i64, i64)>, String> {
        let mut stmt = self
            .connection
            .prepare("SELECT path, mtime, size FROM usage_file_state")
            .map_err(|_| "读取用量索引失败")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))
            })
            .map_err(|_| "读取用量索引失败")?;
        let mut map = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(|_| "读取用量索引失败")?;
            map.insert(k, v);
        }
        Ok(map)
    }

    /// Atomically replace one local log file's aggregated usage rows; cascade deletes stale entries.
    #[cfg(test)]
    pub fn replace_usage_file(
        &mut self,
        path: &str,
        source: &str,
        mtime: i64,
        size: i64,
        parsed_at: i64,
        rows: &[UsageRollupRow],
    ) -> Result<(), String> {
        self.replace_usage_files_batch(&[(
            path.to_owned(),
            source.to_owned(),
            mtime,
            size,
            parsed_at,
            rows.to_vec(),
        )])
    }

    /// Replace a batch of changed local usage files in a single SQLite transaction to avoid per-file fsyncs.
    pub fn replace_usage_files_batch(
        &mut self,
        batch: &[(String, String, i64, i64, i64, Vec<UsageRollupRow>)],
    ) -> Result<(), String> {
        if batch.is_empty() {
            return Ok(());
        }
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "无法开始用量写入事务")?;
        let res = (|| -> rusqlite::Result<()> {
            let mut del = tx.prepare("DELETE FROM usage_file_state WHERE path=?1")?;
            let mut ins_state = tx.prepare("INSERT INTO usage_file_state VALUES(?1,?2,?3,?4,?5)")?;
            let mut ins_row = tx.prepare(
                "INSERT INTO usage_file_rollup VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            )?;
            for (path, source, mtime, size, parsed_at, rows) in batch {
                del.execute([path])?;
                ins_state.execute(params![path, source, mtime, size, parsed_at])?;
                for row in rows {
                    ins_row.execute(params![
                        path,
                        row.day,
                        row.source,
                        row.model,
                        row.input_tokens,
                        row.cache_read_tokens,
                        row.cache_write_tokens,
                        row.output_tokens,
                        row.unclassified_tokens,
                        if row.is_partial { 1 } else { 0 }
                    ])?;
                }
            }
            Ok(())
        })();
        res.map_err(|_| "写入本地用量汇总失败")?;
        tx.commit().map_err(|_| "提交本地用量汇总失败".into())
    }

    /// Drop cached rollups for log files that were deleted from disk.
    pub fn prune_usage_files(&mut self, live_paths: &HashSet<String>) -> Result<(), String> {
        let indexed = self.usage_file_states()?;
        let stale: Vec<String> = indexed
            .into_keys()
            .filter(|p| !live_paths.contains(p))
            .collect();
        if stale.is_empty() {
            return Ok(());
        }
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "无法开始用量清理事务")?;
        for path in stale {
            tx.execute("DELETE FROM usage_file_state WHERE path=?1", [path])
                .map_err(|_| "清理过期用量索引失败")?;
        }
        tx.commit().map_err(|_| "提交用量清理失败".into())
    }

    /// Aggregate cached per-file rollups into `(day, source, model)` rows.
    pub fn query_usage_rollups(&self, since_day: Option<&str>) -> Result<Vec<UsageRollupRow>, String> {
        let sql = if since_day.is_some() {
            "SELECT day, source, model,
                    SUM(input_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens),
                    SUM(output_tokens), SUM(unclassified_tokens), MAX(is_partial)
             FROM usage_file_rollup
             WHERE day >= ?1
             GROUP BY day, source, model
             ORDER BY day ASC, source ASC, model ASC"
        } else {
            "SELECT day, source, model,
                    SUM(input_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens),
                    SUM(output_tokens), SUM(unclassified_tokens), MAX(is_partial)
             FROM usage_file_rollup
             GROUP BY day, source, model
             ORDER BY day ASC, source ASC, model ASC"
        };
        let mut stmt = self.connection.prepare(sql).map_err(|_| "查询用量汇总失败")?;
        let mapper = |r: &rusqlite::Row<'_>| -> rusqlite::Result<UsageRollupRow> {
            Ok(UsageRollupRow {
                day: r.get(0)?,
                source: r.get(1)?,
                model: r.get(2)?,
                input_tokens: r.get(3)?,
                cache_read_tokens: r.get(4)?,
                cache_write_tokens: r.get(5)?,
                output_tokens: r.get(6)?,
                unclassified_tokens: r.get(7)?,
                is_partial: r.get::<_, i64>(8)? != 0,
            })
        };
        let rows = if let Some(since) = since_day {
            stmt.query_map([since], mapper)
                .map_err(|_| "查询用量汇总失败")?
                .collect::<Result<Vec<_>, _>>()
        } else {
            stmt.query_map([], mapper)
                .map_err(|_| "查询用量汇总失败")?
                .collect::<Result<Vec<_>, _>>()
        };
        rows.map_err(|_| "解析用量汇总失败".into())
    }

    /// Clear only local usage cache tables without affecting settings or Codex snapshots.
    pub fn clear_usage_cache(&mut self) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM usage_file_state", [])
            .map_err(|_| "清除用量缓存失败")?;
        Ok(())
    }

    /// Deserialize the small typed cache rows without storing raw API responses.
    fn rows<T: serde::de::DeserializeOwned>(&self, sql: &str, key: &str) -> Result<Vec<T>, String> {
        let mut stmt = self.connection.prepare(sql).map_err(|_| "读取缓存失败")?;
        let rows = stmt
            .query_map([key], |r| r.get::<_, String>(0))
            .map_err(|_| "读取缓存失败")?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|_| "读取缓存失败")?).map_err(|_| "缓存无法解析".into())
        })
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::normalize;
    use serde_json::json;

    #[test]
    fn account_replacement_and_preferences_survive_reopen() {
        let path =
            std::env::temp_dir().join(format!("widget-test-{}.sqlite", uuid::Uuid::new_v4()));
        let mut db = Storage::open(&path).unwrap();
        let mut p = Preferences::default();
        p.refresh_minutes = 15;
        p.expanded_size = Some(crate::model::WindowSize {
            width: 530.0,
            height: 760.0,
        });
        db.save_preferences(&p).unwrap();
        for id in ["first", "second"] {
            let s = normalize(
                &json!({"account":{"type":"chatgpt"}}),
                &json!({"accountId":id,"rateLimits":{"primary":{"windowDurationMins":300,"usedPercent":25}},"rateLimitResetCredits":{"availableCount":0,"credits":[]}}),
                10,
            )
            .unwrap();
            db.save_snapshot(&s).unwrap();
            assert_eq!(db.snapshot().unwrap().unwrap().account.key, s.account.key);
        }
        drop(db);
        let db = Storage::open(&path).unwrap();
        assert_eq!(db.preferences().unwrap().refresh_minutes, 15);
        assert_eq!(db.preferences().unwrap().expanded_size, p.expanded_size);
        assert_eq!(db.snapshot().unwrap().unwrap().windows.len(), 1);
        drop(db);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn v1_migrates_to_v2_and_usage_rollups_replace_idempotently() {
        let path =
            std::env::temp_dir().join(format!("widget-v1-{}.sqlite", uuid::Uuid::new_v4()));
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE app_preferences(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
                 INSERT INTO app_preferences VALUES(1, '{\"compact\":true,\"autoRefresh\":true,\"refreshMinutes\":12,\"alwaysOnTop\":false,\"followCodex\":true}');
                 PRAGMA user_version=1;",
            )
            .unwrap();
        }
        let mut db = Storage::open(&path).unwrap();
        assert_eq!(db.preferences().unwrap().refresh_minutes, 12);
        let row1 = UsageRollupRow {
            day: "2026-11-25".into(),
            source: "codex".into(),
            model: "gpt-5".into(),
            input_tokens: 1000,
            cache_read_tokens: 500,
            cache_write_tokens: 0,
            output_tokens: 200,
            unclassified_tokens: 0,
            is_partial: false,
        };
        db.replace_usage_file("/tmp/a.jsonl", "codex", 10, 100, 20, &[row1.clone()])
            .unwrap();
        // Updating the same file must replace rather than double-count.
        db.replace_usage_file("/tmp/a.jsonl", "codex", 11, 120, 21, &[row1])
            .unwrap();
        let rows = db.query_usage_rollups(Some("2026-11-20")).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].input_tokens, 1000);
        db.prune_usage_files(&HashSet::new()).unwrap();
        assert!(db.query_usage_rollups(None).unwrap().is_empty());
        drop(db);
        std::fs::remove_file(path).unwrap();
    }
}
