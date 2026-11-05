use crate::model::{Preferences, Snapshot};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub struct Storage {
    connection: Connection,
}
impl Storage {
    /// Open only the widget's database; never touch Codex's state or credential databases.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| "无法创建卡片数据目录")?;
        }
        let c = Connection::open(path).map_err(|_| "无法打开本地数据库")?;
        c.execute_batch("PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS app_preferences(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS account_cache(account_key TEXT PRIMARY KEY,payload TEXT NOT NULL,fetched_at INTEGER NOT NULL,available_count INTEGER,detail_state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS quota_window(account_key TEXT NOT NULL REFERENCES account_cache(account_key) ON DELETE CASCADE,minutes INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(account_key,minutes));
        CREATE TABLE IF NOT EXISTS reset_credit(account_key TEXT NOT NULL REFERENCES account_cache(account_key) ON DELETE CASCADE,credit_id TEXT NOT NULL,status TEXT NOT NULL,expires_at INTEGER,payload TEXT NOT NULL,PRIMARY KEY(account_key,credit_id));
        CREATE INDEX IF NOT EXISTS idx_credit_account_status_expiry ON reset_credit(account_key,status,expires_at);
        PRAGMA user_version=1;").map_err(|_|"初始化本地数据库失败")?;
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
        self.connection.execute("INSERT INTO app_preferences VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",[raw]).map_err(|_|"保存设置失败")?;
        Ok(())
    }
    /// Replace the current account snapshot atomically; keep preferences untouched.
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
        let row:Option<(String,String,i64,Option<i64>,String)>=self.connection.query_row("SELECT account_key,payload,fetched_at,available_count,detail_state FROM account_cache LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(|_|"读取额度缓存失败")?;
        let Some((key, account, fetched_at, available_count, detail_state)) = row else {
            return Ok(None);
        };
        Ok(Some(Snapshot { account:serde_json::from_str(&account).map_err(|_|"账号缓存无法解析")?,windows:self.rows("SELECT payload FROM quota_window WHERE account_key=?1",&key)?,credits:self.rows("SELECT payload FROM reset_credit WHERE account_key=?1 ORDER BY expires_at IS NULL, expires_at, credit_id",&key)?,fetched_at,available_count,detail_state }))
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
            let s=normalize(&json!({"account":{"type":"chatgpt"}}),&json!({"accountId":id,"rateLimits":{"primary":{"windowDurationMins":300,"usedPercent":25}},"rateLimitResetCredits":{"availableCount":0,"credits":[]}}),10).unwrap();
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
}
