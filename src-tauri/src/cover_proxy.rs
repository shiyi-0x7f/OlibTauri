use crate::util::LockExt;
use axum::{
    extract::{Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::Mutex as TokioMutex;

/// Allocated proxy port (set once on startup)
static PROXY_PORT: Mutex<u16> = Mutex::new(0);

/// Cover cache directory
static COVER_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Per-book download locks to prevent duplicate concurrent downloads
static DOWNLOAD_LOCKS: Lazy<TokioMutex<HashMap<String, ()>>> =
    Lazy::new(|| TokioMutex::new(HashMap::new()));

/// Maximum cache size in bytes (200 MB)
const MAX_CACHE_SIZE: u64 = 200 * 1024 * 1024;

/// Get the allocated proxy port
pub fn get_port() -> u16 {
    *PROXY_PORT.lock_ignore_poison()
}

/// Start the cover proxy server on a random available port
pub async fn start(cover_dir: PathBuf) -> Result<u16, String> {
    // Store cover dir
    std::fs::create_dir_all(&cover_dir)
        .map_err(|e| format!("Failed to create covers directory: {}", e))?;
    *COVER_DIR.lock_ignore_poison() = Some(cover_dir);

    let app = Router::new().route("/cover/{book_id}", get(serve_cover));

    // Bind to random available port on localhost only
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind cover proxy: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local addr: {}", e))?
        .port();

    *PROXY_PORT.lock_ignore_poison() = port;

    // Spawn the server
    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .unwrap_or_else(|e| log::error!("Cover proxy server error: {}", e));
    });

    log::info!("📷 Cover proxy started on 127.0.0.1:{}", port);
    Ok(port)
}

#[derive(serde::Deserialize)]
struct CoverQuery {
    url: Option<String>,
}

/// Serve a cover image: check disk cache first, download if needed
async fn serve_cover(Path(book_id): Path<String>, Query(query): Query<CoverQuery>) -> Response {
    // Validate book_id (prevent path traversal)
    if book_id.contains("..") || book_id.contains('/') || book_id.contains('\\') {
        return (StatusCode::BAD_REQUEST, "Invalid book ID").into_response();
    }

    let cover_dir = match COVER_DIR.lock_ignore_poison().clone() {
        Some(dir) => dir,
        None => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Cover cache not initialized",
            )
                .into_response()
        }
    };

    let file_path = cover_dir.join(format!("{}.jpg", book_id));

    // Check disk cache first
    if file_path.exists() {
        if let Ok(bytes) = tokio::fs::read(&file_path).await {
            // Update access time (best-effort, don't fail the request)
            let _ = update_atime(&file_path);

            return (
                [
                    (header::CONTENT_TYPE, "image/jpeg".to_string()),
                    (
                        header::CACHE_CONTROL,
                        "public, max-age=86400, immutable".to_string(),
                    ),
                    (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
                ],
                bytes,
            )
                .into_response();
        }
    }

    // Need to download - get the remote URL
    let remote_url = match query.url {
        Some(url) if !url.is_empty() => url,
        _ => {
            return (
                StatusCode::NOT_FOUND,
                "No cover URL provided and not cached",
            )
                .into_response()
        }
    };

    // Use per-book lock to prevent duplicate downloads for the same book
    {
        let locks = DOWNLOAD_LOCKS.lock().await;
        if locks.contains_key(&book_id) {
            // Another task is downloading this - wait briefly then check disk
            drop(locks);
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            if file_path.exists() {
                if let Ok(bytes) = tokio::fs::read(&file_path).await {
                    return (
                        [
                            (header::CONTENT_TYPE, "image/jpeg".to_string()),
                            (
                                header::CACHE_CONTROL,
                                "public, max-age=86400, immutable".to_string(),
                            ),
                            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
                        ],
                        bytes,
                    )
                        .into_response();
                }
            }
            // Fall through to download ourselves
        }
    }
    // Mark as in-flight
    {
        let mut locks = DOWNLOAD_LOCKS.lock().await;
        locks.insert(book_id.clone(), ());
    }

    // Download the image
    let result = download_and_cache(&remote_url, &book_id, &cover_dir).await;

    // Release the download lock
    {
        let mut locks = DOWNLOAD_LOCKS.lock().await;
        locks.remove(&book_id);
    }

    match result {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "image/jpeg".to_string()),
                (
                    header::CACHE_CONTROL,
                    "public, max-age=86400, immutable".to_string(),
                ),
                (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
            ],
            bytes,
        )
            .into_response(),
        Err(e) => {
            log::warn!("Failed to download cover for {}: {}", book_id, e);
            (StatusCode::BAD_GATEWAY, format!("Download failed: {}", e)).into_response()
        }
    }
}

