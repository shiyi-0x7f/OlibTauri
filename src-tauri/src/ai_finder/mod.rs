//! AI 寻书（阅读锦囊）BYOK：用户自带 API Key，直连 OpenAI 兼容接口（`{base_url}/chat/completions`）。
//! 配置（含 Key）存 SQLite，见 [`store`]；prompt 与结果校验见 [`prompt`]（移植自原 olibai 服务端）。

pub mod client;
pub mod prompt;
pub mod store;

use serde::{Deserialize, Serialize};

/// 默认推荐数量（与原服务端一致）
pub const DEFAULT_TIP_COUNT: u8 = 3;
/// 推荐数量上限：书太多时单次回复过长、易被截断导致 JSON 不完整
pub const MAX_TIP_COUNT: u8 = 10;
/// 用户补充要求的长度上限（字符）
pub const MAX_EXTRA_PROMPT_CHARS: usize = 300;

/// 完整配置（含 API Key，仅后端持有）
#[derive(Debug, Clone)]
pub struct AiSettings {
    /// 前端预设 id（deepseek / siliconflow / … / custom），仅用于回显
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    /// 每次推荐几本书
    pub tip_count: u8,
    /// 追加到内置 prompt 后的用户偏好（空 = 无）
    pub extra_prompt: String,
}

/// 返回给前端的配置：不回传 Key
#[derive(Debug, Serialize)]
pub struct AiSettingsView {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
    pub tip_count: u8,
    pub extra_prompt: String,
}

/// 前端提交的配置；`api_key` 为空表示沿用已保存的
#[derive(Debug, Deserialize)]
pub struct AiSettingsInput {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub tip_count: u8,
    pub extra_prompt: String,
}

impl From<&AiSettings> for AiSettingsView {
    fn from(s: &AiSettings) -> Self {
        Self {
            provider: s.provider.clone(),
            base_url: s.base_url.clone(),
            model: s.model.clone(),
            has_key: !s.api_key.is_empty(),
            tip_count: s.tip_count,
            extra_prompt: s.extra_prompt.clone(),
        }
    }
}

/// 去掉首尾空白与结尾 `/`，便于拼接 `/chat/completions`
pub fn normalize_base_url(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

impl AiSettingsInput {
    pub fn into_settings(self, saved: Option<&AiSettings>) -> AiSettings {
        let api_key = match self.api_key.as_deref().map(str::trim) {
            Some(k) if !k.is_empty() => k.to_string(),
            _ => saved.map(|s| s.api_key.clone()).unwrap_or_default(),
        };
        AiSettings {
            provider: self.provider.trim().to_string(),
            base_url: normalize_base_url(&self.base_url),
            model: self.model.trim().to_string(),
            api_key,
            tip_count: self.tip_count.clamp(1, MAX_TIP_COUNT),
            extra_prompt: self.extra_prompt.trim().to_string(),
        }
    }
}

impl AiSettings {
    pub fn validate(&self) -> Result<(), String> {
        if !(self.base_url.starts_with("https://") || self.base_url.starts_with("http://")) {
            return Err("接口地址需以 http:// 或 https:// 开头".to_string());
        }
        if self.api_key.is_empty() {
            return Err("请填写 API Key".to_string());
        }
        if self.model.is_empty() {
            return Err("请选择或填写模型".to_string());
        }
        if self.extra_prompt.chars().count() > MAX_EXTRA_PROMPT_CHARS {
            return Err(format!("补充要求最多 {} 字", MAX_EXTRA_PROMPT_CHARS));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(key: Option<&str>) -> AiSettingsInput {
        AiSettingsInput {
            provider: "deepseek".into(),
            base_url: " https://api.deepseek.com/ ".into(),
            model: " deepseek-v4-flash ".into(),
            api_key: key.map(Into::into),
            tip_count: 3,
            extra_prompt: "  只推荐中文书 ".into(),
        }
    }

    #[test]
    fn clamps_count_and_trims_extra_prompt() {
        let mut i = input(Some("sk"));
        i.tip_count = 0;
        assert_eq!(i.into_settings(None).tip_count, 1);
        let mut i = input(Some("sk"));
        i.tip_count = 50;
        let s = i.into_settings(None);
        assert_eq!(s.tip_count, MAX_TIP_COUNT);
        assert_eq!(s.extra_prompt, "只推荐中文书");
        let mut s = input(Some("sk")).into_settings(None);
        s.extra_prompt = "长".repeat(MAX_EXTRA_PROMPT_CHARS + 1);
        assert!(s.validate().is_err());
    }

    #[test]
    fn normalizes_and_keeps_saved_key() {
        let saved = input(Some("sk-old")).into_settings(None);
        assert_eq!(saved.base_url, "https://api.deepseek.com");
        assert_eq!(saved.model, "deepseek-v4-flash");
        let merged = input(Some("  ")).into_settings(Some(&saved));
        assert_eq!(merged.api_key, "sk-old");
        let replaced = input(Some("sk-new")).into_settings(Some(&saved));
        assert_eq!(replaced.api_key, "sk-new");
    }

    #[test]
    fn validate_requires_fields() {
        assert!(input(Some("sk")).into_settings(None).validate().is_ok());
        assert!(input(None).into_settings(None).validate().is_err());
        let mut s = input(Some("sk")).into_settings(None);
        s.base_url = "api.deepseek.com".into();
        assert!(s.validate().is_err());
        let mut s = input(Some("sk")).into_settings(None);
        s.model.clear();
        assert!(s.validate().is_err());
    }
}
