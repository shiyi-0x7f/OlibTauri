use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::watch;
use tower_http::cors::CorsLayer;

/// 移动端上传的单文件大小上限（与 dev_docs/mobile-sync.md 阶段 2 约定一致）
const UPLOAD_MAX_BYTES: u64 = 500 * 1024 * 1024;

/// Global server state
static LAN_STATE: Mutex<Option<LanServerState>> = Mutex::new(None);

struct LanServerState {
    shutdown_tx: watch::Sender<bool>,
    url: String,
    qr_base64: String,
    port: u16,
    wifi_name: String,
}

#[derive(Serialize, Clone)]
pub struct LanStatus {
    pub running: bool,
    pub url: String,
    pub qr_base64: String,
    pub port: u16,
    pub wifi_name: String,
    pub opds_url: String,
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    size: u64,
    extension: String,
}

/// `GET /api/info` 的响应——移动端扫码后靠它确认对端是 Olib 桌面端，
/// 而不是局域网里随便一个 HTTP 服务（见 dev_docs/mobile-sync.md 阶段 1）
#[derive(Serialize)]
struct ServerInfo {
    app: &'static str,
    version: &'static str,
    device_name: String,
    capabilities: Vec<&'static str>,
}

/// `POST /api/booklist` 请求体——olib-mobile booklist codec v1 的 JSON 文件结构
/// 原样（条目为短键 t/a/h，见 olib-mobile lib/services/booklist_share_codec.dart）
#[derive(Deserialize)]
struct BooklistPayload {
    #[serde(default)]
    books: Vec<BooklistEntryPayload>,
}

#[derive(Deserialize)]
struct BooklistEntryPayload {
    id: String,
    #[serde(rename = "t")]
    title: Option<String>,
    #[serde(rename = "a")]
    author: Option<String>,
    #[serde(rename = "h")]
    hash: Option<String>,
}

#[derive(Clone)]
struct AppState {}

/// Detect the best LAN IP address, preferring private network ranges:
/// Priority: 192.168.x.x > 10.x.x.x > 172.16-31.x.x > any other
fn get_lan_ip() -> Option<std::net::IpAddr> {
    use local_ip_address::list_afinet_netifas;

    let ifas = list_afinet_netifas().ok()?;

    let mut best_192: Option<std::net::IpAddr> = None;
    let mut best_10: Option<std::net::IpAddr> = None;
    let mut best_172: Option<std::net::IpAddr> = None;

    for (_name, ip) in &ifas {
        if let std::net::IpAddr::V4(v4) = ip {
            let octets = v4.octets();
            if octets[0] == 192 && octets[1] == 168 {
                best_192 = Some(*ip);
            } else if octets[0] == 10 {
                best_10 = Some(*ip);
            } else if octets[0] == 172 && (16..=31).contains(&octets[1]) {
                best_172 = Some(*ip);
            }
        }
    }

    // Return in priority order
    best_192.or(best_10).or(best_172)
}

