use rusqlite::{params, Connection, OptionalExtension, Result};
use std::{path::Path, time::Duration};

pub const RULE_PREFIX: &str = "[#from]";
pub const DATABASE: &str = "proxy-mappings.sqlite3";

pub struct MappingStore(Connection);

impl MappingStore {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path)?;
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS rules (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
             CREATE TEMP TABLE session (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
             CREATE TEMP VIEW shared AS SELECT * FROM rules UNION ALL SELECT * FROM session;",
        )?;
        Ok(Self(db))
    }

    // Only proxy rules survive a restart. Other share-plugin keys are session scoped.
    fn table(key: &str) -> &'static str {
        if key.starts_with(RULE_PREFIX) {
            "rules"
        } else {
            "session"
        }
    }

    pub fn put(&self, key: &str, value: &str, if_absent: bool) -> Result<bool> {
        let conflict = if if_absent {
            "DO NOTHING"
        } else {
            "DO UPDATE SET value = excluded.value"
        };
        let sql = format!(
            "INSERT INTO {} (key, value) VALUES (?1, ?2) ON CONFLICT(key) {conflict}",
            Self::table(key)
        );
        Ok(self.0.execute(&sql, params![key, value])? != 0)
    }

    pub fn get(&self, key: &str) -> Result<Option<String>> {
        let sql = format!("SELECT value FROM {} WHERE key = ?1", Self::table(key));
        self.0.query_row(&sql, [key], |row| row.get(0)).optional()
    }

    pub fn remove(&self, key: &str) -> Result<()> {
        self.0.execute(
            &format!("DELETE FROM {} WHERE key = ?1", Self::table(key)),
            [key],
        )?;
        Ok(())
    }

    pub fn set_status(&self, from: &str, status: crate::MappingStatus) -> Result<bool> {
        let value = match status {
            crate::MappingStatus::Active => "active",
            crate::MappingStatus::Inactive => "inactive",
        };
        Ok(self.0.execute(
            "UPDATE rules SET value = json_set(value, '$.status', ?2) WHERE key = ?1",
            params![format!("{RULE_PREFIX}{from}"), value],
        )? != 0)
    }

    pub fn clear(&mut self) -> Result<()> {
        let tx = self.0.transaction()?;
        tx.execute("DELETE FROM rules", [])?;
        tx.execute("DELETE FROM session", [])?;
        tx.commit()
    }

    pub fn entries(&self) -> Result<Vec<(String, String)>> {
        self.0
            .prepare("SELECT key, value FROM shared")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect()
    }

    pub fn rules(&self) -> Result<Vec<crate::ProxyMapping>> {
        let mut stmt = self.0.prepare("SELECT value FROM rules ORDER BY key")?;
        let values = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut rules = Vec::new();
        for value in values {
            if let Ok(rule) = serde_json::from_str(&value?) {
                rules.push(rule);
            }
        }
        Ok(rules)
    }

    pub fn find_rule(&self, path: &str) -> Result<Option<crate::ProxyMapping>> {
        let mut stmt = self.0.prepare_cached(
            "SELECT value FROM rules WHERE instr(?1, key) = 1 ORDER BY length(key) DESC",
        )?;
        let values = stmt.query_map([format!("{RULE_PREFIX}{path}")], |row| {
            row.get::<_, String>(0)
        })?;
        for value in values {
            if let Ok(rule) = serde_json::from_str::<crate::ProxyMapping>(&value?) {
                if rule.status == crate::MappingStatus::Active {
                    return Ok(Some(rule));
                }
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MappingStatus::{Active, Inactive};

    #[test]
    fn restores_rules_and_status_and_keeps_other_keys_in_memory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DATABASE);
        let db = MappingStore::open(&path).unwrap();
        db.put("[#from]/api", r#"{"from":"/api","target":"http://localhost:8000","rewrite":"/v2","change_origin":true}"#, false).unwrap();
        db.put(
            "[#from]/api/private",
            r#"{"from":"/api/private","target":"http://localhost:9000"}"#,
            false,
        )
        .unwrap();
        db.put("listen_port", "1234", false).unwrap();
        assert!(db.set_status("/api/private", Inactive).unwrap());
        drop(db);
        let db = MappingStore::open(&path).unwrap();
        let rules = db.rules().unwrap();
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].status, Active);
        assert_eq!(rules[0].rewrite.as_deref(), Some("/v2"));
        assert_eq!(rules[0].change_origin, Some(true));
        assert_eq!(rules[1].status, Inactive);
        assert_eq!(rules[1].target, "http://localhost:9000");
        assert_eq!(db.get("listen_port").unwrap(), None);
        assert_eq!(
            db.find_rule("/api/private/x").unwrap().unwrap().from,
            "/api"
        );
        assert!(db.find_rule("/other").unwrap().is_none());
        db.set_status("/api", Inactive).unwrap();
        assert!(db.find_rule("/api/private/x").unwrap().is_none());
        let second = MappingStore::open(&path).unwrap();
        second.set_status("/api/private", Active).unwrap();
        assert_eq!(
            db.find_rule("/api/private/x").unwrap().unwrap().from,
            "/api/private"
        );
        db.remove("[#from]/api/private").unwrap();
        drop(db);
        drop(second);
        assert_eq!(MappingStore::open(&path).unwrap().rules().unwrap().len(), 1);
    }
}
