use crate::{config, database};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct AddFavoriteParams {
    pub book_id: String,
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
}

#[tauri::command]
pub async fn add_favorite(params: AddFavoriteParams) -> Result<(), String> {
    let cfg = config::get_config()?;
    if cfg.user_email.is_empty() {
        return Err("请先登录".to_string());
    }

    let fav = database::FavoriteBook {
        book_id: params.book_id,
        user_email: cfg.user_email,
        hash: params.hash,
        title: params.title,
        author: params.author,
        publisher: params.publisher,
        year: params.year,
        language: params.language,
        extension: params.extension,
        filesize: params.filesize,
        cover: params.cover,
        description: params.description,
        pages: params.pages,
        added_at: None,
    };

    database::add_favorite(&fav)?;
    log::info!("⭐ Added favorite: {}", fav.title);
    Ok(())
}

#[tauri::command]
pub async fn remove_favorite(book_id: String) -> Result<(), String> {
    let cfg = config::get_config()?;
    if cfg.user_email.is_empty() {
        return Err("请先登录".to_string());
    }
    database::remove_favorite(&book_id, &cfg.user_email)?;
    log::info!("💔 Removed favorite: {}", book_id);
    Ok(())
}

#[tauri::command]
pub async fn get_favorites(
    page: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<database::FavoriteBook>, String> {
    let cfg = config::get_config()?;
    if cfg.user_email.is_empty() {
        return Err("请先登录".to_string());
    }
    let p = page.unwrap_or(1);
    let l = limit.unwrap_or(50);
    database::get_favorites(&cfg.user_email, p, l)
}

#[tauri::command]
pub async fn is_favorite(book_id: String) -> Result<bool, String> {
    let cfg = config::get_config()?;
    if cfg.user_email.is_empty() {
        return Ok(false);
    }
    database::is_favorite(&book_id, &cfg.user_email)
}

#[tauri::command]
pub async fn check_favorites_batch(book_ids: Vec<String>) -> Result<Vec<String>, String> {
    let cfg = config::get_config()?;
    if cfg.user_email.is_empty() {
        return Ok(vec![]);
    }
    if book_ids.is_empty() {
        return Ok(vec![]);
    }
    database::check_favorites_batch(&book_ids, &cfg.user_email)
}