/// Start the LAN file server
pub async fn start(port: u16, download_folder: String) -> Result<LanStatus, String> {
    // Check if already running
    {
        let state = LAN_STATE.lock().unwrap();
        if state.is_some() {
            return Err("LAN server is already running".to_string());
        }
    }

    let folder = PathBuf::from(&download_folder);
    if !folder.exists() {
        return Err(format!(
            "Download folder does not exist: {}",
            download_folder
        ));
    }

    // Get local LAN IP (prefer 192.168.x.x > 10.x.x.x > 172.16-31.x.x)
    let local_ip = get_lan_ip().ok_or_else(|| {
        "Failed to detect LAN IP. Please make sure you are connected to a Wi-Fi network."
            .to_string()
    })?;
    let url = format!("http://{}:{}", local_ip, port);

    // Generate QR code
    let qr_base64 =
        generate_qr_base64(&url).map_err(|e| format!("Failed to generate QR code: {}", e))?;

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let app_state = AppState {};

    let app = Router::new()
        .route("/", get(serve_mobile_page))
        .route("/api/info", get(server_info))
        .route("/api/files", get(list_files))
        .route("/download/{filename}", get(download_file))
        .route("/opds", get(opds_catalog))
        .route("/opds/", get(opds_catalog))
        .route("/api/booklist", post(receive_booklist))
        .route(
            "/api/upload",
            post(receive_upload)
                // multipart 报文头也占体积，上限外再留 1MB 余量；超限由 axum 直接 413
                .layer(DefaultBodyLimit::max(
                    (UPLOAD_MAX_BYTES + 1024 * 1024) as usize,
                )),
        )
        .with_state(app_state)
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .map_err(|e| format!("Failed to bind port {}: {}", port, e))?;

    // Spawn the server
    let mut rx = shutdown_rx.clone();
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                loop {
                    rx.changed().await.ok();
                    if *rx.borrow() {
                        break;
                    }
                }
            })
            .await
            .ok();
        log::info!("LAN server stopped");
    });

    let wifi_name = get_wifi_ssid().unwrap_or_default();

    let status = LanStatus {
        running: true,
        url: url.clone(),
        qr_base64: qr_base64.clone(),
        port,
        wifi_name: wifi_name.clone(),
        opds_url: format!("{}/opds", url),
    };

    // Store state
    *LAN_STATE.lock().unwrap() = Some(LanServerState {
        shutdown_tx,
        url,
        qr_base64,
        port,
        wifi_name,
    });

    log::info!("LAN server started on 0.0.0.0:{}", port);
    Ok(status)
}

/// Stop the LAN file server
pub fn stop() -> Result<(), String> {
    let mut state = LAN_STATE.lock().unwrap();
    if let Some(s) = state.take() {
        s.shutdown_tx.send(true).ok();
        log::info!("LAN server shutdown signal sent");
        Ok(())
    } else {
        Err("LAN server is not running".to_string())
    }
}

/// Get current server status
pub fn get_status() -> LanStatus {
    let state = LAN_STATE.lock().unwrap();
    match state.as_ref() {
        Some(s) => LanStatus {
            running: true,
            url: s.url.clone(),
            qr_base64: s.qr_base64.clone(),
            port: s.port,
            wifi_name: s.wifi_name.clone(),
            opds_url: format!("{}/opds", s.url),
        },
        None => LanStatus {
            running: false,
            url: String::new(),
            qr_base64: String::new(),
            port: 0,
            wifi_name: get_wifi_ssid().unwrap_or_default(),
            opds_url: String::new(),
        },
    }
}

/// Get the current WiFi SSID on Windows via `netsh wlan show interfaces`
fn get_wifi_ssid() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = std::process::Command::new("netsh")
            .args(["wlan", "show", "interfaces"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .ok()?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("SSID") && !trimmed.starts_with("BSSID") {
                if let Some((_key, value)) = trimmed.split_once(':') {
                    let ssid = value.trim().to_string();
                    if !ssid.is_empty() {
                        return Some(ssid);
                    }
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

/// Generate QR code as base64-encoded SVG
pub(crate) fn generate_qr_base64(data: &str) -> Result<String, Box<dyn std::error::Error>> {
    use qrcode::render::svg;
    use qrcode::QrCode;

    let code = QrCode::new(data.as_bytes())?;
    let svg_string = code
        .render::<svg::Color>()
        .min_dimensions(200, 200)
        .quiet_zone(true)
        .build();

    // Return SVG as base64 data URI
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(svg_string.as_bytes());
    Ok(format!("data:image/svg+xml;base64,{}", b64))
}

// --- Axum Handlers ---

async fn serve_mobile_page() -> Html<&'static str> {
    Html(MOBILE_HTML)
}

async fn server_info() -> Json<ServerInfo> {
    // COMPUTERNAME=Windows，HOSTNAME=类 Unix；都取不到就用产品名兜底
    let device_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Olib Desktop".to_string());
    Json(ServerInfo {
        app: "olib-desktop",
        version: env!("CARGO_PKG_VERSION"),
        device_name,
        capabilities: vec!["files", "opds", "upload", "booklist"],
    })
}

/// 400 响应统一带 `{ "detail": ... }`，olib-mobile 按此字段展示拒绝原因
fn bad_request(detail: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "detail": detail })),
    )
        .into_response()
}

