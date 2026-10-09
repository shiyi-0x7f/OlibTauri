//! 导入本机书籍到微信读书书架（与 olib-mobile `importBook` 对齐）。
//!
//! 流程：`/cos/getcredential` 取临时凭据 → 签名后直传腾讯云 COS → `/cos/notify` 确认导入。
//! 上传完成后若确认失败，结果不确定（可能已入架），**不自动重试**，提示用户先查书架。
//! 进度经 `weread-import` 事件推送（按百分比节流）。

use super::client::{call, Method, Request};
use hmac::{Hmac, Mac};
use once_cell::sync::Lazy;
use reqwest::header::{AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE};
use reqwest::{Body, Client};
use serde::Serialize;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;

pub const IMPORT_EVENT: &str = "weread-import";
const ALLOWED_EXTENSIONS: [&str; 5] = ["epub", "pdf", "mobi", "txt", "azw3"];
const MAX_SIZE: u64 = 200 * 1024 * 1024;
const CHUNK_SIZE: usize = 256 * 1024;
/// 签名有效期上限（秒），且不超过凭据过期时间。
const SIGN_TTL_SECS: i64 = 3600;
const OUTCOME_UNKNOWN: &str = "上传已完成，但未能确认导入结果，请先到微信读书书架查看，勿直接重试";

/// 大文件上传耗时长，不沿用请求层 70s 的总超时。
static UPLOAD_HTTP: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(15 * 60))
        .build()
        .expect("Failed to create COS upload client")
});

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub book_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgress {
    path: String,
    sent: u64,
    total: u64,
}

struct Credential {
    bucket: String,
    object_name: String,
    secret_id: String,
    secret_key: String,
    token: String,
    expiry: i64,
}

pub async fn import_book(app: AppHandle, path: String) -> Result<ImportResult, String> {
    let file_path = Path::new(&path);
    let name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("文件名无效")?
        .to_string();
    let (base_name, extension) = split_name(&name)?;
    let size = tokio::fs::metadata(file_path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?
        .len();
    if size == 0 || size > MAX_SIZE {
        return Err("文件大小需在 1 字节到 200 MB 之间".to_string());
    }
    log::info!("微信读书导入开始：.{}，{} 字节", extension, size);

    let resp = call(Request::get(
        "/cos/getcredential",
        vec![("name", base_name), ("from", String::new())],
    ))
    .await?;
    let cred = parse_credential(&resp, chrono::Utc::now().timestamp())?;
    if std::env::var_os("OLIB_WEREAD_DIAG_UPLOAD").is_some() {
        log::info!(
            "[诊断] 凭据 bucket={} object={} 文件名={}",
            cred.bucket,
            cred.object_name,
            name
        );
    }

    let event_path = path.clone();
    upload(&path, size, &cred, move |sent| {
        let _ = app.emit(
            IMPORT_EVENT,
            ImportProgress {
                path: event_path.clone(),
                sent,
                total: size,
            },
        );
    })
    .await?;

    // 写操作不可重放：会话过期刷新后 call 会直接报「结果未知」
    let notify = call(Request {
        method: Method::Post,
        path: "/cos/notify",
        query: vec![
            ("name", name),
            ("path", cred.object_name.clone()),
            ("cancel", "0".to_string()),
        ],
        body: Some(json!({})),
        replayable: false,
    })
    .await
    .map_err(|e| format!("{}（{}）", OUTCOME_UNKNOWN, e))?;

    if std::env::var_os("OLIB_WEREAD_DIAG_UPLOAD").is_some() {
        log::info!("[诊断] /cos/notify 响应: {}", notify);
    }
    let book_id = match notify.get("bookId") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    if notify.get("status").and_then(Value::as_i64) != Some(1) || book_id.is_empty() {
        return Err(OUTCOME_UNKNOWN.to_string());
    }
    log::info!("微信读书导入请求已提交");
    if std::env::var_os("OLIB_WEREAD_DIAG_UPLOAD").is_some() {
        // [诊断] 导入后观察服务端对该书的状态（只读）
        let id = book_id.clone();
        tauri::async_runtime::spawn(async move {
            for delay in [0u64, 15, 45] {
                tokio::time::sleep(Duration::from_secs(delay)).await;
                match super::api::book_info(&id).await {
                    Ok(v) => log::info!("[诊断] book_info: {}", v),
                    Err(e) => log::info!("[诊断] book_info 失败: {}", e),
                }
            }
        });
    }
    Ok(ImportResult { book_id })
}

/// 拆出不含扩展名的书名与小写扩展名，并校验格式。
fn split_name(name: &str) -> Result<(String, String), String> {
    let (base, ext) = name.rsplit_once('.').ok_or("无法识别文件格式")?;
    let ext = ext.to_ascii_lowercase();
    if base.is_empty() || !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err("微信读书仅支持导入 EPUB / PDF / MOBI / TXT / AZW3".to_string());
    }
    Ok((base.to_string(), ext))
}

