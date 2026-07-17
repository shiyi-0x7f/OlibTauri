use crate::{api::ZLibrary, config, database, download};
use tauri::Emitter;

#[tauri::command]
pub async fn download_book(
    app_handle: tauri::AppHandle,
    book_id: String,
    hash_id: String,
    title: String,
    extension: String,
) -> Result<String, String> {
    log::info!(
        "📥 download_book called - ID: {}, Title: {}",
        book_id,
        title
    );
    log::debug!(
        "Download params - hash_id: {}, extension: {}",
        hash_id,
        extension
    );

    let cfg = config::get_config()?;
    log::info!("📁 Download folder: {}", cfg.download_folder);

    // Determine download method: use new field, fallback to legacy download_with_browser
    let download_method = if !cfg.download_method.is_empty() {
        cfg.download_method.clone()
    } else if cfg.download_with_browser {
        "browser".to_string()
    } else {
        "builtin".to_string()
    };
    log::info!(
        "⚙️  Skip duplicates: {}, Download method: {}",
        cfg.skip_duplicate_files,
        download_method
    );

    // Get user credentials
    let user = if !cfg.user_email.is_empty() {
        log::info!("👤 Loading user: {}", cfg.user_email);
        database::get_user(&cfg.user_email)?
    } else {
        log::warn!("⚠️  No user configured for download");
        None
    };

    let mut client = ZLibrary::new(cfg.host_index);
    log::info!(
        "🌐 Created ZLibrary client with host index: {}",
        cfg.host_index
    );

    if let Some(user) = &user {
        if let (Some(uid), Some(ukey)) = (&user.remix_user_id, &user.remix_user_key) {
            log::info!("🔐 Using authentication for download");
            client.login_with_token(uid, ukey);
        } else {
            log::warn!("⚠️  User has no remix credentials");
        }
    }

    log::info!("🚀 Starting download process...");

    // 预取下载 URL（标准版恒为 None，走 Z-Library 取链）。
    let prefetched: Option<String> = None;

    let result = download::download_book(
        &client,
        &book_id,
        &hash_id,
        &title,
        &extension,
        &cfg.download_folder,
        cfg.skip_duplicate_files,
        &download_method,
        prefetched,
    )
    .await;

    // Send system notification if enabled
    if cfg.notify_on_download {
        match &result {
            Ok(result_str) => {
                if result_str.starts_with("dispatched:") {
                    log::info!("📤 Download dispatched to external tool: {}", result_str);
                    let _ = app_handle.emit(
                        "download-status",
                        serde_json::json!({
                            "status": "dispatched",
                            "title": title,
                            "message": format!("《{}》已转交外部工具下载", title)
                        }),
                    );
                } else {
                    log::info!("✅ Download completed: {}", result_str);
                    let _ = app_handle.emit(
                        "download-status",
                        serde_json::json!({
                            "status": "success",
                            "title": title,
                            "message": format!("《{}》已下载完成", title)
                        }),
                    );
                }
            }
            Err(e) => {
                log::error!("❌ Download failed: {}", e);
                let _ = app_handle.emit(
                    "download-status",
                    serde_json::json!({
                        "status": "error",
                        "title": title,
                        "message": format!("《{}》下载失败: {}", title, e)
                    }),
                );
            }
        }
    } else {
        match &result {
            Ok(filename) => log::info!("✅ Download completed: {}", filename),
            Err(e) => log::error!("❌ Download failed: {}", e),
        }
    }

    result
}

#[tauri::command]
pub async fn cancel_download(book_id: String) -> Result<(), String> {
    download::cancel(&book_id);
    Ok(())
}

#[tauri::command]
pub async fn get_download_progress(
    book_id: String,
) -> Result<Option<download::DownloadProgress>, String> {
    Ok(download::get_progress(&book_id))
}

#[tauri::command]
pub async fn get_all_downloads() -> Result<Vec<download::DownloadProgress>, String> {
    Ok(download::get_all_progress())
}

#[tauri::command]
pub async fn delete_download(book_id: String) -> Result<(), String> {
    download::remove_download(&book_id);
    Ok(())
}