/// `POST /api/upload`：接收移动端推送的书籍文件（multipart 字段 `file`），
/// 流式写入 download_folder；扩展名限 OPDS_EXTENSIONS 白名单，超限 413
async fn receive_upload(
    State(_state): State<AppState>,
    headers: header::HeaderMap,
    mut multipart: Multipart,
) -> Response {
    use tokio::io::AsyncWriteExt;

    // Content-Length 先行拒绝，避免白收几百 MB 再报错（DefaultBodyLimit 兜底）
    let content_length = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    if content_length.is_some_and(|len| len > UPLOAD_MAX_BYTES) {
        return (StatusCode::PAYLOAD_TOO_LARGE, "File too large").into_response();
    }

    let download_folder = match current_download_folder() {
        Ok(f) => f,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Config error").into_response(),
    };

    loop {
        let mut field = match multipart.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => return bad_request("缺少 file 字段"),
            Err(e) => return bad_request(&format!("multipart 解析失败: {}", e)),
        };
        if field.name() != Some("file") {
            continue;
        }

        let Some(raw_name) = field.file_name().map(|s| s.to_string()) else {
            return bad_request("file 字段缺少文件名");
        };
        if raw_name.is_empty()
            || raw_name.contains("..")
            || raw_name.contains('/')
            || raw_name.contains('\\')
        {
            return bad_request("文件名非法");
        }
        let ext = std::path::Path::new(&raw_name)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !OPDS_EXTENSIONS.contains(&ext.as_str()) {
            return bad_request(&format!("不支持的格式: {}", ext));
        }

        // 同名不覆盖，追加 " (n)" 去重
        let final_name = dedup_filename(&download_folder, &raw_name);
        let target = download_folder.join(&final_name);

        let mut file = match tokio::fs::File::create(&target).await {
            Ok(f) => f,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Create file error: {}", e),
                )
                    .into_response()
            }
        };
        let mut written: u64 = 0;
        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    written += chunk.len() as u64;
                    if written > UPLOAD_MAX_BYTES {
                        drop(file);
                        let _ = tokio::fs::remove_file(&target).await;
                        return (StatusCode::PAYLOAD_TOO_LARGE, "File too large").into_response();
                    }
                    if let Err(e) = file.write_all(&chunk).await {
                        drop(file);
                        let _ = tokio::fs::remove_file(&target).await;
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Write error: {}", e),
                        )
                            .into_response();
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&target).await;
                    return bad_request(&format!("读取上传内容失败: {}", e));
                }
            }
        }
        if let Err(e) = file.flush().await {
            let _ = tokio::fs::remove_file(&target).await;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Flush error: {}", e),
            )
                .into_response();
        }

        log::info!("📥 LAN upload received: {} ({} bytes)", final_name, written);
        return (
            StatusCode::CREATED,
            Json(serde_json::json!({ "name": final_name, "size": written })),
        )
            .into_response();
    }
}

