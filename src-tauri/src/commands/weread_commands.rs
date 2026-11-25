use crate::weread::{api, ask, import, qr_login, recommend, session};
use serde::Serialize;

#[derive(Serialize)]
pub struct WereadStatus {
    connected: bool,
    vid: Option<String>,
}

#[tauri::command]
pub fn weread_status() -> WereadStatus {
    let current = session::current();
    WereadStatus {
        connected: current.is_some(),
        vid: current.map(|s| s.vid),
    }
}

#[tauri::command]
pub async fn weread_qr_start() -> Result<qr_login::QrStart, String> {
    qr_login::start().await
}

#[tauri::command]
pub async fn weread_qr_poll(uuid: String, last: Option<i64>) -> Result<qr_login::QrPoll, String> {
    qr_login::poll(&uuid, last).await
}

#[tauri::command]
pub fn weread_disconnect() -> Result<(), String> {
    session::clear()
}

#[tauri::command]
pub async fn weread_get_stats() -> Result<serde_json::Value, String> {
    api::stats().await
}

#[tauri::command]
pub async fn weread_get_shelf() -> Result<serde_json::Value, String> {
    let diagnostic = std::env::var_os("OLIB_WEREAD_DIAG_UPLOAD").is_some();
    if diagnostic {
        import::diag_known_payload().await;
    }
    let shelf = api::shelf().await?;
    // [诊断] 书架上的导入书（CB_）原始数据
    if let Some(obj) = shelf.as_object().filter(|_| diagnostic) {
        log::info!("[诊断] shelf 顶层键: {:?}", obj.keys().collect::<Vec<_>>());
        for (key, value) in obj {
            if let Some(items) = value.as_array() {
                for item in items {
                    let text = item.to_string();
                    if text.contains("CB_") {
                        log::info!("[诊断] shelf.{} 导入项: {}", key, text);
                    }
                }
            }
        }
    }
    Ok(shelf)
}

/// 指定周期阅读统计：mode = weekly | monthly | annually | overall
#[tauri::command]
pub async fn weread_read_data(
    mode: String,
    base_time: Option<i64>,
) -> Result<serde_json::Value, String> {
    api::read_data(&mode, base_time).await
}

#[tauri::command]
pub async fn weread_get_notebooks() -> Result<serde_json::Value, String> {
    api::all_notebooks().await
}

#[tauri::command]
pub async fn weread_get_book_info(book_id: String) -> Result<serde_json::Value, String> {
    api::book_info(&book_id).await
}

#[tauri::command]
pub async fn weread_get_chapters(book_id: String) -> Result<serde_json::Value, String> {
    api::chapters(&book_id).await
}

#[tauri::command]
pub async fn weread_get_bookmarks(book_id: String) -> Result<serde_json::Value, String> {
    api::bookmarks(&book_id).await
}

#[tauri::command]
pub async fn weread_get_my_reviews(book_id: String) -> Result<serde_json::Value, String> {
    api::my_reviews(&book_id).await
}

#[tauri::command]
pub async fn weread_get_best_bookmarks(book_id: String) -> Result<serde_json::Value, String> {
    api::best_bookmarks(&book_id).await
}

/// 「为你推荐」下一批；`refresh` 时重读书架重建推荐池。
#[tauri::command]
pub async fn weread_recommend_next(
    count: usize,
    refresh: bool,
) -> Result<recommend::Batch, String> {
    recommend::next_batch(count, refresh).await
}

/// 详情弹窗相似书分页；首页 `max_idx = 0`、不带 `session_id`。
#[tauri::command]
pub async fn weread_similar_books(
    book_id: String,
    max_idx: i64,
    session_id: Option<String>,
) -> Result<recommend::SimilarPage, String> {
    let page = api::similar_page(&book_id, max_idx, session_id.as_deref(), 12).await?;
    Ok(recommend::normalize_similar(&page, max_idx))
}

/// AI 建议问题 + 工具栏快捷提问。
#[tauri::command]
pub async fn weread_ai_suggestions(
    book_id: String,
    chapter_uid: Option<i64>,
) -> Result<ask::Suggestions, String> {
    ask::suggestions(&book_id, chapter_uid.unwrap_or(0)).await
}

/// 开始 AI 问书，返回 ask_id；回答经 `weread-ask` 事件逐帧推送。
#[tauri::command]
pub fn weread_ai_ask(
    app: tauri::AppHandle,
    book_id: String,
    query: String,
    intent: Option<String>,
) -> Result<u64, String> {
    ask::start(app, book_id, query, intent.unwrap_or_default())
}

#[tauri::command]
pub fn weread_ai_cancel(ask_id: u64) {
    ask::cancel(ask_id);
}

/// 导入本机书籍到微信读书书架；上传进度经 `weread-import` 事件推送。
#[tauri::command]
pub async fn weread_import_book(
    app: tauri::AppHandle,
    path: String,
) -> Result<import::ImportResult, String> {
    import::import_book(app, path).await
}

#[tauri::command]
pub async fn weread_save_notes(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("保存笔记失败: {}", e))
}
