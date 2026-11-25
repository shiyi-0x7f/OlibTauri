//! Kindle 配置持久化（SQLite 单行表）。授权码与其他账号凭据一样存本机数据库，不写日志。

use super::{KindleSettings, Security};
use crate::database;
use rusqlite::{params, OptionalExtension};

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS kindle_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        to_addr TEXT NOT NULL,
        from_addr TEXT NOT NULL,
        smtp_host TEXT NOT NULL,
        smtp_port INTEGER NOT NULL,
        -- tls | starttls
        security TEXT NOT NULL,
        password TEXT NOT NULL
    );";

pub fn load() -> Result<Option<KindleSettings>, String> {
    let conn = database::get_connection()?;
    conn.query_row(
        "SELECT to_addr, from_addr, smtp_host, smtp_port, security, password
         FROM kindle_settings WHERE id = 1",
        [],
        |row| {
            Ok(KindleSettings {
                to: row.get(0)?,
                from: row.get(1)?,
                smtp_host: row.get(2)?,
                smtp_port: row.get(3)?,
                security: Security::parse(&row.get::<_, String>(4)?),
                password: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("读取 Kindle 配置失败: {}", e))
}

pub fn save(s: &KindleSettings) -> Result<(), String> {
    let conn = database::get_connection()?;
    conn.execute(
        "INSERT INTO kindle_settings (id, to_addr, from_addr, smtp_host, smtp_port, security, password)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            to_addr = excluded.to_addr,
            from_addr = excluded.from_addr,
            smtp_host = excluded.smtp_host,
            smtp_port = excluded.smtp_port,
            security = excluded.security,
            password = excluded.password",
        params![
            s.to,
            s.from,
            s.smtp_host,
            s.smtp_port,
            s.security.as_str(),
            s.password
        ],
    )
    .map_err(|e| format!("保存 Kindle 配置失败: {}", e))?;
    Ok(())
}
