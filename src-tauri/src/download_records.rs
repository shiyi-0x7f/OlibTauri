//! 本地下载记录：每次下载成功（含转交外部工具）记一条，供「下载历史」页按时间倒序查看。
//!
//! 下载任务表是内存态、重启即失，靠这张表让记录活过重启。
//! 同一 book_id 只保留一条，重新下载时刷新时间与文件路径。

use crate::database;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS download_records (
        book_id TEXT PRIMARY KEY,
        hash TEXT,
        title TEXT NOT NULL,
        author TEXT,
        extension TEXT,
        cover TEXT,
        -- builtin | browser | idm | motrix | copy_url
        method TEXT NOT NULL,
        -- 文件落在哪；交给浏览器 / 复制链接时不可知，为 NULL
        file_path TEXT,
        -- 本地时间 YYYY-MM-DD HH:MM:SS，字符串序即时间序
        downloaded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_download_records_time
        ON download_records (downloaded_at);";

/// 写入一条记录所需的字段
pub struct NewRecord<'a> {
    pub book_id: &'a str,
    pub hash: Option<&'a str>,
    pub title: &'a str,
    pub author: Option<&'a str>,
    pub extension: Option<&'a str>,
    pub cover: Option<&'a str>,
    pub method: &'a str,
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DownloadRecord {
    pub book_id: String,
    pub hash: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub extension: Option<String>,
    pub cover: Option<String>,
    pub method: String,
    pub file_path: Option<String>,
    pub downloaded_at: String,
    /// 查询时实时检查：文件被删 / 移走后为 false，前端据此提供「重新下载」
    pub file_exists: bool,
}

fn upsert(conn: &Connection, r: &NewRecord, at: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO download_records
         (book_id, hash, title, author, extension, cover, method, file_path, downloaded_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(book_id) DO UPDATE SET
            hash = COALESCE(excluded.hash, hash),
            title = excluded.title,
            author = COALESCE(excluded.author, author),
            extension = COALESCE(excluded.extension, extension),
            cover = COALESCE(excluded.cover, cover),
            method = excluded.method,
            file_path = excluded.file_path,
            downloaded_at = excluded.downloaded_at",
        params![
            r.book_id,
            r.hash,
            r.title,
            r.author,
            r.extension,
            r.cover,
            r.method,
            r.file_path,
            at
        ],
    )?;
    Ok(())
}

fn query_all(conn: &Connection) -> rusqlite::Result<Vec<DownloadRecord>> {
    let mut stmt = conn.prepare(
        "SELECT book_id, hash, title, author, extension, cover, method, file_path, downloaded_at
         FROM download_records ORDER BY downloaded_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let file_path: Option<String> = row.get(7)?;
        Ok(DownloadRecord {
            book_id: row.get(0)?,
            hash: row.get(1)?,
            title: row.get(2)?,
            author: row.get(3)?,
            extension: row.get(4)?,
            cover: row.get(5)?,
            method: row.get(6)?,
            file_exists: file_path.as_deref().is_some_and(|p| Path::new(p).is_file()),
            file_path,
            downloaded_at: row.get(8)?,
        })
    })?;
    rows.collect()
}

/// 记一次下载
pub fn record(r: &NewRecord) -> Result<(), String> {
    let conn = database::get_connection()?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    upsert(&conn, r, &now).map_err(|e| format!("Failed to record download: {}", e))
}

/// 全部记录，新的在前
pub fn list() -> Result<Vec<DownloadRecord>, String> {
    let conn = database::get_connection()?;
    query_all(&conn).map_err(|e| format!("Failed to query download records: {}", e))
}

/// 删一条记录（不动文件）
pub fn delete(book_id: &str) -> Result<(), String> {
    let conn = database::get_connection()?;
    conn.execute(
        "DELETE FROM download_records WHERE book_id = ?1",
        params![book_id],
    )
    .map_err(|e| format!("Failed to delete download record: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    fn rec<'a>(book_id: &'a str, title: &'a str, author: Option<&'a str>) -> NewRecord<'a> {
        NewRecord {
            book_id,
            hash: Some("h"),
            title,
            author,
            extension: Some("epub"),
            cover: None,
            method: "builtin",
            file_path: Some(format!("/nowhere/{}.epub", title)),
        }
    }

    #[test]
    fn newest_first() {
        let conn = setup();
        upsert(&conn, &rec("1", "old", None), "2026-01-01 08:00:00").unwrap();
        upsert(&conn, &rec("2", "new", None), "2026-03-01 08:00:00").unwrap();
        upsert(&conn, &rec("3", "mid", None), "2026-02-01 08:00:00").unwrap();
        let titles: Vec<_> = query_all(&conn)
            .unwrap()
            .into_iter()
            .map(|r| r.title)
            .collect();
        assert_eq!(titles, ["new", "mid", "old"]);
    }

    /// 同一本书重新下载：不重复，时间刷新到最新；新数据缺的字段保留旧值
    #[test]
    fn redownload_refreshes_without_duplicating() {
        let conn = setup();
        upsert(
            &conn,
            &rec("1", "book", Some("author")),
            "2026-01-01 08:00:00",
        )
        .unwrap();
        upsert(&conn, &rec("2", "other", None), "2026-02-01 08:00:00").unwrap();
        upsert(&conn, &rec("1", "book", None), "2026-03-01 08:00:00").unwrap();

        let all = query_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].book_id, "1", "re-downloaded book moves to the top");
        assert_eq!(all[0].downloaded_at, "2026-03-01 08:00:00");
        assert_eq!(all[0].author.as_deref(), Some("author"));
    }

    #[test]
    fn missing_file_is_flagged() {
        let conn = setup();
        upsert(&conn, &rec("1", "gone", None), "2026-01-01 08:00:00").unwrap();
        let mut no_path = rec("2", "browser", None);
        no_path.method = "browser";
        no_path.file_path = None;
        upsert(&conn, &no_path, "2026-01-02 08:00:00").unwrap();

        assert!(query_all(&conn).unwrap().iter().all(|r| !r.file_exists));
    }
}
