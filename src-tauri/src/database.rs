use log;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Global database path
static DB_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// User record
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub email: String,
    pub password: String,
    pub name: Option<String>,
    pub remix_user_id: Option<String>,
    pub remix_user_key: Option<String>,
    pub downloads_today: i32,
    pub downloads_limit: i32,
}

/// Initialize the database
pub fn init_db(app_data_dir: &Path) -> Result<(), String> {
    let db_path = app_data_dir.join("olib_data.db");

    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            password TEXT NOT NULL,
            name TEXT,
            remix_user_id TEXT,
            remix_user_key TEXT,
            downloads_today INTEGER DEFAULT 0,
            downloads_limit INTEGER DEFAULT 0,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS favorites (
            book_id TEXT NOT NULL,
            user_email TEXT NOT NULL,
            hash TEXT,
            title TEXT NOT NULL,
            author TEXT,
            publisher TEXT,
            year INTEGER,
            language TEXT,
            extension TEXT,
            filesize INTEGER,
            cover TEXT,
            description TEXT,
            pages INTEGER,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (book_id, user_email)
        );
        -- 插件加工记录：哪个文件被转换/识别过、产出了什么。
        -- 任务表是内存态、重启即失，靠这张表让书架上的「已转换 / 已 OCR」标记活过重启。
        CREATE TABLE IF NOT EXISTS plugin_outputs (
            output_path TEXT PRIMARY KEY,
            source_path TEXT NOT NULL,
            source_name TEXT NOT NULL,
            output_name TEXT NOT NULL,
            plugin_id TEXT NOT NULL,
            capability TEXT NOT NULL,
            target_format TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_plugin_outputs_source
            ON plugin_outputs (source_path);",
    )
    .map_err(|e| format!("Failed to create tables: {}", e))?;

    // Store the path for later use
    *DB_PATH.lock().unwrap() = Some(db_path.clone());

    log::info!("Database initialized at {:?}", db_path);
    Ok(())
}

/// Get database connection
fn get_connection() -> Result<Connection, String> {
    let path = DB_PATH.lock().unwrap();
    let db_path = path.as_ref().ok_or("Database not initialized")?;
    Connection::open(db_path).map_err(|e| format!("Failed to open database: {}", e))
}

/// Insert or update a user
pub fn upsert_user(user: &User) -> Result<(), String> {
    let conn = get_connection()?;
    conn.execute(
        "INSERT INTO users (email, password, name, remix_user_id, remix_user_key, downloads_today, downloads_limit, last_active)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
         ON CONFLICT(email) DO UPDATE SET
            password=excluded.password,
            name=excluded.name,
            remix_user_id=excluded.remix_user_id,
            remix_user_key=excluded.remix_user_key,
            downloads_today=excluded.downloads_today,
            downloads_limit=excluded.downloads_limit,
            last_active=CURRENT_TIMESTAMP",
        params![
            user.email,
            user.password,
            user.name,
            user.remix_user_id,
            user.remix_user_key,
            user.downloads_today,
            user.downloads_limit,
        ],
    ).map_err(|e| format!("Failed to upsert user: {}", e))?;
    Ok(())
}

