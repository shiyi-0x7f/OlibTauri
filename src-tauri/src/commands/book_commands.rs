use crate::{api::ZLibrary, config, database};
use std::path::PathBuf;

/// Cache file path for popular books
fn popular_books_cache_path() -> Result<PathBuf, String> {
    let cfg = config::get_config()?;
    let cache_dir = PathBuf::from(&cfg.cache_folder);
    if !cache_dir.exists() {
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    }
    Ok(cache_dir.join("popular_books_cache.json"))
}

/// Check if cache is fresh (less than 1 hour old)
fn is_cache_fresh(path: &PathBuf) -> bool {
    if let Ok(metadata) = std::fs::metadata(path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = modified.elapsed() {
                return elapsed.as_secs() < 3600; // 1 hour
            }
        }
    }
    false
}

/// Get most popular books (with file-based caching, 1 hour TTL)
#[tauri::command]
pub async fn get_popular_books(
    switch_language: Option<String>,
) -> Result<serde_json::Value, String> {
    // Try to serve from cache first
    if let Ok(cache_path) = popular_books_cache_path() {
        if cache_path.exists() && is_cache_fresh(&cache_path) {
            if let Ok(content) = tokio::fs::read_to_string(&cache_path).await {
                if let Ok(cached) = serde_json::from_str::<serde_json::Value>(&content) {
                    log::info!("📦 Popular books served from cache");
                    return Ok(cached);
                }
            }
        }
    }

    log::info!("📚 Fetching popular books from API");

    let cfg = config::get_config()?;
    let mut client = ZLibrary::new(cfg.host_index);

    // Try to use authenticated request if user is logged in
    if !cfg.user_email.is_empty() {
        if let Some(user) = database::get_user(&cfg.user_email)? {
            if let (Some(uid), Some(ukey)) = (&user.remix_user_id, &user.remix_user_key) {
                client.login_with_token(uid, ukey);
            }
        }
    }

    let result = client.get_most_popular(switch_language.as_deref()).await?;

    // Write to cache file
    if let Ok(cache_path) = popular_books_cache_path() {
        if let Ok(json_str) = serde_json::to_string(&result) {
            if let Err(e) = tokio::fs::write(&cache_path, &json_str).await {
                log::warn!("Failed to write popular books cache: {}", e);
            } else {
                log::info!("📦 Popular books cached to disk");
            }
        }
    }

    Ok(result)
}

/// Get recently uploaded books
#[tauri::command]
pub async fn get_recent_books() -> Result<serde_json::Value, String> {
    log::info!("🆕 Getting recent books");

    let cfg = config::get_config()?;
    let mut client = ZLibrary::new(cfg.host_index);

    // Try to use authenticated request if user is logged in
    if !cfg.user_email.is_empty() {
        if let Some(user) = database::get_user(&cfg.user_email)? {
            if let (Some(uid), Some(ukey)) = (&user.remix_user_id, &user.remix_user_key) {
                client.login_with_token(uid, ukey);
            }
        }
    }

    client.get_recently().await
}

/// Get recommended books (requires authentication)
#[tauri::command]
pub async fn get_recommended_books() -> Result<serde_json::Value, String> {
    log::info!("⭐ Getting recommended books");

    let cfg = config::get_config()?;

    if cfg.user_email.is_empty() {
        return Err("Authentication required. Please login first.".to_string());
    }

    let user =
        database::get_user(&cfg.user_email)?.ok_or("User not found in database".to_string())?;

    let (uid, ukey) = match (&user.remix_user_id, &user.remix_user_key) {
        (Some(id), Some(key)) => (id, key),
        _ => return Err("User credentials not available".to_string()),
    };

    let mut client = ZLibrary::new(cfg.host_index);
    client.login_with_token(uid, ukey);

    client.get_user_recommended().await
}

/// Get similar books for a given book
#[tauri::command]
pub async fn get_similar_books(
    book_id: String,
    hash_id: String,
) -> Result<serde_json::Value, String> {
    log::info!("🔗 Getting similar books for book_id: {}", book_id);

    let cfg = config::get_config()?;
    let mut client = ZLibrary::new(cfg.host_index);

    // Try to use authenticated request if user is logged in
    if !cfg.user_email.is_empty() {
        if let Some(user) = database::get_user(&cfg.user_email)? {
            if let (Some(uid), Some(ukey)) = (&user.remix_user_id, &user.remix_user_key) {
                client.login_with_token(uid, ukey);
            }
        }
    }

    client.get_similar(&book_id, &hash_id).await
}

/// Get other format editions of a book (each entry has its own id/hash)
#[tauri::command]
pub async fn get_book_formats(
    book_id: String,
    hash_id: String,
) -> Result<serde_json::Value, String> {
    log::info!("📄 Getting book formats for book_id: {}", book_id);

    let cfg = config::get_config()?;
    let mut client = ZLibrary::new(cfg.host_index);

    // Try to use authenticated request if user is logged in
    if !cfg.user_email.is_empty() {
        if let Some(user) = database::get_user(&cfg.user_email)? {
            if let (Some(uid), Some(ukey)) = (&user.remix_user_id, &user.remix_user_key) {
                client.login_with_token(uid, ukey);
            }
        }
    }

    client.get_book_formats(&book_id, &hash_id).await
}

/// Get download history (requires authentication)
#[tauri::command]
pub async fn get_download_history(
    order: Option<String>,
    page: Option<i64>,
    limit: Option<i64>,
) -> Result<serde_json::Value, String> {
    log::info!("📥 Getting download history");

    let cfg = config::get_config()?;

    if cfg.user_email.is_empty() {
        return Err("Authentication required. Please login first.".to_string());
    }

    let user =
        database::get_user(&cfg.user_email)?.ok_or("User not found in database".to_string())?;

    let (uid, ukey) = match (&user.remix_user_id, &user.remix_user_key) {
        (Some(id), Some(key)) => (id, key),
        _ => return Err("User credentials not available".to_string()),
    };

    let mut client = ZLibrary::new(cfg.host_index);
    client.login_with_token(uid, ukey);

    client
        .get_user_downloaded(order.as_deref(), page, limit)
        .await
}

/// Get book detail info
#[tauri::command]
pub async fn get_book_info(book_id: String, hash_id: String) -> Result<serde_json::Value, String> {
    log::info!("📖 Getting book info for book_id: {}", book_id);

    let cfg = config::get_config()?;
    let mut client = ZLibrary::new(cfg.host_index);

    if !cfg.user_email.is_empty() {
        if let Some(user) = database::get_user(&cfg.user_email)? {
            if let (Some(uid), Some(ukey)) = (&user.remix_user_id, &user.remix_user_key) {
                client.login_with_token(uid, ukey);
            }
        }
    }

    client.get_book_info(&book_id, &hash_id).await
}