/// 在目录内为文件名去重：`书名.epub` → `书名 (1).epub` → `书名 (2).epub` …
fn dedup_filename(dir: &std::path::Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let path = std::path::Path::new(name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 1.. {
        let candidate = format!("{} ({}){}", stem, n, ext);
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    unreachable!()
}

/// `POST /api/booklist`：接收移动端推送的书单（codec v1 JSON 原样），
/// 按 (book_id, user_email) 去重写入收藏
async fn receive_booklist(
    State(_state): State<AppState>,
    Json(payload): Json<BooklistPayload>,
) -> Response {
    let user_email = match crate::config::get_value(|c| c.user_email.clone()) {
        Ok(email) => email,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Config error").into_response(),
    };
    if user_email.is_empty() {
        return bad_request("桌面端未登录，无法接收书单");
    }

    let entries = payload
        .books
        .into_iter()
        .map(|e| crate::database::BooklistImportEntry {
            id: e.id,
            title: e.title,
            author: e.author,
            hash: e.hash,
        })
        .collect();
    let (imported, skipped) = crate::database::import_booklist(entries, &user_email);

    log::info!(
        "📚 LAN booklist received: {} imported, {} skipped",
        imported,
        skipped
    );
    Json(serde_json::json!({ "imported": imported, "skipped": skipped })).into_response()
}

/// Read the current download folder from config (always fresh)
fn current_download_folder() -> Result<PathBuf, StatusCode> {
    crate::config::get_value(|c| PathBuf::from(c.download_folder.clone()))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

async fn list_files(State(_state): State<AppState>) -> Result<Json<Vec<FileEntry>>, StatusCode> {
    let download_folder = current_download_folder()?;
    let mut entries = Vec::new();
    if let Ok(dir) = std::fs::read_dir(&download_folder) {
        for entry in dir.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let extension = std::path::Path::new(&name)
                        .extension()
                        .map(|e| e.to_string_lossy().to_string())
                        .unwrap_or_default();
                    entries.push(FileEntry {
                        name,
                        size: meta.len(),
                        extension,
                    });
                }
            }
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(Json(entries))
}

async fn download_file(State(_state): State<AppState>, Path(filename): Path<String>) -> Response {
    // Sanitize: no path traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return (StatusCode::BAD_REQUEST, "Invalid filename").into_response();
    }

    let download_folder = match current_download_folder() {
        Ok(f) => f,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Config error").into_response(),
    };

    let file_path = download_folder.join(&filename);
    if !file_path.exists() || !file_path.is_file() {
        return (StatusCode::NOT_FOUND, "File not found").into_response();
    }

    match tokio::fs::read(&file_path).await {
        Ok(bytes) => {
            let content_type = file_path
                .extension()
                .and_then(|e| e.to_str())
                .map(mime_for_extension)
                .unwrap_or("application/octet-stream");
            (
                [
                    (header::CONTENT_TYPE, content_type.to_string()),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{}\"", filename),
                    ),
                ],
                bytes,
            )
                .into_response()
        }
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Read error").into_response(),
    }
}

// --- OPDS Catalog (OPDS 1.2 acquisition feed) ---