/// Get all users
pub fn get_all_users() -> Result<Vec<User>, String> {
    let conn = get_connection()?;
    let mut stmt = conn
        .prepare(
            "SELECT email, password, name, remix_user_id, remix_user_key, downloads_today, downloads_limit
             FROM users ORDER BY last_active DESC"
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let users = stmt
        .query_map([], |row| {
            Ok(User {
                email: row.get(0)?,
                password: row.get(1)?,
                name: row.get(2)?,
                remix_user_id: row.get(3)?,
                remix_user_key: row.get(4)?,
                downloads_today: row.get(5)?,
                downloads_limit: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query users: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(users)
}

/// Get a single user by email
pub fn get_user(email: &str) -> Result<Option<User>, String> {
    let conn = get_connection()?;
    let mut stmt = conn
        .prepare(
            "SELECT email, password, name, remix_user_id, remix_user_key, downloads_today, downloads_limit
             FROM users WHERE email = ?1"
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let user = stmt
        .query_row(params![email], |row| {
            Ok(User {
                email: row.get(0)?,
                password: row.get(1)?,
                name: row.get(2)?,
                remix_user_id: row.get(3)?,
                remix_user_key: row.get(4)?,
                downloads_today: row.get(5)?,
                downloads_limit: row.get(6)?,
            })
        })
        .ok();

    Ok(user)
}

/// Delete a user by email
pub fn delete_user(email: &str) -> Result<(), String> {
    let conn = get_connection()?;
    conn.execute("DELETE FROM users WHERE email = ?1", params![email])
        .map_err(|e| format!("Failed to delete user: {}", e))?;
    Ok(())
}

// ===== Plugin outputs（插件加工记录）=====

/// 一条「某文件被插件加工过」的记录
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginOutput {
    /// 产出文件的绝对路径（主键：同一个产出只记一次）
    pub output_path: String,
    /// 源文件的绝对路径
    pub source_path: String,
    pub source_name: String,
    pub output_name: String,
    pub plugin_id: String,
    /// convert | ocr
    pub capability: String,
    /// 转换的目标格式；OCR 恒为 pdf
    pub target_format: Option<String>,
    pub created_at: Option<String>,
}

/// 记一次加工产出。同一路径重复产出（比如删掉再转一次）以最新为准。
pub fn add_plugin_output(out: &PluginOutput) -> Result<(), String> {
    let conn = get_connection()?;
    conn.execute(
        "INSERT OR REPLACE INTO plugin_outputs
         (output_path, source_path, source_name, output_name, plugin_id, capability, target_format, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)",
        params![
            out.output_path, out.source_path, out.source_name,
            out.output_name, out.plugin_id, out.capability, out.target_format,
        ],
    ).map_err(|e| format!("Failed to record plugin output: {}", e))?;
    Ok(())
}

/// 全部加工记录
pub fn get_plugin_outputs() -> Result<Vec<PluginOutput>, String> {
    let conn = get_connection()?;
    let mut stmt = conn
        .prepare(
            "SELECT output_path, source_path, source_name, output_name,
                    plugin_id, capability, target_format, created_at
             FROM plugin_outputs ORDER BY created_at DESC",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PluginOutput {
                output_path: row.get(0)?,
                source_path: row.get(1)?,
                source_name: row.get(2)?,
                output_name: row.get(3)?,
                plugin_id: row.get(4)?,
                capability: row.get(5)?,
                target_format: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query plugin outputs: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

/// 文件被删除时清掉相关记录——它既可能是某次加工的产出，也可能是源
pub fn remove_plugin_outputs_for_path(path: &str) -> Result<(), String> {
    let conn = get_connection()?;
    conn.execute(
        "DELETE FROM plugin_outputs WHERE output_path = ?1 OR source_path = ?1",
        params![path],
    )
    .map_err(|e| format!("Failed to remove plugin outputs: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 用内存库跑一遍建表 + 增删查，确保 schema 和 SQL 是对的
    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE plugin_outputs (
                output_path TEXT PRIMARY KEY,
                source_path TEXT NOT NULL,
                source_name TEXT NOT NULL,
                output_name TEXT NOT NULL,
                plugin_id TEXT NOT NULL,
                capability TEXT NOT NULL,
                target_format TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .unwrap();
        conn
    }

    fn insert(conn: &Connection, output: &str, source: &str, capability: &str) {
        conn.execute(
            "INSERT OR REPLACE INTO plugin_outputs
             (output_path, source_path, source_name, output_name, plugin_id, capability, target_format)
             VALUES (?1, ?2, 'src', 'out', 'p', ?3, 'pdf')",
            params![output, source, capability],
        )
        .unwrap();
    }

    #[test]
    fn same_output_recorded_twice_does_not_duplicate() {
        let conn = setup();
        insert(&conn, "/out.mobi", "/book.epub", "convert");
        insert(&conn, "/out.mobi", "/book.epub", "convert");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM plugin_outputs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "output_path is the primary key");
    }

    /// 删文件时，无论它是源还是产物，相关记录都要清掉——
    /// 否则书架上会留下指向已删文件的标记
    #[test]
    fn deleting_either_side_prunes_the_record() {
        let conn = setup();
        insert(&conn, "/scan-OCR.pdf", "/scan.pdf", "ocr");
        conn.execute(
            "DELETE FROM plugin_outputs WHERE output_path = ?1 OR source_path = ?1",
            params!["/scan.pdf"],
        )
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM plugin_outputs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "deleting the source must prune the record");

        insert(&conn, "/scan-OCR.pdf", "/scan.pdf", "ocr");
        conn.execute(
            "DELETE FROM plugin_outputs WHERE output_path = ?1 OR source_path = ?1",
            params!["/scan-OCR.pdf"],
        )
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM plugin_outputs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "deleting the output must prune the record too");
    }

    /// 一个源可以有多个产出（转成好几种格式），标记要能全都列出来
    #[test]
    fn one_source_can_have_many_outputs() {
        let conn = setup();
        insert(&conn, "/book.mobi", "/book.epub", "convert");
        insert(&conn, "/book.azw3", "/book.epub", "convert");
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM plugin_outputs WHERE source_path = ?1",
                params!["/book.epub"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 2);
    }
}

// ===== Favorites =====

/// Favorite book record
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FavoriteBook {
    pub book_id: String,
    pub user_email: String,
    pub hash: Option<String>,
    pub title: String,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub year: Option<i32>,
    pub language: Option<String>,
    pub extension: Option<String>,
    pub filesize: Option<i64>,
    pub cover: Option<String>,
    pub description: Option<String>,
    pub pages: Option<i32>,
    pub added_at: Option<String>,
}

/// Add a book to favorites
pub fn add_favorite(fav: &FavoriteBook) -> Result<(), String> {
    let conn = get_connection()?;
    conn.execute(
        "INSERT OR REPLACE INTO favorites
         (book_id, user_email, hash, title, author, publisher, year, language, extension, filesize, cover, description, pages, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, CURRENT_TIMESTAMP)",
        params![
            fav.book_id, fav.user_email, fav.hash, fav.title,
            fav.author, fav.publisher, fav.year, fav.language,
            fav.extension, fav.filesize, fav.cover, fav.description, fav.pages,
        ],
    ).map_err(|e| format!("Failed to add favorite: {}", e))?;
    Ok(())
}

/// 书单导入条目（LAN 推送 / 口令粘贴导入共用），只含 booklist 协议的基本字段
#[derive(Debug, Deserialize)]
pub struct BooklistImportEntry {
    pub id: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub hash: Option<String>,
}

/// 批量导入书单到收藏，按 (book_id, user_email) 去重。返回 (imported, skipped)
pub fn import_booklist(entries: Vec<BooklistImportEntry>, user_email: &str) -> (u32, u32) {
    let mut imported = 0u32;
    let mut skipped = 0u32;
    for entry in entries {
        if entry.id.trim().is_empty() {
            skipped += 1;
            continue;
        }
        match is_favorite(&entry.id, user_email) {
            Ok(false) => {}
            _ => {
                skipped += 1;
                continue;
            }
        }
        let fav = FavoriteBook {
            book_id: entry.id.clone(),
            user_email: user_email.to_string(),
            hash: entry.hash,
            title: entry.title.unwrap_or_else(|| entry.id.clone()),
            author: entry.author,
            publisher: None,
            year: None,
            language: None,
            extension: None,
            filesize: None,
            cover: None,
            description: None,
            pages: None,
            added_at: None,
        };
        match add_favorite(&fav) {
            Ok(()) => imported += 1,
            Err(e) => {
                log::warn!(
                    "booklist import: add favorite {} failed: {}",
                    fav.book_id,
                    e
                );
                skipped += 1;
            }
        }
    }
    (imported, skipped)
}

/// Remove a book from favorites
pub fn remove_favorite(book_id: &str, user_email: &str) -> Result<(), String> {
    let conn = get_connection()?;
    conn.execute(
        "DELETE FROM favorites WHERE book_id = ?1 AND user_email = ?2",
        params![book_id, user_email],
    )
    .map_err(|e| format!("Failed to remove favorite: {}", e))?;
    Ok(())
}

/// Get all favorites for a user
pub fn get_favorites(user_email: &str, page: i64, limit: i64) -> Result<Vec<FavoriteBook>, String> {
    let conn = get_connection()?;
    let offset = (page - 1) * limit;
    let mut stmt = conn
        .prepare(
            "SELECT book_id, user_email, hash, title, author, publisher, year, language,
                    extension, filesize, cover, description, pages, added_at
             FROM favorites WHERE user_email = ?1
             ORDER BY added_at DESC LIMIT ?2 OFFSET ?3",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let books = stmt
        .query_map(params![user_email, limit, offset], |row| {
            Ok(FavoriteBook {
                book_id: row.get(0)?,
                user_email: row.get(1)?,
                hash: row.get(2)?,
                title: row.get(3)?,
                author: row.get(4)?,
                publisher: row.get(5)?,
                year: row.get(6)?,
                language: row.get(7)?,
                extension: row.get(8)?,
                filesize: row.get(9)?,
                cover: row.get(10)?,
                description: row.get(11)?,
                pages: row.get(12)?,
                added_at: row.get(13)?,
            })
        })
        .map_err(|e| format!("Failed to query favorites: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(books)
}

/// Check if a book is in favorites
pub fn is_favorite(book_id: &str, user_email: &str) -> Result<bool, String> {
    let conn = get_connection()?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM favorites WHERE book_id = ?1 AND user_email = ?2",
            params![book_id, user_email],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to check favorite: {}", e))?;
    Ok(count > 0)
}

/// Batch check favorites status
pub fn check_favorites_batch(book_ids: &[String], user_email: &str) -> Result<Vec<String>, String> {
    let conn = get_connection()?;
    let placeholders: Vec<String> = book_ids
        .iter()
        .enumerate()
        .map(|(i, _)| format!("?{}", i + 2))
        .collect();
    let sql = format!(
        "SELECT book_id FROM favorites WHERE user_email = ?1 AND book_id IN ({})",
        placeholders.join(", ")
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params_vec.push(Box::new(user_email.to_string()));
    for id in book_ids {
        params_vec.push(Box::new(id.clone()));
    }
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();

    let result = stmt
        .query_map(params_refs.as_slice(), |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query favorites batch: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(result)
}
