//! AI 服务配置持久化（SQLite 单行表）。API Key 不写日志、不回传前端。

use super::{AiSettings, DEFAULT_TIP_COUNT};
use crate::database;
use rusqlite::{params, Connection, OptionalExtension};

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS ai_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key TEXT NOT NULL,
        tip_count INTEGER NOT NULL DEFAULT 3,
        extra_prompt TEXT NOT NULL DEFAULT ''
    );";

/// 后加的列（早期开发版建的表没有）；按需补齐，可重复执行
const ADDED_COLUMNS: &[(&str, &str)] = &[
    ("tip_count", "INTEGER NOT NULL DEFAULT 3"),
    ("extra_prompt", "TEXT NOT NULL DEFAULT ''"),
];

pub fn migrate(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT name FROM pragma_table_info('ai_settings')")
        .map_err(|e| format!("读取 ai_settings 结构失败: {}", e))?;
    let existing: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .and_then(|rows| rows.collect())
        .map_err(|e| format!("读取 ai_settings 结构失败: {}", e))?;
    for (name, ddl) in ADDED_COLUMNS {
        if !existing.iter().any(|c| c == name) {
            conn.execute_batch(&format!(
                "ALTER TABLE ai_settings ADD COLUMN {} {};",
                name, ddl
            ))
            .map_err(|e| format!("升级 ai_settings 失败: {}", e))?;
        }
    }
    Ok(())
}

pub fn load() -> Result<Option<AiSettings>, String> {
    let conn = database::get_connection()?;
    conn.query_row(
        "SELECT provider, base_url, model, api_key, tip_count, extra_prompt
         FROM ai_settings WHERE id = 1",
        [],
        |row| {
            Ok(AiSettings {
                provider: row.get(0)?,
                base_url: row.get(1)?,
                model: row.get(2)?,
                api_key: row.get(3)?,
                tip_count: row.get::<_, u8>(4).unwrap_or(DEFAULT_TIP_COUNT),
                extra_prompt: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("读取 AI 配置失败: {}", e))
}

pub fn save(s: &AiSettings) -> Result<(), String> {
    let conn = database::get_connection()?;
    conn.execute(
        "INSERT INTO ai_settings (id, provider, base_url, model, api_key, tip_count, extra_prompt)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            provider = excluded.provider,
            base_url = excluded.base_url,
            model = excluded.model,
            api_key = excluded.api_key,
            tip_count = excluded.tip_count,
            extra_prompt = excluded.extra_prompt",
        params![
            s.provider,
            s.base_url,
            s.model,
            s.api_key,
            s.tip_count,
            s.extra_prompt
        ],
    )
    .map_err(|e| format!("保存 AI 配置失败: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_adds_missing_columns_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE ai_settings (id INTEGER PRIMARY KEY, provider TEXT NOT NULL,
             base_url TEXT NOT NULL, model TEXT NOT NULL, api_key TEXT NOT NULL);
             INSERT INTO ai_settings VALUES (1, 'p', 'u', 'm', 'k');",
        )
        .unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let (count, extra): (u8, String) = conn
            .query_row(
                "SELECT tip_count, extra_prompt FROM ai_settings WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((count, extra.as_str()), (3, ""));
    }
}
