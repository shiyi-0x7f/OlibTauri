use crate::kindle::{sender, store, KindleSettingsInput, KindleSettingsView};
use std::path::PathBuf;

fn load_required() -> Result<crate::kindle::KindleSettings, String> {
    store::load()?.ok_or_else(|| "尚未配置 Kindle，请先到「设置 → Kindle」填写".to_string())
}

/// 读取 Kindle 配置（不含授权码）；未配置返回 null
#[tauri::command]
pub fn get_kindle_settings() -> Result<Option<KindleSettingsView>, String> {
    Ok(store::load()?.as_ref().map(KindleSettingsView::from))
}

/// 校验并保存 Kindle 配置；授权码留空则沿用已保存的
#[tauri::command]
pub fn save_kindle_settings(input: KindleSettingsInput) -> Result<KindleSettingsView, String> {
    let saved = store::load()?;
    let settings = input.into_settings(saved.as_ref());
    settings.validate()?;
    store::save(&settings)?;
    log::info!(
        "Kindle 配置已保存（SMTP {}:{}）",
        settings.smtp_host,
        settings.smtp_port
    );
    Ok(KindleSettingsView::from(&settings))
}

/// 用已保存配置登录 SMTP 验证，不发信
#[tauri::command]
pub async fn test_kindle_smtp() -> Result<(), String> {
    sender::test_connection(&load_required()?).await
}

/// 把本地文件发送到 Kindle
#[tauri::command]
pub async fn send_to_kindle(path: String) -> Result<(), String> {
    let settings = load_required()?;
    let path = PathBuf::from(path);
    log::info!("📮 Send to Kindle: {:?}", path.file_name());
    sender::send_file(&settings, &path).await.inspect_err(|e| {
        log::error!("❌ Send to Kindle 失败: {}", e);
    })?;
    log::info!("✅ Send to Kindle 完成: {:?}", path.file_name());
    Ok(())
}