fn parse_credential(resp: &Value, now: i64) -> Result<Credential, String> {
    const INCOMPLETE: &str = "微信读书上传凭据不完整";
    let text = |v: Option<&Value>| v.and_then(Value::as_str).unwrap_or_default().to_string();
    let bucket = text(resp.get("bucket"));
    let object_name = text(resp.get("ObjectName"));
    let response = resp.get("Response");
    let keys = response.and_then(|r| r.get("Credentials"));
    let secret_id = text(keys.and_then(|k| k.get("TmpSecretId")));
    let secret_key = text(keys.and_then(|k| k.get("TmpSecretKey")));
    let token = text(keys.and_then(|k| k.get("Token")));

    let bucket_ok = !bucket.is_empty()
        && bucket
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-');
    let object_ok =
        !object_name.is_empty() && !object_name.starts_with("//") && !object_name.contains("..");
    if !bucket_ok || !object_ok || secret_id.is_empty() || secret_key.is_empty() || token.is_empty()
    {
        return Err(INCOMPLETE.to_string());
    }
    let expiry = match response.and_then(|r| r.get("ExpiredTime")) {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    };
    if expiry <= now {
        return Err("微信读书上传凭据已过期，请重试".to_string());
    }
    Ok(Credential {
        bucket,
        object_name,
        secret_id,
        secret_key,
        token,
        expiry,
    })
}

async fn upload<F>(path: &str, size: u64, cred: &Credential, on_progress: F) -> Result<(), String>
where
    F: Fn(u64) + Clone + Send + 'static,
{
    let host = format!("{}.cos.accelerate.myqcloud.com", cred.bucket);
    let uri = encode_object_path(&cred.object_name);
    let now = chrono::Utc::now().timestamp();
    let auth = cos_authorization(
        &cred.secret_id,
        &cred.secret_key,
        &host,
        &uri,
        now,
        (now + SIGN_TTL_SECS).min(cred.expiry),
    );

    // 新凭据首次直接写 EPUB 可能返回 200 却保存错误内容；零字节预写入可稳定初始化对象。
    let warmup = UPLOAD_HTTP
        .put(format!("https://{}{}", host, uri))
        .header(AUTHORIZATION, auth.clone())
        .header("x-cos-security-token", &cred.token)
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(CONTENT_LENGTH, 0)
        .body(Vec::<u8>::new())
        .send()
        .await
        .map_err(|e| format!("初始化微信读书上传对象失败，导入未开始: {}", e))?;
    if warmup.status().as_u16() != 200 {
        return Err(format!(
            "初始化微信读书上传对象失败（HTTP {}），导入未开始",
            warmup.status().as_u16()
        ));
    }
    let warmup_crc = warmup
        .headers()
        .get("x-cos-hash-crc64ecma")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if warmup_crc != Some(0) {
        return Err("初始化微信读书上传对象校验失败，导入未开始".to_string());
    }

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let crc = Arc::new(AtomicU64::new(u64::MAX));
    let body = Body::wrap_stream(progress_stream(file, size, on_progress, crc.clone()));

    let resp = UPLOAD_HTTP
        .put(format!("https://{}{}", host, uri))
        .header(AUTHORIZATION, auth)
        .header("x-cos-security-token", &cred.token)
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(CONTENT_LENGTH, size)
        .body(body)
        .send()
        .await
        .map_err(|e| format!("上传到微信读书失败，导入未开始: {}", e))?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Err(format!("上传到微信读书失败（HTTP {}），导入未开始", status));
    }
    let remote_crc = resp
        .headers()
        .get("x-cos-hash-crc64ecma")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or("COS 未返回有效的文件校验值，导入未开始，请重试")?;
    let local_crc = !crc.load(Ordering::Relaxed);
    if remote_crc != local_crc {
        log::warn!(
            "微信读书 COS 上传内容校验失败：本地 CRC {}，远端 CRC {}，ETag {:?}",
            local_crc,
            remote_crc,
            resp.headers().get("etag")
        );
        return Err("上传内容校验失败，导入未开始，请重试".to_string());
    }
    Ok(())
}

