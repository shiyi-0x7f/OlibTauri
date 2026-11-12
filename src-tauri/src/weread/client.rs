//! 微信读书移动端接口的统一请求层。
//!
//! 伪装 Eink 2.1.2 客户端（与 olib-mobile `weread_mobile_client.dart` 对齐），
//! 携带扫码会话的 `vid` / `accessToken`；HTTP 401 或业务码 -2012 视为令牌过期，
//! 刷新一次后重放 GET 与可重放的 POST。日志不输出令牌与 vid。

use super::session::{self, Session};
use once_cell::sync::Lazy;
use rand::Rng;
use reqwest::header::CONTENT_TYPE;
use reqwest::{Client, RequestBuilder};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

pub const BASE_URL: &str = "https://i.weread.qq.com";
pub const USER_AGENT: &str =
    "WeRead/2.1.2 WRBrand/Onyx wr_eink Dalvik/2.1.0 (Linux; U; Android 11; BOOX Build/onyx)";
const VERSION_HEADERS: [(&str, &str); 5] = [
    ("baseapi", "30"),
    ("appver", "2.1.2.10245900"),
    ("basever", "2.1.2.10245900"),
    ("osver", "11"),
    ("channelId", "900"),
];
const JSON_UTF8: &str = "application/json; charset=UTF-8";
const TOKEN_EXPIRED: i64 = -2012;
pub const NOT_CONNECTED: &str = "未连接微信读书，请先扫码连接";
const SESSION_INVALID: &str = "微信读书会话已失效，请重新扫码连接";

/// 长轮询（扫码）与 AI 回答都可能挂起较久，统一放宽读超时。
static HTTP: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(70))
        .build()
        .expect("Failed to create WeRead HTTP client")
});

/// 串行化令牌刷新，避免并发请求同时过期时重复刷新。
static REFRESH_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

pub fn http() -> &'static Client {
    &HTTP
}

/// 附加客户端版本头与 UA。
pub fn with_version_headers(builder: RequestBuilder) -> RequestBuilder {
    VERSION_HEADERS
        .iter()
        .fold(builder, |b, (k, v)| b.header(*k, *v))
        .header("User-Agent", USER_AGENT)
}

#[derive(Clone, Copy, PartialEq)]
pub enum Method {
    Get,
    Post,
}

pub struct Request<'a> {
    pub method: Method,
    pub path: &'a str,
    pub query: Vec<(&'a str, String)>,
    pub body: Option<Value>,
    /// POST 是否可安全重放（只读型 POST 为 true；写操作为 false）。
    pub replayable: bool,
}

impl<'a> Request<'a> {
    pub fn get(path: &'a str, query: Vec<(&'a str, String)>) -> Self {
        Self {
            method: Method::Get,
            path,
            query,
            body: None,
            replayable: true,
        }
    }

    pub fn post(path: &'a str, body: Value, replayable: bool) -> Self {
        Self {
            method: Method::Post,
            path,
            query: Vec::new(),
            body: Some(body),
            replayable,
        }
    }
}

/// 以当前会话调用移动端接口，返回响应 JSON 对象。
pub async fn call(req: Request<'_>) -> Result<Value, String> {
    let mut current = session::current().ok_or(NOT_CONNECTED)?;
    for attempt in 0..2 {
        let url = format!("{}{}", BASE_URL, req.path);
        let mut builder = match req.method {
            Method::Get => http().get(&url),
            Method::Post => http().post(&url),
        };
        builder = with_version_headers(builder)
            .header("vid", &current.vid)
            .header("accessToken", &current.access_token)
            .query(&req.query);
        if let Some(body) = &req.body {
            builder = builder
                .header(CONTENT_TYPE, JSON_UTF8)
                .body(body.to_string());
        }
        let resp = builder
            .send()
            .await
            .map_err(|e| format!("微信读书 {} 请求失败: {}", req.path, e))?;
        let status = resp.status().as_u16();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("微信读书 {} 读取响应失败: {}", req.path, e))?;

        let expired_http = status == 401;
        let map = if expired_http {
            Map::new()
        } else {
            parse_body(&text, req.path)?
        };
        let code = if expired_http {
            None
        } else {
            error_code(&map, req.path)?
        };

        if (expired_http || code == Some(TOKEN_EXPIRED)) && attempt == 0 {
            refresh(&current).await?;
            if req.method == Method::Get || req.replayable {
                current = session::current().ok_or(NOT_CONNECTED)?;
                continue;
            }
            return Err("微信读书会话已刷新，本次写入结果未知，请检查后再试".to_string());
        }

        if status >= 400 || code.is_some_and(|c| c != 0) {
            return Err(describe_failure(req.path, status, code, &map));
        }
        return Ok(Value::Object(map));
    }
    Err(format!("微信读书 {} 重试后仍失败", req.path))
}

/// 以 JSON 解析响应体（微信侧常给错误的 Content-Type，故不看头）。
pub fn parse_body(text: &str, op: &str) -> Result<Map<String, Value>, String> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(format!("微信读书 {} 返回了非对象 JSON", op)),
        Err(_) => Err(format!("微信读书 {} 返回了非 JSON 内容", op)),
    }
}

/// 读取 `errCode` / `errcode`（数字或数字字符串）；字段不存在为 None。
pub fn error_code(map: &Map<String, Value>, op: &str) -> Result<Option<i64>, String> {
    let raw = map.get("errCode").or_else(|| map.get("errcode"));
    match raw {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_i64()
            .map(Some)
            .ok_or_else(|| format!("微信读书 {} 错误码无效", op)),
        Some(Value::String(s)) => s
            .trim()
            .parse::<i64>()
            .map(Some)
            .map_err(|_| format!("微信读书 {} 错误码无效", op)),
        Some(_) => Err(format!("微信读书 {} 错误码无效", op)),
    }
}

