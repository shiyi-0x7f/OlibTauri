use crate::{api::ZLibrary, config, database, download, download_records};
use std::path::Path;
use tauri::Emitter;

#[tauri::command]
pub async fn download_book(
    app_handle: tauri::AppHandle,
    book_id: String,
    hash_id: String,
    title: String,
    extension: String,
    author: Option<String>,
    cover: Option<String>,
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
    // 取链失败也要走下方统一的通知分支，故不用 `?` 提前返回。
    let prefetched: Result<Option<String>, String> = Ok(None);

    let result = match prefetched {
        Ok(prefetched) => {
            download::download_book(
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
            .await
        }
        Err(e) => Err(e),
    };

    // 通知只发「下载完成」；转交外部工具与失败（含额度用尽）由发起下载的页面提示，
    // 这样不受「下载通知」开关影响，也不会与页面提示重复。
    match &result {
        Ok(result_str) if result_str.starts_with("dispatched:") => {
            log::info!("📤 Download dispatched to external tool: {}", result_str);
        }
        Ok(filename) => {
            log::info!("✅ Download completed: {}", filename);
            if cfg.notify_on_download {
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
        Err(e) if e.starts_with(download::LIMIT_PREFIX) => {
            log::warn!("⛔ Download limit reached: {}", e);
        }
        Err(e) => log::error!("❌ Download failed: {}", e),
    }

    if let Ok(result_str) = &result {
        // 成功返回文件名；转交外部工具返回 "dispatched:<method>:<文件名或链接>"
        let (method, file_name) = match result_str.strip_prefix("dispatched:") {
            Some(rest) => rest.split_once(':').unwrap_or((rest, "")),
            None => ("builtin", result_str.as_str()),
        };
        // 内置 / IDM / Motrix 落在下载目录；浏览器与复制链接无从得知文件位置
        let file_path = matches!(method, "builtin" | "idm" | "motrix")
            .then(|| Path::new(&cfg.download_folder).join(file_name))
            .map(|p| p.to_string_lossy().to_string());
        let record = download_records::NewRecord {
            book_id: &book_id,
            hash: Some(hash_id.as_str()).filter(|h| !h.is_empty()),
            title: &title,
            author: author.as_deref().filter(|a| !a.is_empty()),
            extension: Some(extension.as_str()).filter(|e| !e.is_empty()),
            cover: cover.as_deref().filter(|c| !c.is_empty()),
            method,
            file_path,
        };
        if let Err(e) = download_records::record(&record) {
            log::warn!("⚠️ Failed to record download history: {}", e);
        }
    }

    result
}

#[tauri::command]
pub async fn list_download_records() -> Result<Vec<download_records::DownloadRecord>, String> {
    download_records::list()
}

#[tauri::command]
pub async fn delete_download_record(book_id: String) -> Result<(), String> {
    download_records::delete(&book_id)
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