/// [诊断] 用同一组临时凭据把刚上传的对象读回来，逐字节比对本地文件（只读）。
#[cfg(test)]
async fn diag_read_back(host: &str, uri: &str, cred: &Credential, local: &[u8]) {
    let now = chrono::Utc::now().timestamp();
    let key_time = format!("{};{}", now, (now + 600).min(cred.expiry));
    let sign_key = hmac_sha1_hex(&cred.secret_key, &key_time);
    let http_string = format!("get\n{}\n\nhost={}\n", uri, host);
    let string_to_sign = format!("sha1\n{}\n{}\n", key_time, sha1_hex(&http_string));
    let auth = format!(
        "q-sign-algorithm=sha1&q-ak={}&q-sign-time={}&q-key-time={}&q-header-list=host\
         &q-url-param-list=&q-signature={}",
        cred.secret_id,
        key_time,
        key_time,
        hmac_sha1_hex(&sign_key, &string_to_sign)
    );
    let resp = UPLOAD_HTTP
        .get(format!("https://{}{}", host, uri))
        .header(AUTHORIZATION, auth)
        .header("x-cos-security-token", &cred.token)
        .send()
        .await;
    match resp {
        Err(e) => log::info!("[诊断] 读回失败: {}", e),
        Ok(r) => {
            let status = r.status().as_u16();
            let headers = format!("{:?}", r.headers());
            let body = r.bytes().await.unwrap_or_default();
            let same = body.as_ref() == local;
            let first_diff = body.iter().zip(local).position(|(a, b)| a != b);
            log::info!(
                "[诊断] 读回 status={} len={} 一致={} 首个差异位置={:?} 头16字节(远端)={:02x?} 头16字节(本地)={:02x?} 响应头={}",
                status,
                body.len(),
                same,
                first_diff,
                &body[..body.len().min(16)],
                &local[..local.len().min(16)],
                headers
            );
            if !same && status == 200 {
                let dump = std::env::temp_dir().join("olib-weread-readback.bin");
                let _ = tokio::fs::write(&dump, &body).await;
                log::info!("[诊断] 远端内容已存到 {:?}", dump);
            }
        }
    }
}

/// [诊断] 已知内容上传对照：同一内容分别经环境代理与直连 PUT，比较 ETag。不调 notify，不入书架。
pub async fn diag_known_payload() {
    let epub = tokio::fs::read(r"D:\Download\米和厘米.epub")
        .await
        .unwrap_or_default();
    let hello: &[u8] = b"hello olib";
    for plan in ["A", "B"] {
        let steps = if plan == "A" {
            vec![
                ("epub", epub.as_slice()),
                ("epub", epub.as_slice()),
                ("hello", hello),
                ("epub", epub.as_slice()),
            ]
        } else {
            vec![("hello", hello), ("epub", epub.as_slice())]
        };
        let Some((cred, host, uri)) = diag_cred(plan).await else {
            continue;
        };
        for (i, (name, payload)) in steps.into_iter().enumerate() {
            let label = format!("凭据{} 第{}步", plan, i + 1);
            diag_put(&cred, &host, &uri, &UPLOAD_HTTP, name, &label, payload).await;
        }
    }
    if let Some((cred, host, uri)) = diag_cred("C").await {
        if let Ok(file) = tokio::fs::File::open(r"D:\Download\米和厘米.epub").await {
            let body = Body::wrap_stream(progress_stream(
                file,
                epub.len() as u64,
                |_| {},
                Arc::new(AtomicU64::new(u64::MAX)),
            ));
            diag_put_body(
                &cred,
                (&host, &uri),
                &UPLOAD_HTTP,
                "epub",
                "凭据C 第1步（流式）",
                &epub,
                body,
            )
            .await;
            diag_put(
                &cred,
                &host,
                &uri,
                &UPLOAD_HTTP,
                "epub",
                "凭据C 第2步（整文件）",
                &epub,
            )
            .await;
        }
    }
}