fn describe_failure(op: &str, status: u16, code: Option<i64>, map: &Map<String, Value>) -> String {
    let msg = map
        .get("errMsg")
        .or_else(|| map.get("errmsg"))
        .and_then(Value::as_str)
        .map(|s| s.chars().take(120).collect::<String>())
        .filter(|s| !s.is_empty());
    let code = code.map_or_else(|| "无".to_string(), |c| c.to_string());
    match msg {
        Some(m) => format!(
            "微信读书 {} 失败（HTTP {}，code {}）：{}",
            op, status, code, m
        ),
        None => format!("微信读书 {} 失败（HTTP {}，code {}）", op, status, code),
    }
}

/// 登录 / 刷新签名：`sha256_hex("{timestamp_ms}{deviceId}{random}")`。
pub fn sign(timestamp_ms: i64, device_id: &str, random: u32) -> String {
    let digest = Sha256::digest(format!("{}{}{}", timestamp_ms, device_id, random).as_bytes());
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn random_digits(count: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..count)
        .map(|_| char::from(b'0' + rng.gen_range(0..10u8)))
        .collect()
}

/// 调用 `/login`（扫码换令牌与刷新令牌共用），返回响应对象。
pub async fn post_login(body: Value, op: &str) -> Result<Map<String, Value>, String> {
    let resp = with_version_headers(http().post(format!("{}/login", BASE_URL)))
        .header(CONTENT_TYPE, JSON_UTF8)
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("微信读书 {} 请求失败: {}", op, e))?;
    let status = resp.status().as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("微信读书 {} 读取响应失败: {}", op, e))?;
    let map = parse_body(&text, op)?;
    if status >= 400 {
        let code = error_code(&map, op).ok().flatten();
        return Err(describe_failure(op, status, code, &map));
    }
    Ok(map)
}

fn non_empty_str(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 从 `/login` 响应提取凭据；`vid` 可能是数字。
pub fn credentials(map: &Map<String, Value>) -> Option<(String, String, String)> {
    let vid = match map.get("vid") {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => return None,
    };
    Some((
        vid,
        non_empty_str(map, "accessToken")?,
        non_empty_str(map, "refreshToken")?,
    ))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn refresh(stale: &Session) -> Result<(), String> {
    let _guard = REFRESH_LOCK.lock().await;
    let current = session::current().ok_or(NOT_CONNECTED)?;
    if current.access_token != stale.access_token {
        // 等锁期间已由其他请求刷新
        return Ok(());
    }
    let timestamp = now_ms();
    let random: u32 = rand::thread_rng().gen_range(1..=1000);
    let body = json!({
        "deviceId": current.device_id,
        "deviceName": "BOOX",
        "inBackground": 0,
        "kickType": 1,
        "random": random,
        "refCgi": "",
        "refreshToken": current.refresh_token,
        "signature": sign(timestamp, &current.device_id, random),
        "timestamp": timestamp,
        "trackId": "",
        "deviceType": 3,
    });
    let map = post_login(body, "会话刷新")
        .await
        .map_err(|e| format!("{}（{}）", SESSION_INVALID, e))?;

    let vid = match map.get("vid") {
        None | Some(Value::Null) => current.vid.clone(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(_) => String::new(),
    };
    let access = non_empty_str(&map, "accessToken");
    let refresh = non_empty_str(&map, "refreshToken").unwrap_or(current.refresh_token.clone());
    match access {
        Some(access) if vid == current.vid => {
            log::info!("微信读书令牌已刷新");
            session::save(Session {
                vid,
                access_token: access,
                refresh_token: refresh,
                device_id: current.device_id,
            })
        }
        _ => Err(format!(
            "{}（刷新返回的账号不一致或凭据不完整）",
            SESSION_INVALID
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_is_lowercase_sha256_hex() {
        let s = sign(1700000000000, "eink3346912250000000000000000000", 42);
        assert_eq!(s.len(), 64);
        assert!(s
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        // sha256("abc") 已知向量，验证拼接后哈希与编码方式
        let digest = Sha256::digest(b"abc");
        let hex: String = digest.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(
            hex,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn random_digits_has_requested_length() {
        let d = random_digits(19);
        assert_eq!(d.len(), 19);
        assert!(d.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn error_code_accepts_both_spellings_and_string_numbers() {
        let m = parse_body(r#"{"errCode":-2012}"#, "t").unwrap();
        assert_eq!(error_code(&m, "t").unwrap(), Some(-2012));
        let m = parse_body(r#"{"errcode":"0"}"#, "t").unwrap();
        assert_eq!(error_code(&m, "t").unwrap(), Some(0));
        let m = parse_body(r#"{"books":[]}"#, "t").unwrap();
        assert_eq!(error_code(&m, "t").unwrap(), None);
        let m = parse_body(r#"{"errcode":"x"}"#, "t").unwrap();
        assert!(error_code(&m, "t").is_err());
    }

    #[test]
    fn parse_body_rejects_non_object() {
        assert!(parse_body("[1]", "t").is_err());
        assert!(parse_body("<html>", "t").is_err());
    }

    #[test]
    fn credentials_accept_numeric_vid() {
        let m = parse_body(r#"{"vid":123,"accessToken":"a","refreshToken":"r"}"#, "t").unwrap();
        assert_eq!(
            credentials(&m),
            Some(("123".to_string(), "a".to_string(), "r".to_string()))
        );
        let m = parse_body(r#"{"vid":123,"accessToken":"","refreshToken":"r"}"#, "t").unwrap();
        assert_eq!(credentials(&m), None);
    }
}
