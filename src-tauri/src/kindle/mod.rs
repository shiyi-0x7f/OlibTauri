//! Send to Kindle：通过用户自己的邮箱 SMTP，把本地书籍作为附件发到 `@kindle.com` 地址。
//! 不依赖 Z-Library 接口。配置（含授权码）存 SQLite，见 [`store`]。

pub mod sender;
pub mod store;

use serde::{Deserialize, Serialize};

/// SMTP 连接加密方式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Security {
    /// 连接即 TLS（常标为 SSL/TLS），标准端口 465
    Tls,
    /// 明文连接后升级，标准端口 587
    Starttls,
}

impl Security {
    /// 按端口推断：465 为隐式 TLS，其余按 STARTTLS（前端据此预选，用户可改）
    pub fn for_port(port: u16) -> Self {
        if port == 465 {
            Self::Tls
        } else {
            Self::Starttls
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Tls => "tls",
            Self::Starttls => "starttls",
        }
    }

    fn parse(s: &str) -> Self {
        if s == "tls" {
            Self::Tls
        } else {
            Self::Starttls
        }
    }
}

/// 完整配置（含授权码，仅后端持有）
#[derive(Debug, Clone)]
pub struct KindleSettings {
    pub to: String,
    pub from: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub security: Security,
    pub password: String,
}

/// 返回给前端的配置：不回传授权码，只告知是否已保存
#[derive(Debug, Serialize)]
pub struct KindleSettingsView {
    pub to: String,
    pub from: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub security: Security,
    pub has_password: bool,
}

/// 前端提交的配置；`password` 为空表示沿用已保存的授权码
#[derive(Debug, Deserialize)]
pub struct KindleSettingsInput {
    pub to: String,
    pub from: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub security: Security,
    pub password: Option<String>,
}

impl From<&KindleSettings> for KindleSettingsView {
    fn from(s: &KindleSettings) -> Self {
        Self {
            to: s.to.clone(),
            from: s.from.clone(),
            smtp_host: s.smtp_host.clone(),
            smtp_port: s.smtp_port,
            security: s.security,
            has_password: !s.password.is_empty(),
        }
    }
}

impl KindleSettingsInput {
    /// 合并已保存的授权码并去除首尾空白
    pub fn into_settings(self, saved: Option<&KindleSettings>) -> KindleSettings {
        let password = match self.password.as_deref().map(str::trim) {
            Some(p) if !p.is_empty() => p.to_string(),
            _ => saved.map(|s| s.password.clone()).unwrap_or_default(),
        };
        KindleSettings {
            to: self.to.trim().to_string(),
            from: self.from.trim().to_string(),
            smtp_host: self.smtp_host.trim().to_string(),
            smtp_port: self.smtp_port,
            security: self.security,
            password,
        }
    }
}

impl KindleSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.to.parse::<lettre::Address>().is_err() {
            return Err("Kindle 收件地址格式不正确".to_string());
        }
        if self.from.parse::<lettre::Address>().is_err() {
            return Err("发件邮箱格式不正确".to_string());
        }
        if self.smtp_host.is_empty() {
            return Err("请填写 SMTP 服务器".to_string());
        }
        if self.smtp_port == 0 {
            return Err("SMTP 端口无效".to_string());
        }
        if self.password.is_empty() {
            return Err("请填写邮箱授权码".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> KindleSettings {
        KindleSettings {
            to: "me@kindle.com".into(),
            from: "me@qq.com".into(),
            smtp_host: "smtp.qq.com".into(),
            smtp_port: 465,
            security: Security::Tls,
            password: "code".into(),
        }
    }

    #[test]
    fn security_follows_port() {
        assert_eq!(Security::for_port(465), Security::Tls);
        assert_eq!(Security::for_port(587), Security::Starttls);
        assert_eq!(Security::parse(Security::Tls.as_str()), Security::Tls);
        assert_eq!(Security::parse("starttls"), Security::Starttls);
    }

    #[test]
    fn validate_rejects_bad_fields() {
        assert!(settings().validate().is_ok());
        let mut s = settings();
        s.to = "not-an-email".into();
        assert!(s.validate().is_err());
        let mut s = settings();
        s.password.clear();
        assert!(s.validate().is_err());
    }

    #[test]
    fn empty_password_keeps_saved_one() {
        let saved = settings();
        let input = KindleSettingsInput {
            to: " me@kindle.com ".into(),
            from: "me@qq.com".into(),
            smtp_host: "smtp.qq.com".into(),
            smtp_port: 465,
            security: Security::Tls,
            password: Some("  ".into()),
        };
        let merged = input.into_settings(Some(&saved));
        assert_eq!(merged.password, "code");
        assert_eq!(merged.to, "me@kindle.com");
    }
}