async fn diag_cred(plan: &str) -> Option<(Credential, String, String)> {
    let resp = call(Request::get(
        "/cos/getcredential",
        vec![
            ("name", format!("olib-diag-{}", plan)),
            ("from", String::new()),
        ],
    ))
    .await
    .map_err(|e| log::info!("[诊断-已知内容] 取凭据失败: {}", e))
    .ok()?;
    let cred = parse_credential(&resp, chrono::Utc::now().timestamp())
        .map_err(|e| log::info!("[诊断-已知内容] 凭据无效: {}", e))
        .ok()?;
    let host = format!("{}.cos.accelerate.myqcloud.com", cred.bucket);
    let uri = encode_object_path(&cred.object_name);
    Some((cred, host, uri))
}

/// 凭据响应脱敏（隐去密钥与令牌）后打印结构
#[cfg(test)]
fn redact(v: &Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(
            m.iter()
                .map(|(k, v)| {
                    let hidden = ["TmpSecretId", "TmpSecretKey", "Token", "SessionToken"]
                        .contains(&k.as_str());
                    (k.clone(), if hidden { json!("***") } else { redact(v) })
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

#[cfg(test)]
async fn diag_with_cred_name(cred_name: &str) {
    const PAYLOAD: &[u8] = b"hello olib";
    let resp = match call(Request::get(
        "/cos/getcredential",
        vec![("name", cred_name.to_string()), ("from", String::new())],
    ))
    .await
    {
        Ok(r) => r,
        Err(e) => return log::info!("[诊断-已知内容] 取凭据失败: {}", e),
    };
    log::info!(
        "[诊断-已知内容] 凭据名={} 响应(脱敏)={}",
        cred_name,
        redact(&resp)
    );
    let cred = match parse_credential(&resp, chrono::Utc::now().timestamp()) {
        Ok(c) => c,
        Err(e) => return log::info!("[诊断-已知内容] 凭据无效: {}", e),
    };
    let host = format!("{}.cos.accelerate.myqcloud.com", cred.bucket);
    let uri = encode_object_path(&cred.object_name);
    let direct = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(60))
        .build()
        .expect("client");
    let all_bytes: Vec<u8> = (0..=255u8).collect();
    let epub = tokio::fs::read(r"D:\Download\米和厘米.epub")
        .await
        .unwrap_or_default();
    let _ = (PAYLOAD, &all_bytes);
    let payloads: [(&str, &[u8]); 2] = [("hello", PAYLOAD), ("米和厘米.epub", &epub)];
    for (name, payload) in payloads {
        let name = &format!("{}（凭据名={}）", name, cred_name);
        for (label, client) in [("经环境代理", &*UPLOAD_HTTP), ("强制直连", &direct)] {
            diag_put(&cred, &host, &uri, client, name, label, payload).await;
        }
    }
    diag_read_back(&host, &uri, &cred, &epub).await;
}

async fn diag_put(
    cred: &Credential,
    host: &str,
    uri: &str,
    client: &Client,
    name: &str,
    label: &str,
    payload: &[u8],
) {
    diag_put_body(
        cred,
        (host, uri),
        client,
        name,
        label,
        payload,
        Body::from(payload.to_vec()),
    )
    .await;
}

async fn diag_put_body(
    cred: &Credential,
    target: (&str, &str),
    client: &Client,
    name: &str,
    label: &str,
    payload: &[u8],
    body: Body,
) {
    let (host, uri) = target;
    {
        let now = chrono::Utc::now().timestamp();
        let auth = cos_authorization(
            &cred.secret_id,
            &cred.secret_key,
            host,
            uri,
            now,
            (now + 600).min(cred.expiry),
        );
        let r = client
            .put(format!("https://{}{}", host, uri))
            .header(AUTHORIZATION, auth)
            .header("x-cos-security-token", &cred.token)
            .header(CONTENT_TYPE, "application/octet-stream")
            .header(CONTENT_LENGTH, payload.len())
            .body(body)
            .send()
            .await;
        let local = diag_crc64(payload).to_string();
        match r {
            Ok(r) => {
                let remote = r
                    .headers()
                    .get("x-cos-hash-crc64ecma")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                log::info!(
                    "[诊断-已知内容] {} | {} | {} 字节 | status={} | 一致={} | 远端crc={} 本地crc={} | etag={:?}",
                    label,
                    name,
                    payload.len(),
                    r.status().as_u16(),
                    remote == local,
                    remote,
                    local,
                    r.headers().get("etag")
                )
            }
            Err(e) => log::info!("[诊断-已知内容] {} | {} 请求失败: {}", name, label, e),
        }
    }
}

/// [诊断] CRC-64/XZ（COS 的 x-cos-hash-crc64ecma 算法）
fn diag_crc64(data: &[u8]) -> u64 {
    !crc64_update(u64::MAX, data)
}

fn crc64_update(mut crc: u64, data: &[u8]) -> u64 {
    const POLY: u64 = 0xC96C_5795_D787_0F42;
    for &b in data {
        crc ^= b as u64;
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ POLY
            } else {
                crc >> 1
            };
        }
    }
    crc
}

/// 分块读文件作为请求体，百分比变化时回调已读字节数。
fn progress_stream<F>(
    file: tokio::fs::File,
    total: u64,
    on_progress: F,
    crc: Arc<AtomicU64>,
) -> impl futures_util::Stream<Item = std::io::Result<Vec<u8>>>
where
    F: Fn(u64) + Clone + Send + 'static,
{
    futures_util::stream::unfold((file, 0u64, u64::MAX), move |(mut file, sent, last_pct)| {
        let on_progress = on_progress.clone();
        let crc = crc.clone();
        async move {
            let mut buf = vec![0u8; CHUNK_SIZE];
            match file.read(&mut buf).await {
                Ok(0) => None,
                Ok(n) => {
                    buf.truncate(n);
                    crc.store(
                        crc64_update(crc.load(Ordering::Relaxed), &buf),
                        Ordering::Relaxed,
                    );
                    let sent = sent + n as u64;
                    let pct = sent * 100 / total.max(1);
                    if pct != last_pct {
                        on_progress(sent);
                    }
                    Some((Ok(buf), (file, sent, pct)))
                }
                // 出错后请求即中止，不会再轮询本流
                Err(e) => Some((Err(e), (file, sent, last_pct))),
            }
        }
    })
}

/// 按段做 encodeURIComponent（与移动端 `Uri.encodeComponent` 一致），保证以 `/` 开头。
fn encode_object_path(object_name: &str) -> String {
    let key = object_name.strip_prefix('/').unwrap_or(object_name);
    let encoded: Vec<String> = key.split('/').map(encode_component).collect();
    format!("/{}", encoded.join("/"))
}

fn encode_component(segment: &str) -> String {
    segment
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{:02X}", b)
            }
        })
        .collect()
}

