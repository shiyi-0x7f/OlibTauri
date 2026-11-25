//! OpenAI 兼容接口调用：`POST {base}/chat/completions`、`GET {base}/models`。

use super::prompt::{self, ReadingBag};
use super::AiSettings;
use std::time::Duration;

/// 推理模型较慢，给足时间
const CHAT_TIMEOUT: Duration = Duration::from_secs(90);
const MODELS_TIMEOUT: Duration = Duration::from_secs(15);
/// 模型偶发不按格式输出时的重试次数（与原服务端一致）
const PARSE_ATTEMPTS: usize = 2;
/// 输出上限：最多 10 本书 + 推理模型的思考开销；按实际生成计费，上限高不多花钱
const MAX_OUTPUT_TOKENS: u32 = 4096;

fn http(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))
}

/// 把服务商的错误响应翻成可读文案，并附上原始错误信息便于排查
fn api_error(status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.get("message"))
                .or_else(|| v.get("error"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    let summary = match status.as_u16() {
        401 | 403 => "API Key 无效或无权限",
        402 => "账户余额不足",
        404 => "接口地址或模型不存在",
        429 => "请求太频繁或额度已用尽",
        _ => "AI 服务返回错误",
    };
    format!("{}（HTTP {}）：{}", summary, status.as_u16(), detail)
}

/// 请求体。`reasoning_compat` 用于推理模型（如 OpenAI o 系列）：它们拒绝 `max_tokens` 与非默认 temperature，
/// 需改用 `max_completion_tokens`、不传 temperature。
fn chat_body(
    s: &AiSettings,
    content: &str,
    max_tokens: u32,
    reasoning_compat: bool,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": s.model,
        "messages": [{ "role": "user", "content": content }],
    });
    if reasoning_compat {
        body["max_completion_tokens"] = max_tokens.into();
    } else {
        body["temperature"] = 0.8.into();
        body["max_tokens"] = max_tokens.into();
    }
    body
}

/// 400 报错是否指向 `max_tokens` / `temperature` 参数不被支持（推理模型）
fn needs_reasoning_compat(status: reqwest::StatusCode, body: &str) -> bool {
    status == reqwest::StatusCode::BAD_REQUEST
        && (body.contains("max_completion_tokens")
            || (body.contains("temperature") && body.to_lowercase().contains("unsupported")))
}

/// 返回解析后的响应体；参数不兼容时自动换推理模型参数重试一次
async fn chat(s: &AiSettings, content: &str, max_tokens: u32) -> Result<serde_json::Value, String> {
    let client = http(CHAT_TIMEOUT)?;
    let mut reasoning_compat = false;
    loop {
        let resp = client
            .post(format!("{}/chat/completions", s.base_url))
            .bearer_auth(&s.api_key)
            .json(&chat_body(s, content, max_tokens, reasoning_compat))
            .send()
            .await
            .map_err(|e| format!("连接 AI 服务失败: {}", e))?;
        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| format!("读取 AI 响应失败: {}", e))?;
        if status.is_success() {
            return serde_json::from_str(&body).map_err(|e| format!("AI 响应解析失败: {}", e));
        }
        if !reasoning_compat && needs_reasoning_compat(status, &body) {
            log::info!(
                "模型 {} 不支持 max_tokens/temperature，改用推理模型参数重试",
                s.model
            );
            reasoning_compat = true;
            continue;
        }
        return Err(api_error(status, &body));
    }
}

fn message_content(v: &serde_json::Value) -> Result<String, String> {
    v.pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .filter(|c| !c.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "AI 响应中没有内容".to_string())
}

/// 发一条极短的请求，验证地址、Key、模型三者可用。
/// 只看请求是否成功：推理模型在极小额度下可能把 token 全用于思考而返回空内容。
pub async fn test(s: &AiSettings) -> Result<(), String> {
    s.validate()?;
    chat(s, "回复 OK", 16).await.map(|_| ())
}

/// 列出服务商可用模型；部分服务商（如套餐专用入口）不提供此接口，前端需允许手填
pub async fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let resp = http(MODELS_TIMEOUT)?
        .get(format!("{}/models", base_url))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("连接 AI 服务失败: {}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取模型列表失败: {}", e))?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("模型列表解析失败: {}", e))?;
    let mut models: Vec<String> = v
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

/// 生成阅读锦囊；模型输出格式偶发偏差时重试
pub async fn find_books(
    s: &AiSettings,
    input: &str,
    input_type: &str,
) -> Result<ReadingBag, String> {
    s.validate()?;
    let prompt = prompt::build_prompt(input, input_type, s.tip_count, &s.extra_prompt);
    let max_tips = usize::from(s.tip_count);
    let mut last_error = String::new();
    for attempt in 1..=PARSE_ATTEMPTS {
        let text = message_content(&chat(s, &prompt, MAX_OUTPUT_TOKENS).await?)?;
        match prompt::extract_json(&text).and_then(|v| prompt::validate_reading_bag(&v, max_tips)) {
            Ok(bag) => return Ok(bag),
            Err(e) => {
                log::warn!("AI 寻书结果解析失败（第 {} 次）: {}", attempt, e);
                last_error = e;
            }
        }
    }
    Err(format!(
        "AI 返回格式异常，请重试或换个模型（{}）",
        last_error
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> AiSettings {
        AiSettings {
            provider: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            model: "m".into(),
            api_key: "k".into(),
            tip_count: 3,
            extra_prompt: String::new(),
        }
    }

    #[test]
    fn chat_body_switches_params_for_reasoning_models() {
        let normal = chat_body(&settings(), "hi", 100, false);
        assert_eq!(normal["max_tokens"], 100);
        assert_eq!(normal["temperature"], 0.8);
        assert!(normal.get("max_completion_tokens").is_none());
        let compat = chat_body(&settings(), "hi", 100, true);
        assert_eq!(compat["max_completion_tokens"], 100);
        assert!(compat.get("max_tokens").is_none() && compat.get("temperature").is_none());
    }

    #[test]
    fn detects_unsupported_param_errors() {
        let bad = reqwest::StatusCode::BAD_REQUEST;
        assert!(needs_reasoning_compat(
            bad,
            r#"{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."}}"#
        ));
        assert!(needs_reasoning_compat(
            bad,
            r#"{"error":{"message":"Unsupported value: 'temperature' does not support 0.8"}}"#
        ));
        assert!(!needs_reasoning_compat(
            bad,
            r#"{"error":{"message":"model not found"}}"#
        ));
        assert!(!needs_reasoning_compat(
            reqwest::StatusCode::UNAUTHORIZED,
            "max_completion_tokens"
        ));
    }

    #[test]
    fn message_content_rejects_empty() {
        let ok = serde_json::json!({"choices":[{"message":{"content":"{}"}}]});
        assert_eq!(message_content(&ok).unwrap(), "{}");
        let empty = serde_json::json!({"choices":[{"message":{"content":"  "}}]});
        assert!(message_content(&empty).is_err());
    }

    #[test]
    fn api_error_prefers_provider_message() {
        let msg = api_error(
            reqwest::StatusCode::UNAUTHORIZED,
            r#"{"error":{"message":"Invalid API key"}}"#,
        );
        assert!(msg.contains("API Key 无效"));
        assert!(msg.contains("Invalid API key"));
        let msg = api_error(
            reqwest::StatusCode::PAYMENT_REQUIRED,
            "Insufficient Balance",
        );
        assert!(msg.contains("余额不足") && msg.contains("Insufficient Balance"));
    }
}
