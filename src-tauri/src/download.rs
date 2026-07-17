use futures_util::StreamExt;
use log;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::io::AsyncWriteExt;

/// Maximum retry attempts for transient download errors
const MAX_RETRY_ATTEMPTS: u32 = 3;

/// Download task status
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub book_id: String,
    pub title: String,
    pub progress: f64,   // 0.0 - 100.0
    pub speed_kbps: f64, // KB/s
    pub status: DownloadStatus,
    pub error: Option<String>,
    #[serde(default)]
    pub downloaded_bytes: u64, // bytes downloaded so far
    #[serde(default)]
    pub total_bytes: u64, // total file size in bytes
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Completed,
    Failed,
    Cancelled,
    /// Task was dispatched to an external tool (browser/IDM/Motrix/clipboard)
    Dispatched,
}

/// Global download state
static DOWNLOADS: Mutex<Option<HashMap<String, DownloadProgress>>> = Mutex::new(None);
static CANCEL_FLAGS: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);

/// Initialize download manager
pub fn init() {
    *DOWNLOADS.lock().unwrap() = Some(HashMap::new());
    *CANCEL_FLAGS.lock().unwrap() = Some(HashMap::new());
}

/// Get download progress for a specific book
pub fn get_progress(book_id: &str) -> Option<DownloadProgress> {
    let downloads = DOWNLOADS.lock().unwrap();
    downloads.as_ref()?.get(book_id).cloned()
}

/// Get all download progresses
pub fn get_all_progress() -> Vec<DownloadProgress> {
    let downloads = DOWNLOADS.lock().unwrap();
    downloads
        .as_ref()
        .map(|d| d.values().cloned().collect())
        .unwrap_or_default()
}

/// Remove a download from tracking
pub fn remove_download(book_id: &str) {
    let mut downloads = DOWNLOADS.lock().unwrap();
    if let Some(map) = downloads.as_mut() {
        map.remove(book_id);
    }
    let mut flags = CANCEL_FLAGS.lock().unwrap();
    if let Some(map) = flags.as_mut() {
        map.remove(book_id);
    }
}

/// Update download progress
fn update_progress(book_id: &str, progress: DownloadProgress) {
    let mut downloads = DOWNLOADS.lock().unwrap();
    if let Some(map) = downloads.as_mut() {
        map.insert(book_id.to_string(), progress);
    }
}

/// Set cancel flag for a download
pub fn cancel(book_id: &str) {
    let mut flags = CANCEL_FLAGS.lock().unwrap();
    if let Some(map) = flags.as_mut() {
        map.insert(book_id.to_string(), true);
    }
    log::info!("🛑 Cancel flag set for book: {}", book_id);
}

/// Check if cancelled
fn is_cancelled(book_id: &str) -> bool {
    let flags = CANCEL_FLAGS.lock().unwrap();
    flags
        .as_ref()
        .map(|m| m.get(book_id).copied().unwrap_or(false))
        .unwrap_or(false)
}

/// Check for duplicate files
fn check_duplicate(dir: &str, filename: &str) -> bool {
    let path = PathBuf::from(dir).join(filename);
    path.exists()
}

/// Sanitize filename
fn sanitize_filename(name: &str) -> String {
    let invalid_chars = [
        '/', '\\', ':', '*', '?', '"', '<', '>', '|', '&', '#', '!', '@', '=',
    ];
    name.chars()
        .filter(|c| !invalid_chars.contains(c))
        .collect()
}