/// Download a cover image and save to disk cache
async fn download_and_cache(
    url: &str,
    book_id: &str,
    cover_dir: &std::path::Path,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("Download error: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read error: {}", e))?;

    if bytes.is_empty() {
        return Err("Empty response".to_string());
    }

    let data = bytes.to_vec();

    // Save to disk (async, best-effort)
    let file_path = cover_dir.join(format!("{}.jpg", book_id));
    if let Err(e) = tokio::fs::write(&file_path, &data).await {
        log::warn!("Failed to cache cover to disk for {}: {}", book_id, e);
        // Still return the bytes even if disk write fails
    } else {
        log::debug!("📷 Cached cover: {} ({} bytes)", book_id, data.len());
        // Best-effort eviction check (don't block the response)
        let dir = cover_dir.to_path_buf();
        tokio::spawn(async move {
            let _ = evict_if_needed(&dir).await;
        });
    }

    Ok(data)
}

/// Update file access time by touching the file
fn update_atime(path: &std::path::Path) -> Result<(), String> {
    // Touch the file to update mtime (used for LRU eviction)
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    file.set_modified(std::time::SystemTime::UNIX_EPOCH + now)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Evict oldest files if cache exceeds the size limit (uses file mtime for LRU)
async fn evict_if_needed(cover_dir: &std::path::Path) -> Result<(), String> {
    let mut entries: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total_size: u64 = 0;

    let mut dir = tokio::fs::read_dir(cover_dir)
        .await
        .map_err(|e| e.to_string())?;

    while let Ok(Some(entry)) = dir.next_entry().await {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("jpg") {
            if let Ok(meta) = entry.metadata().await {
                let size = meta.len();
                let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                total_size += size;
                entries.push((path, size, mtime));
            }
        }
    }

    if total_size <= MAX_CACHE_SIZE {
        return Ok(());
    }

    // Sort by mtime ascending (oldest first)
    entries.sort_by_key(|(_, _, mtime)| *mtime);

    for (path, size, _) in entries {
        if total_size <= MAX_CACHE_SIZE {
            break;
        }
        if tokio::fs::remove_file(&path).await.is_ok() {
            total_size -= size;
            log::debug!("🗑️ Evicted cover: {:?}", path.file_name());
        }
    }

    Ok(())
}

/// Get cache statistics (total size in bytes, file count)
pub fn get_cache_stats() -> Result<(u64, usize), String> {
    let cover_dir = COVER_DIR
        .lock()
        .unwrap()
        .clone()
        .ok_or("Cover cache not initialized")?;

    let mut total_size: u64 = 0;
    let mut count: usize = 0;

    if let Ok(entries) = std::fs::read_dir(&cover_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("jpg") {
                if let Ok(meta) = std::fs::metadata(&path) {
                    total_size += meta.len();
                    count += 1;
                }
            }
        }
    }

    Ok((total_size, count))
}

/// Clear all cached cover images
pub fn clear_cache() -> Result<(), String> {
    let cover_dir = COVER_DIR
        .lock()
        .unwrap()
        .clone()
        .ok_or("Cover cache not initialized")?;

    if let Ok(entries) = std::fs::read_dir(&cover_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("jpg") {
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    log::info!("🗑️ Cover cache cleared");
    Ok(())
}
