use crate::config;
use crate::weread::WereadClient;

fn get_client() -> Result<WereadClient, String> {
    let cfg = config::get_config()?;
    if cfg.weread_api_key.is_empty() {
        return Err("未配置微信读书 API Key，请在设置中配置".to_string());
    }
    Ok(WereadClient::new(cfg.weread_api_key))
}

#[tauri::command]
pub async fn weread_get_stats() -> Result<serde_json::Value, String> {
    get_client()?.get_stats().await
}

#[tauri::command]
pub async fn weread_get_shelf() -> Result<serde_json::Value, String> {
    get_client()?.get_shelf().await
}

#[tauri::command]
pub async fn weread_get_notebooks() -> Result<serde_json::Value, String> {
    get_client()?.get_all_notebooks().await
}

#[tauri::command]
pub async fn weread_get_book_info(book_id: String) -> Result<serde_json::Value, String> {
    get_client()?.get_book_info(&book_id).await
}

#[tauri::command]
pub async fn weread_get_chapters(book_id: String) -> Result<serde_json::Value, String> {
    get_client()?.get_chapters(&book_id).await
}

#[tauri::command]
pub async fn weread_get_bookmarks(book_id: String) -> Result<serde_json::Value, String> {
    get_client()?.get_bookmarks(&book_id).await
}

#[tauri::command]
pub async fn weread_get_my_reviews(book_id: String) -> Result<serde_json::Value, String> {
    get_client()?.get_my_reviews(&book_id).await
}

#[tauri::command]
pub async fn weread_get_best_bookmarks(book_id: String) -> Result<serde_json::Value, String> {
    get_client()?.get_best_bookmarks(&book_id).await
}

#[tauri::command]
pub async fn weread_save_notes(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&path, content).map_err(|e| format!("保存笔记失败: {}", e))
}