/// Map file extension (lowercase, without dot) to MIME type
fn mime_for_extension(ext: &str) -> &'static str {
    match ext {
        "pdf" => "application/pdf",
        "epub" => "application/epub+zip",
        "mobi" => "application/x-mobipocket-ebook",
        "azw" | "azw3" => "application/vnd.amazon.ebook",
        "fb2" => "application/x-fictionbook+xml",
        "djvu" => "image/vnd.djvu",
        "cbz" => "application/vnd.comicbook+zip",
        "cbr" => "application/vnd.comicbook-rar",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Extensions exposed in the OPDS catalog (ebook formats readers can consume)
const OPDS_EXTENSIONS: [&str; 10] = [
    "pdf", "epub", "mobi", "azw", "azw3", "fb2", "djvu", "cbz", "cbr", "txt",
];

/// Escape text for use in XML content and attribute values
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// Percent-encode a single URL path segment (RFC 3986 unreserved chars pass through)
fn percent_encode_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

async fn opds_catalog(State(_state): State<AppState>) -> Response {
    let download_folder = match current_download_folder() {
        Ok(f) => f,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Config error").into_response(),
    };

    struct OpdsEntry {
        name: String,
        ext: String,
        size: u64,
        modified: chrono::DateTime<chrono::Utc>,
    }

    let mut books: Vec<OpdsEntry> = Vec::new();
    if let Ok(dir) = std::fs::read_dir(&download_folder) {
        for entry in dir.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let ext = std::path::Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if !OPDS_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            let modified = meta
                .modified()
                .map(chrono::DateTime::<chrono::Utc>::from)
                .unwrap_or_else(|_| chrono::Utc::now());
            books.push(OpdsEntry {
                name,
                ext,
                size: meta.len(),
                modified,
            });
        }
    }
    // Newest first, so recent downloads surface at the top of reader apps
    books.sort_by(|a, b| b.modified.cmp(&a.modified));

    let feed_updated = books
        .first()
        .map(|b| b.modified)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let mut xml = String::with_capacity(1024 + books.len() * 512);
    xml.push_str(r#"<?xml version="1.0" encoding="UTF-8"?>"#);
    xml.push('\n');
    xml.push_str(concat!(
        r#"<feed xmlns="http://www.w3.org/2005/Atom" "#,
        r#"xmlns:dc="http://purl.org/dc/terms/" "#,
        r#"xmlns:opds="http://opds-spec.org/2010/catalog">"#,
    ));
    xml.push('\n');
    xml.push_str("  <id>urn:olib:opds:catalog</id>\n");
    xml.push_str("  <title>Olib 书库</title>\n");
    xml.push_str(&format!("  <updated>{}</updated>\n", feed_updated));
    xml.push_str("  <author><name>Olib</name></author>\n");
    let feed_type = "application/atom+xml;profile=opds-catalog;kind=acquisition";
    xml.push_str(&format!(
        "  <link rel=\"self\" href=\"/opds\" type=\"{}\"/>\n",
        feed_type
    ));
    xml.push_str(&format!(
        "  <link rel=\"start\" href=\"/opds\" type=\"{}\"/>\n",
        feed_type
    ));

    for book in &books {
        let stem = std::path::Path::new(&book.name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| book.name.clone());
        xml.push_str("  <entry>\n");
        xml.push_str(&format!(
            "    <id>urn:olib:book:{}</id>\n",
            percent_encode_segment(&book.name)
        ));
        xml.push_str(&format!("    <title>{}</title>\n", xml_escape(&stem)));
        xml.push_str(&format!(
            "    <updated>{}</updated>\n",
            book.modified
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
        ));
        xml.push_str(&format!(
            "    <dc:format>{}</dc:format>\n",
            xml_escape(&book.ext)
        ));
        xml.push_str(&format!(
            "    <link rel=\"http://opds-spec.org/acquisition\" href=\"/download/{}\" type=\"{}\" length=\"{}\"/>\n",
            percent_encode_segment(&book.name),
            mime_for_extension(&book.ext),
            book.size
        ));
        xml.push_str("  </entry>\n");
    }
    xml.push_str("</feed>\n");

    (
        [(
            header::CONTENT_TYPE,
            format!("{}; charset=utf-8", feed_type),
        )],
        xml,
    )
        .into_response()
}

// --- Embedded Mobile HTML Page (with light/dark theme toggle) ---
const MOBILE_HTML: &str = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Olib·开源图书 · 无线传书</title>
<style>
  :root{
    --bg:#0a0a0f;--bg2:rgba(18,18,26,0.85);--bg3:rgba(10,10,15,0.92);
    --card:rgba(26,26,46,0.5);--card-a:rgba(26,26,46,0.8);
    --bdr:rgba(255,255,255,0.06);--bdr2:rgba(255,255,255,0.08);
    --t1:#e8e8f0;--t2:#9898b0;--t3:#5a5a72;
    --ac:#00c4d0;--ac-bg:rgba(0,196,208,0.15);--ac-bdr:rgba(0,196,208,0.3);
    --cnt:rgba(255,255,255,0.06);--cnt-a:rgba(0,196,208,0.2);
    --ipdf-bg:rgba(239,68,68,0.15);--ipdf:#f87171;
    --iepub-bg:rgba(34,197,94,0.15);--iepub:#4ade80;
    --imobi-bg:rgba(234,179,8,0.15);--imobi:#facc15;
    --ioth-bg:rgba(59,130,246,0.15);--ioth:#60a5fa;
    --sbg:rgba(26,26,46,0.6);--g1:#e8e8f0;--g2:#00c4d0;
  }
  .light{
    --bg:#f5f5f7;--bg2:rgba(255,255,255,0.92);--bg3:rgba(245,245,247,0.95);
    --card:rgba(255,255,255,0.85);--card-a:rgba(240,240,245,1);
    --bdr:rgba(0,0,0,0.07);--bdr2:rgba(0,0,0,0.1);
    --t1:#1a1a2e;--t2:#6b6b80;--t3:#9898a8;
    --ac:#009faa;--ac-bg:rgba(0,159,170,0.1);--ac-bdr:rgba(0,159,170,0.25);
    --cnt:rgba(0,0,0,0.05);--cnt-a:rgba(0,159,170,0.12);
    --ipdf-bg:rgba(239,68,68,0.08);--ipdf:#dc2626;
    --iepub-bg:rgba(34,197,94,0.08);--iepub:#16a34a;
    --imobi-bg:rgba(234,179,8,0.08);--imobi:#ca8a04;
    --ioth-bg:rgba(59,130,246,0.08);--ioth:#2563eb;
    --sbg:rgba(0,0,0,0.03);--g1:#1a1a2e;--g2:#009faa;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;
    background:var(--bg);color:var(--t1);min-height:100vh;transition:background .3s,color .3s}
  .hd{padding:18px 14px 12px;background:var(--bg2);backdrop-filter:blur(20px);
    position:sticky;top:0;z-index:10;border-bottom:1px solid var(--bdr);display:flex;align-items:center}
  .hd-c{flex:1;text-align:center}
  .hd h1{font-size:19px;font-weight:700;background:linear-gradient(135deg,var(--g1),var(--g2));
    -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .hd p{font-size:12px;color:var(--t2);margin-top:2px}
  .tb{background:none;border:none;cursor:pointer;padding:6px;color:var(--t2);border-radius:8px;display:flex;align-items:center}
  .tb:active{opacity:.6}
  .tbar{position:sticky;top:58px;z-index:9;background:var(--bg3);backdrop-filter:blur(16px);
    padding:10px 12px;border-bottom:1px solid var(--bdr)}
  .sb{display:flex;align-items:center;gap:8px;background:var(--sbg);
    border:1px solid var(--bdr2);border-radius:10px;padding:9px 12px;margin-bottom:8px}
  .sb svg{color:var(--t2);flex-shrink:0}
  .sb input{flex:1;background:none;border:none;outline:none;color:var(--t1);font-size:14px;font-family:inherit}
  .sb input::placeholder{color:var(--t3)}
  .fr{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch}
  .fr::-webkit-scrollbar{display:none}
  .chip{padding:5px 12px;border-radius:20px;font-size:12px;font-weight:500;white-space:nowrap;
    cursor:pointer;transition:all .2s;background:var(--card);border:1px solid var(--bdr);color:var(--t2);flex-shrink:0}
  .chip.on{background:var(--ac-bg);border-color:var(--ac-bdr);color:var(--ac)}
  .chip b{display:inline-block;margin-left:4px;padding:1px 5px;border-radius:8px;font-size:10px;font-weight:500;background:var(--cnt)}
  .chip.on b{background:var(--cnt-a)}
  .sub-row{display:flex;gap:4px;overflow-x:auto;padding:6px 0 0 8px;margin-top:6px;
    border-left:2px solid var(--ac-bdr);-webkit-overflow-scrolling:touch;
    animation:subIn .2s ease}
  .sub-row::-webkit-scrollbar{display:none}
  @keyframes subIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .schip{padding:3px 10px;border-radius:16px;font-size:11px;font-weight:500;white-space:nowrap;
    cursor:pointer;transition:all .2s;background:transparent;border:1px solid transparent;color:var(--t3);flex-shrink:0}
  .schip.on{background:var(--ac-bg);border-color:rgba(0,196,208,0.2);color:var(--ac)}
  .schip:active{opacity:.6}
  .schip b{display:inline-block;margin-left:3px;font-size:10px;font-weight:500;opacity:.5}
  .sr{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;color:var(--t3);font-size:12px}
  .srt{background:none;border:none;color:var(--t2);font-size:12px;cursor:pointer;
    display:flex;align-items:center;gap:4px;font-family:inherit}
  .srt:active{color:var(--ac)}
  .fl{padding:0 12px 20px}
  .fi{display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--card);
    border:1px solid var(--bdr);border-radius:12px;margin-bottom:6px;text-decoration:none;
    color:inherit;transition:all .2s;cursor:pointer}
  .fi:active{transform:scale(0.98);background:var(--card-a)}
  .ic{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;
    font-size:11px;font-weight:700;text-transform:uppercase;flex-shrink:0}
  .ic.pdf{background:var(--ipdf-bg);color:var(--ipdf)}
  .ic.epub{background:var(--iepub-bg);color:var(--iepub)}
  .ic.mobi{background:var(--imobi-bg);color:var(--imobi)}
  .ic.other{background:var(--ioth-bg);color:var(--ioth)}
  .inf{flex:1;min-width:0}
  .fn{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .fm{font-size:11px;color:var(--t2);margin-top:2px}
  .di{color:var(--ac);flex-shrink:0}
  .ey{text-align:center;padding:50px 20px;color:var(--t3);font-size:13px}
  .ld{text-align:center;padding:50px 20px;color:var(--t2)}
  @keyframes fi{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .fi{animation:fi .25s ease both}
</style>
</head>
<body>
<div class="hd">
  <div style="width:32px"></div>
  <div class="hd-c">
    <h1>📚 Olib·开源图书</h1>
    <p>无线传书 · 点击文件即可下载到设备</p>
  </div>
  <button class="tb" id="thb" onclick="tT()" title="切换浅色/深色">
    <svg id="si" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="display:none"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    <svg id="mi" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  </button>
</div>
<div class="tbar">
  <div class="sb">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input id="q" type="text" placeholder="搜索文件名..." autocomplete="off">
  </div>
  <div class="fr" id="ft"></div>
  <div id="sfr"></div>
</div>
<div class="sr">
  <span id="fc"></span>
  <button class="srt" id="stb" onclick="tS()">按名称 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 3 18 9"/><polyline points="6 15 12 21 18 15"/></svg></button>
</div>
<div id="ls" class="fl"><div class="ld">加载中...</div></div>

<script>
let dk=localStorage.getItem('olib-t')!=='light';
if(!localStorage.getItem('olib-t')&&window.matchMedia('(prefers-color-scheme:light)').matches)dk=false;
function aT(){document.body.classList.toggle('light',!dk);
  document.getElementById('si').style.display=dk?'none':'block';
  document.getElementById('mi').style.display=dk?'block':'none';}
function tT(){dk=!dk;localStorage.setItem('olib-t',dk?'dark':'light');aT();}
aT();

// Category definitions matching desktop
const CATS={
  '电子书':new Set(['PDF','EPUB','MOBI','AZW3','AZW','FB2','DJVU','CBZ','CBR']),
  '文档':new Set(['DOC','DOCX','PPT','PPTX','XLS','XLSX','CSV','TXT','MD','RTF','ODT','ODS','ODP']),
  '图片':new Set(['JPG','JPEG','PNG','GIF','BMP','SVG','WEBP','AVIF','TIFF','TIF','ICO','PSD','EPS']),
  '音视频':new Set(['MP4','MP3','AVI','MKV','MOV','WAV','FLAC','AAC','OGG','WMV','WEBM','M4A','M4V'])
};
const CAT_ICONS={'电子书':'📖','文档':'📄','图片':'🖼️','音视频':'🎬','其他':'📦'};

let af=[],catFlt='all',subFlt=null,sb='name',sa=true;

function fS(b){if(!b)return'—';const u=['B','KB','MB','GB'];let i=0,s=b;
  while(s>=1024&&i<u.length-1){s/=1024;i++;}return s.toFixed(1)+' '+u[i];}
function iC(e){switch((e||'').toLowerCase()){
  case'pdf':return'pdf';case'epub':return'epub';
  case'mobi':case'azw3':return'mobi';default:return'other';}}
function extCat(ext){
  for(const[cat,exts]of Object.entries(CATS)){if(exts.has(ext))return cat;}
  return'其他';
}

// Build category chips
function bF(f){
  const cc={};let total=f.length;
  f.forEach(x=>{const e=(x.extension||'').toUpperCase();if(e){
    const cat=extCat(e);cc[cat]=(cc[cat]||0)+1;}});
  const el=document.getElementById('ft');
  let h=`<div class="chip on" data-c="all" onclick="sC('all')">全部<b>${total}</b></div>`;
  for(const cat of Object.keys(CATS)){
    if(cc[cat])h+=`<div class="chip" data-c="${cat}" onclick="sC('${cat}')">${CAT_ICONS[cat]||''} ${cat}<b>${cc[cat]}</b></div>`;
  }
  if(cc['其他'])h+=`<div class="chip" data-c="其他" onclick="sC('其他')">📦 其他<b>${cc['其他']}</b></div>`;
  el.innerHTML=h;
}

// Select category
function sC(c){
  if(catFlt===c&&c!=='all'){catFlt='all';subFlt=null;}
  else{catFlt=c;subFlt=null;}
  document.querySelectorAll('.chip').forEach(el=>{el.classList.toggle('on',el.dataset.c===catFlt);});
  bSF();rL();
}

// Build sub-filter chips
function bSF(){
  const el=document.getElementById('sfr');
  if(catFlt==='all'){el.innerHTML='';return;}
  const exts=catFlt==='其他'?CATS:null;
  const counts={};
  af.forEach(x=>{
    const e=(x.extension||'').toUpperCase();if(!e)return;
    if(catFlt==='其他'){
      if(!Object.values(CATS).some(s=>s.has(e)))counts[e]=(counts[e]||0)+1;
    }else{
      const cat=CATS[catFlt];
      if(cat&&cat.has(e))counts[e]=(counts[e]||0)+1;
    }
  });
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  if(sorted.length<2){el.innerHTML='';return;}
  let h='<div class="sub-row">';
  h+=`<div class="schip${subFlt===null?' on':''}" onclick="sSF(null)">全部</div>`;
  sorted.forEach(([ext,cnt])=>{
    h+=`<div class="schip${subFlt===ext?' on':''}" onclick="sSF('${ext}')">${ext}<b>${cnt}</b></div>`;
  });
  h+='</div>';
  el.innerHTML=h;
}

// Select sub-filter
function sSF(ext){
  subFlt=ext;
  document.querySelectorAll('.schip').forEach(el=>{
    const isAll=el.textContent.startsWith('全部');
    el.classList.toggle('on',ext===null?isAll:el.textContent.startsWith(ext));
  });
  rL();
}

function tS(){if(sb==='name'){sb='size';sa=false;}else{sb='name';sa=true;}
  document.getElementById('stb').childNodes[0].textContent=sb==='name'?'按名称 ':'按大小 ';rL();}

function gF(){const q=document.getElementById('q').value.toLowerCase().trim();
  return af.filter(f=>{
    const e=(f.extension||'').toUpperCase();
    // Category filter
    if(catFlt!=='all'){
      if(subFlt){if(e!==subFlt)return false;}
      else if(catFlt==='其他'){
        if(Object.values(CATS).some(s=>s.has(e)))return false;
      }else{
        const cat=CATS[catFlt];
        if(!cat||!cat.has(e))return false;
      }
    }
    if(q&&!f.name.toLowerCase().includes(q))return false;
    return true;
  }).sort((a,b)=>{if(sb==='size')return sa?a.size-b.size:b.size-a.size;
    return sa?a.name.localeCompare(b.name):b.name.localeCompare(a.name);});}

function rL(){const f=gF(),el=document.getElementById('ls');
  document.getElementById('fc').textContent=f.length+' 个文件';
  if(!f.length){el.innerHTML='<div class="ey">无匹配文件</div>';return;}
  el.innerHTML=f.map((x,i)=>`
    <a class="fi" href="/download/${encodeURIComponent(x.name)}" download style="animation-delay:${i*30}ms">
      <div class="ic ${iC(x.extension)}">${(x.extension||'?').toUpperCase()}</div>
      <div class="inf"><div class="fn">${x.name}</div><div class="fm">${fS(x.size)}</div></div>
      <svg class="di" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </a>`).join('');}
document.getElementById('q').addEventListener('input',rL);
fetch('/api/files').then(r=>r.json()).then(f=>{af=f;bF(f);rL();}).catch(()=>{
  document.getElementById('ls').innerHTML='<div class="ey">加载失败</div>';});
</script>
</body>
</html>"#;