/// Mark a download as failed with an error message
fn mark_failed(book_id: &str, filename: &str, error: &str) {
    log::error!("❌ Download failed for {}: {}", book_id, error);
    update_progress(
        book_id,
        DownloadProgress {
            book_id: book_id.to_string(),
            title: filename.to_string(),
            progress: 0.0,
            speed_kbps: 0.0,
            status: DownloadStatus::Failed,
            error: Some(error.to_string()),
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );
}

/// Translate common download errors to user-friendly Chinese messages
fn translate_error(error: &str) -> String {
    if error.contains("error decoding response body") {
        "下载传输中断，网络连接不稳定".to_string()
    } else if error.contains("Please login") || error.contains("未登录") {
        "未登录，请先在设置页面登录账号后再下载".to_string()
    } else if error.contains("connection") && error.contains("reset") {
        "服务器连接被重置，请稍后重试".to_string()
    } else if error.contains("timeout") || error.contains("timed out") {
        "下载超时，请检查网络连接".to_string()
    } else if error.contains("allowDownload") {
        error.to_string() // Keep original for download limit detection
    } else {
        format!("下载失败: {}", error)
    }
}

/// Download a book to disk
/// `download_method`: "builtin", "browser", "idm", "motrix", "copy_url"
pub async fn download_book(
    client: &crate::api::ZLibrary,
    book_id: &str,
    hash_id: &str,
    title: &str,
    extension: &str,
    download_dir: &str,
    skip_duplicates: bool,
    download_method: &str,
    prefetched_url: Option<String>,
) -> Result<String, String> {
    log::info!(
        "📦 download_book - title: {}, extension: {}, method: {}",
        title,
        extension,
        download_method
    );
    log::debug!(
        "Download dir: {}, skip_duplicates: {}",
        download_dir,
        skip_duplicates
    );

    // Initialize if needed (safety net in case init() wasn't called)
    {
        let mut downloads = DOWNLOADS.lock().unwrap();
        if downloads.is_none() {
            log::debug!("Initializing downloads map");
            *downloads = Some(HashMap::new());
        }
        let mut flags = CANCEL_FLAGS.lock().unwrap();
        if flags.is_none() {
            log::debug!("Initializing cancel flags map");
            *flags = Some(HashMap::new());
        }
    }

    let clean_title = sanitize_filename(title);
    let filename = format!("{}.{}", clean_title, extension);
    log::info!("📄 Sanitized filename: {}", filename);

    // Check duplicates (only for builtin download)
    if download_method == "builtin" && check_duplicate(download_dir, &filename) {
        log::warn!("⚠️  File already exists: {}", filename);
        if skip_duplicates {
            log::info!("⏭️  Skipping duplicate file");
            return Err("文件已存在，已跳过下载".to_string());
        }
        // If not skipping, add timestamp to filename
        let timestamp = chrono::Utc::now().timestamp();
        let filename = format!("{}_{}.{}", clean_title, timestamp, extension);
        log::info!("🔄 Using timestamped filename: {}", filename);
        return do_download(
            client,
            book_id,
            hash_id,
            &filename,
            download_dir,
            download_method,
            prefetched_url,
        )
        .await;
    }

    do_download(
        client,
        book_id,
        hash_id,
        &filename,
        download_dir,
        download_method,
        prefetched_url,
    )
    .await
}

async fn do_download(
    client: &crate::api::ZLibrary,
    book_id: &str,
    _hash_id: &str,
    filename: &str,
    download_dir: &str,
    download_method: &str,
    prefetched_url: Option<String>,
) -> Result<String, String> {
    log::info!(
        "⬇️  do_download - book_id: {}, filename: {}, method: {}",
        book_id,
        filename,
        download_method
    );

    // Set initial progress
    log::debug!("Setting initial progress to Pending");
    update_progress(
        book_id,
        DownloadProgress {
            book_id: book_id.to_string(),
            title: filename.to_string(),
            progress: 0.0,
            speed_kbps: 0.0,
            status: DownloadStatus::Pending,
            error: None,
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );

    // Get download URL（若上层已预取则直接用，跳过 Z-Library 取链）
    log::info!("🔗 Resolving download URL...");
    let download_url = match prefetched_url {
        Some(url) => url,
        None => match client.get_download_url(book_id, _hash_id).await {
            Ok(url) => url,
            Err(e) => {
                let user_error = translate_error(&e);
                mark_failed(book_id, filename, &user_error);
                return Err(user_error);
            }
        },
    };
    log::info!("✅ Got download URL: {}", download_url);

    // Handle external download methods
    match download_method {
        "browser" => {
            return do_download_external_browser(book_id, filename, &download_url).await;
        }
        "idm" => {
            return do_download_external_idm(book_id, filename, &download_url, download_dir).await;
        }
        "motrix" => {
            return do_download_external_motrix(book_id, filename, &download_url, download_dir)
                .await;
        }
        "copy_url" => {
            return do_download_copy_url(book_id, filename, &download_url).await;
        }
        _ => {} // "builtin" — continue below
    }

    // Create directory if needed
    log::info!("📁 Ensuring download directory exists: {}", download_dir);
    if let Err(e) = std::fs::create_dir_all(download_dir) {
        let error_msg = format!("无法创建下载目录: {}", e);
        mark_failed(book_id, filename, &error_msg);
        return Err(error_msg);
    }

    // === reqwest streaming download ===
    // Uses native TLS (SChannel on Windows) which has a browser-like TLS fingerprint,
    // providing much better download speeds than external download managers.
    log::info!("🚀 Using reqwest native download");
    let file_path = PathBuf::from(download_dir).join(filename);
    log::info!("💾 Target file path: {:?}", file_path);

    // Retry loop for transient download errors
    let mut last_error = String::new();
    for attempt in 1..=MAX_RETRY_ATTEMPTS {
        if attempt > 1 {
            log::info!(
                "🔄 Retry attempt {}/{} for book_id: {}",
                attempt,
                MAX_RETRY_ATTEMPTS,
                book_id
            );
            update_progress(
                book_id,
                DownloadProgress {
                    book_id: book_id.to_string(),
                    title: filename.to_string(),
                    progress: 0.0,
                    speed_kbps: 0.0,
                    status: DownloadStatus::Downloading,
                    error: Some(format!("正在重试 ({}/{})...", attempt, MAX_RETRY_ATTEMPTS)),
                    downloaded_bytes: 0,
                    total_bytes: 0,
                },
            );
            // Wait a bit before retrying
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }

        // Check cancel before each attempt
        if is_cancelled(book_id) {
            // Clean up any partial file from a previous attempt
            tokio::fs::remove_file(&file_path).await.ok();
            update_progress(
                book_id,
                DownloadProgress {
                    book_id: book_id.to_string(),
                    title: filename.to_string(),
                    progress: 0.0,
                    speed_kbps: 0.0,
                    status: DownloadStatus::Cancelled,
                    error: None,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                },
            );
            return Err("Download cancelled".to_string());
        }

        match do_download_stream(client, book_id, filename, &download_url, &file_path).await {
            Ok(_) => {
                // Download succeeded
                update_progress(
                    book_id,
                    DownloadProgress {
                        book_id: book_id.to_string(),
                        title: filename.to_string(),
                        progress: 100.0,
                        speed_kbps: 0.0,
                        status: DownloadStatus::Completed,
                        error: None,
                        downloaded_bytes: 0,
                        total_bytes: 0,
                    },
                );
                log::info!("✅ Download completed: {}", filename);
                return Ok(filename.to_string());
            }
            Err(e) => {
                last_error = e.clone();
                log::warn!(
                    "⚠️  Download attempt {}/{} failed: {}",
                    attempt,
                    MAX_RETRY_ATTEMPTS,
                    e
                );

                // Clean up partial file
                tokio::fs::remove_file(&file_path).await.ok();

                // Don't retry for non-transient errors (login required, limit reached, etc.)
                if e.contains("未登录")
                    || e.contains("Please login")
                    || e.contains("allowDownload")
                    || e.contains("cancelled")
                {
                    let user_error = translate_error(&e);
                    mark_failed(book_id, filename, &user_error);
                    return Err(user_error);
                }

                // For the last attempt, mark as failed
                if attempt == MAX_RETRY_ATTEMPTS {
                    let user_error = translate_error(&e);
                    mark_failed(book_id, filename, &user_error);
                    return Err(user_error);
                }
            }
        }
    }

    // Should not reach here, but just in case
    let user_error = translate_error(&last_error);
    mark_failed(book_id, filename, &user_error);
    Err(user_error)
}

/// Inner stream download logic (separated for retry)
async fn do_download_stream(
    client: &crate::api::ZLibrary,
    book_id: &str,
    filename: &str,
    download_url: &str,
    file_path: &PathBuf,
) -> Result<(), String> {
    // Start download
    log::info!("🚀 Starting file download...");
    update_progress(
        book_id,
        DownloadProgress {
            book_id: book_id.to_string(),
            title: filename.to_string(),
            progress: 0.0,
            speed_kbps: 0.0,
            status: DownloadStatus::Downloading,
            error: None,
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );

    log::debug!("📡 Making download request...");
    let response = client.download_file(download_url).await.map_err(|e| {
        log::error!("❌ Download request failed: {}", e);
        format!("Download request failed: {}", e)
    })?;
    let total_size = response.content_length().unwrap_or(0);
    log::info!(
        "📊 Total file size: {} bytes ({:.2} MB)",
        total_size,
        total_size as f64 / 1024.0 / 1024.0
    );

    let mut downloaded: u64 = 0;
    let start_time = std::time::Instant::now();

    log::debug!("📝 Creating file: {:?}", file_path);
    let mut file = tokio::fs::File::create(file_path).await.map_err(|e| {
        log::error!("❌ Failed to create file: {}", e);
        format!("Failed to create file: {}", e)
    })?;

    let mut stream = response.bytes_stream();
    log::info!("⏬ Starting to read response stream...");

    let mut chunk_count = 0;
    while let Some(chunk_result) = stream.next().await {
        // Check cancel
        if is_cancelled(book_id) {
            log::warn!("⚠️  Download cancelled by user");
            drop(file);
            tokio::fs::remove_file(file_path).await.ok();
            update_progress(
                book_id,
                DownloadProgress {
                    book_id: book_id.to_string(),
                    title: filename.to_string(),
                    progress: 0.0,
                    speed_kbps: 0.0,
                    status: DownloadStatus::Cancelled,
                    error: None,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                },
            );
            return Err("Download cancelled".to_string());
        }

        let chunk = chunk_result.map_err(|e| {
            log::error!("❌ Download error at chunk {}: {}", chunk_count, e);
            format!("Download error: {}", e)
        })?;
        file.write_all(&chunk).await.map_err(|e| {
            log::error!("❌ Write error at chunk {}: {}", chunk_count, e);
            format!("Write error: {}", e)
        })?;

        downloaded += chunk.len() as u64;
        chunk_count += 1;

        // Update progress
        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };

        let elapsed = start_time.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 {
            (downloaded as f64 / 1024.0) / elapsed
        } else {
            0.0
        };

        // Log progress every 100 chunks
        if chunk_count % 100 == 0 {
            log::debug!(
                "📊 Progress: {:.1}% ({}/{} bytes, {:.1} KB/s)",
                progress,
                downloaded,
                total_size,
                speed
            );
        }

        update_progress(
            book_id,
            DownloadProgress {
                book_id: book_id.to_string(),
                title: filename.to_string(),
                progress,
                speed_kbps: speed,
                status: DownloadStatus::Downloading,
                error: None,
                downloaded_bytes: downloaded,
                total_bytes: total_size,
            },
        );
    }

    log::info!("💾 Flushing file...");
    file.flush().await.map_err(|e| {
        log::error!("❌ Flush error: {}", e);
        format!("Flush error: {}", e)
    })?;

    log::info!(
        "✅ Stream download completed: {} ({} chunks, {} bytes)",
        filename,
        chunk_count,
        downloaded
    );
    Ok(())
}

/// External download: open in default browser
async fn do_download_external_browser(
    book_id: &str,
    filename: &str,
    download_url: &str,
) -> Result<String, String> {
    log::info!("🌐 Opening download URL in browser");
    if let Err(e) = opener::open(download_url) {
        let error_msg = format!("无法打开浏览器: {}", e);
        mark_failed(book_id, filename, &error_msg);
        return Err(error_msg);
    }
    log::info!("✅ Browser opened successfully");
    update_progress(
        book_id,
        DownloadProgress {
            book_id: book_id.to_string(),
            title: filename.to_string(),
            progress: 0.0,
            speed_kbps: 0.0,
            status: DownloadStatus::Dispatched,
            error: Some("已发送到浏览器下载".to_string()),
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );
    Ok(format!("dispatched:browser:{}", filename))
}

/// External download: send to IDM via command line
async fn do_download_external_idm(
    book_id: &str,
    filename: &str,
    download_url: &str,
    download_dir: &str,
) -> Result<String, String> {
    log::info!("📥 Sending download to IDM");

    // Try common IDM installation paths
    let idm_paths = vec![
        r"C:\Program Files (x86)\Internet Download Manager\IDMan.exe",
        r"C:\Program Files\Internet Download Manager\IDMan.exe",
    ];

    let idm_exe = idm_paths.iter().find(|p| std::path::Path::new(p).exists());

    match idm_exe {
        Some(exe) => {
            let result = tokio::process::Command::new(exe)
                .args([
                    "/d",
                    download_url,
                    "/p",
                    download_dir,
                    "/f",
                    filename,
                    "/n",
                    "/a",
                ])
                .spawn();

            match result {
                Ok(_) => {
                    log::info!("✅ IDM download task added: {}", filename);
                    update_progress(
                        book_id,
                        DownloadProgress {
                            book_id: book_id.to_string(),
                            title: filename.to_string(),
                            progress: 0.0,
                            speed_kbps: 0.0,
                            status: DownloadStatus::Dispatched,
                            error: Some("已发送到 IDM 下载".to_string()),
                            downloaded_bytes: 0,
                            total_bytes: 0,
                        },
                    );
                    Ok(format!("dispatched:idm:{}", filename))
                }
                Err(e) => {
                    let error_msg = format!("启动 IDM 失败: {}", e);
                    mark_failed(book_id, filename, &error_msg);
                    Err(error_msg)
                }
            }
        }
        None => {
            let error_msg = "未找到 IDM (Internet Download Manager)，请确认已安装".to_string();
            mark_failed(book_id, filename, &error_msg);
            Err(error_msg)
        }
    }
}

/// External download: send to Motrix via JSON-RPC
async fn do_download_external_motrix(
    book_id: &str,
    filename: &str,
    download_url: &str,
    download_dir: &str,
) -> Result<String, String> {
    log::info!("📥 Sending download to Motrix");

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "olib",
        "method": "aria2.addUri",
        "params": [
            "token:motrix",
            [download_url],
            {
                "dir": download_dir,
                "out": filename,
            }
        ],
    });

    let client = reqwest::Client::new();
    let result = client
        .post("http://localhost:16800/jsonrpc")
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await;

    match result {
        Ok(resp) => {
            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Motrix 响应解析失败: {}", e))?;

            if let Some(err) = json.get("error") {
                let error_msg = format!("Motrix 返回错误: {}", err);
                mark_failed(book_id, filename, &error_msg);
                return Err(error_msg);
            }

            log::info!("✅ Motrix download task added: {}", filename);
            update_progress(
                book_id,
                DownloadProgress {
                    book_id: book_id.to_string(),
                    title: filename.to_string(),
                    progress: 0.0,
                    speed_kbps: 0.0,
                    status: DownloadStatus::Dispatched,
                    error: Some("已发送到 Motrix 下载".to_string()),
                    downloaded_bytes: 0,
                    total_bytes: 0,
                },
            );
            Ok(format!("dispatched:motrix:{}", filename))
        }
        Err(e) => {
            let error_msg = if e.is_connect() {
                "无法连接 Motrix，请确认 Motrix 已启动并开启了 RPC".to_string()
            } else {
                format!("Motrix 请求失败: {}", e)
            };
            mark_failed(book_id, filename, &error_msg);
            Err(error_msg)
        }
    }
}

/// External download: copy URL to clipboard
async fn do_download_copy_url(
    book_id: &str,
    filename: &str,
    download_url: &str,
) -> Result<String, String> {
    log::info!("📋 Copying download URL to clipboard");

    // Use platform-specific clipboard command
    #[cfg(target_os = "windows")]
    {
        let result = tokio::process::Command::new("cmd")
            .args(["/C", &format!("echo {}| clip", download_url)])
            .output()
            .await;

        match result {
            Ok(output) if output.status.success() => {
                log::info!("✅ Download URL copied to clipboard");
            }
            _ => {
                log::warn!("⚠️ Failed to copy to clipboard via cmd, trying PowerShell");
                let _ = tokio::process::Command::new("powershell")
                    .args(["-Command", &format!("Set-Clipboard '{}'", download_url)])
                    .output()
                    .await;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS: pbcopy, Linux: xclip
        #[cfg(target_os = "macos")]
        {
            let mut child = tokio::process::Command::new("pbcopy")
                .stdin(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("剪贴板工具启动失败: {}", e))?;
            if let Some(stdin) = child.stdin.as_mut() {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(download_url.as_bytes()).await;
            }
            let _ = child.wait().await;
        }
        #[cfg(target_os = "linux")]
        {
            let mut child = tokio::process::Command::new("xclip")
                .args(["-selection", "clipboard"])
                .stdin(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| format!("剪贴板工具启动失败: {}", e))?;
            if let Some(stdin) = child.stdin.as_mut() {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(download_url.as_bytes()).await;
            }
            let _ = child.wait().await;
        }
    }

    update_progress(
        book_id,
        DownloadProgress {
            book_id: book_id.to_string(),
            title: filename.to_string(),
            progress: 0.0,
            speed_kbps: 0.0,
            status: DownloadStatus::Dispatched,
            error: Some("下载链接已复制到剪贴板".to_string()),
            downloaded_bytes: 0,
            total_bytes: 0,
        },
    );
    Ok(format!("dispatched:copy_url:{}", download_url))
}