/// 腾讯云 COS XML API 请求签名（q-sign-algorithm=sha1），仅签 host 头。
fn cos_authorization(
    secret_id: &str,
    secret_key: &str,
    host: &str,
    uri: &str,
    start: i64,
    end: i64,
) -> String {
    let key_time = format!("{};{}", start, end);
    let sign_key = hmac_sha1_hex(secret_key, &key_time);
    let http_string = format!("put\n{}\n\nhost={}\n", uri, host);
    let string_to_sign = format!("sha1\n{}\n{}\n", key_time, sha1_hex(&http_string));
    let signature = hmac_sha1_hex(&sign_key, &string_to_sign);
    format!(
        "q-sign-algorithm=sha1&q-ak={}&q-sign-time={}&q-key-time={}&q-header-list=host\
         &q-url-param-list=&q-signature={}",
        secret_id, key_time, key_time, signature
    )
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn sha1_hex(value: &str) -> String {
    to_hex(&Sha1::digest(value.as_bytes()))
}

fn hmac_sha1_hex(key: &str, value: &str) -> String {
    let mut mac = Hmac::<Sha1>::new_from_slice(key.as_bytes()).expect("HMAC accepts any key size");
    mac.update(value.as_bytes());
    to_hex(&mac.finalize().into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires a local WeRead session and uploads a temporary COS object"]
    async fn live_cos_integrity_diagnostic() {
        let app_data = std::env::var("APPDATA").expect("APPDATA is required");
        let app_data = Path::new(&app_data).join("com.shiyi0x7f.olibfluent");
        super::super::session::init(&app_data);
        env_logger::Builder::new()
            .filter_level(log::LevelFilter::Info)
            .is_test(true)
            .try_init()
            .expect("test logger should initialize once");
        diag_known_payload().await;
        diag_with_cred_name("olib-diag-integrity").await;
    }

    #[test]
    fn split_name_validates_extension() {
        assert_eq!(
            split_name("三体.EPUB").unwrap(),
            ("三体".to_string(), "epub".to_string())
        );
        assert_eq!(
            split_name("a.b.azw3").unwrap(),
            ("a.b".to_string(), "azw3".to_string())
        );
        assert!(split_name("x.docx").is_err());
        assert!(split_name("noext").is_err());
        assert!(split_name(".pdf").is_err());
    }

    #[test]
    fn hmac_sha1_matches_rfc2202() {
        assert_eq!(
            hmac_sha1_hex("Jefe", "what do ya want for nothing?"),
            "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79"
        );
        assert_eq!(sha1_hex("abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
    }

    #[test]
    fn object_path_is_encoded_per_segment() {
        assert_eq!(
            encode_object_path("/upload/a b/书.epub"),
            "/upload/a%20b/%E4%B9%A6.epub"
        );
        assert_eq!(encode_object_path("x/(1)!.txt"), "/x/(1)!.txt");
    }

    #[test]
    fn authorization_has_cos_fields() {
        let auth = cos_authorization("AKID", "KEY", "b.cos.accelerate.myqcloud.com", "/o", 1, 2);
        assert!(auth.starts_with("q-sign-algorithm=sha1&q-ak=AKID&q-sign-time=1;2&q-key-time=1;2"));
        assert!(auth.contains("&q-header-list=host&q-url-param-list=&q-signature="));
        let sig = auth.rsplit('=').next().unwrap();
        assert_eq!(sig.len(), 40);
    }

    #[test]
    fn crc64_matches_cos_test_vector() {
        assert_eq!(diag_crc64(b"123456789"), 0x995D_C9BB_DF19_39FA);
    }

    /// 起本地 TCP 服务接住原始请求，校验流式请求体逐字节到达、未被分块编码改写。
    #[tokio::test]
    async fn upload_body_reaches_server_byte_for_byte() {
        use tokio::io::AsyncWriteExt;

        // 跨多个分块的伪随机内容
        let data: Vec<u8> = (0..600_000u32)
            .map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8)
            .collect();
        let dir = std::env::temp_dir().join(format!("olib-import-test-{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join("book.epub");
        tokio::fs::write(&path, &data).await.unwrap();

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut raw = Vec::new();
            let mut buf = vec![0u8; 64 * 1024];
            // 读到客户端停下（等响应）为止
            while let Ok(Ok(n)) =
                tokio::time::timeout(Duration::from_millis(500), sock.read(&mut buf)).await
            {
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&buf[..n]);
            }
            sock.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n")
                .await
                .unwrap();
            raw
        });

        let size = data.len() as u64;
        let file = tokio::fs::File::open(&path).await.unwrap();
        let crc = Arc::new(AtomicU64::new(u64::MAX));
        let resp = Client::new()
            .put(format!("http://{}/o", addr))
            .header(CONTENT_TYPE, "application/octet-stream")
            .header(CONTENT_LENGTH, size)
            .body(Body::wrap_stream(progress_stream(
                file,
                size,
                |_| {},
                crc.clone(),
            )))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status().as_u16(), 200);

        let raw = server.await.unwrap();
        let split = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&raw[..split]).to_ascii_lowercase();
        let body = &raw[split + 4..];
        tokio::fs::remove_dir_all(&dir).await.ok();
        assert!(!head.contains("transfer-encoding"), "请求头: {}", head);
        assert_eq!(body.len(), data.len(), "请求头: {}", head);
        assert!(body == data.as_slice(), "请求体内容被改写");
        assert_eq!(!crc.load(Ordering::Relaxed), diag_crc64(&data));
    }

    fn credential_json(bucket: &str, object: &str, expiry: Value) -> Value {
        json!({
            "bucket": bucket,
            "ObjectName": object,
            "Response": {
                "ExpiredTime": expiry,
                "Credentials": { "TmpSecretId": "id", "TmpSecretKey": "key", "Token": "t" }
            }
        })
    }

    #[test]
    fn credential_rejects_unsafe_or_expired() {
        assert!(parse_credential(&credential_json("wr-1", "/u/a.epub", json!(200)), 100).is_ok());
        assert!(parse_credential(&credential_json("wr-1", "/u/a.epub", json!("200")), 100).is_ok());
        assert!(parse_credential(&credential_json("wr.1", "/u/a.epub", json!(200)), 100).is_err());
        assert!(parse_credential(&credential_json("wr-1", "//evil", json!(200)), 100).is_err());
        assert!(parse_credential(&credential_json("wr-1", "/u/../a", json!(200)), 100).is_err());
        assert!(parse_credential(&credential_json("wr-1", "/u/a.epub", json!(50)), 100).is_err());
        assert!(parse_credential(&json!({}), 100).is_err());
    }
}
