use crate::ai_finder::{
    client, normalize_base_url, prompt::ReadingBag, store, AiSettingsInput, AiSettingsView,
};

/// 未配置 AI 服务时的错误码，前端据此引导去设置页
const NEED_AI_CONFIG: &str = "NEED_AI_CONFIG";

/// 读取 AI 服务配置（不含 Key）；未配置返回 null
#[tauri::command]
pub fn get_ai_settings() -> Result<Option<AiSettingsView>, String> {
    Ok(store::load()?.as_ref().map(AiSettingsView::from))
}

/// 校验并保存；Key 留空则沿用已保存的
#[tauri::command]
pub fn save_ai_settings(input: AiSettingsInput) -> Result<AiSettingsView, String> {
    let saved = store::load()?;
    let settings = input.into_settings(saved.as_ref());
    settings.validate()?;
    store::save(&settings)?;
    log::info!(
        "AI 服务配置已保存（{} · {}）",
        settings.base_url,
        settings.model
    );
    Ok(AiSettingsView::from(&settings))
}

/// 用已保存配置发一条极短请求验证可用
#[tauri::command]
pub async fn test_ai_settings() -> Result<(), String> {
    let settings = store::load()?.ok_or(NEED_AI_CONFIG)?;
    client::test(&settings).await
}

/// 列出模型；`api_key` 为空时用已保存的 Key（编辑地址但未改 Key 的情况）
#[tauri::command]
pub async fn list_ai_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let key = match api_key.map(|k| k.trim().to_string()) {
        Some(k) if !k.is_empty() => k,
        _ => store::load()?
            .map(|s| s.api_key)
            .filter(|k| !k.is_empty())
            .ok_or("请先填写 API Key")?,
    };
    client::list_models(&normalize_base_url(&base_url), &key).await
}

/// 生成阅读锦囊。未配置返回 `NEED_AI_CONFIG`。
#[tauri::command]
pub async fn ai_find_books(
    input: String,
    input_type: Option<String>,
) -> Result<ReadingBag, String> {
    let settings = store::load()?.ok_or(NEED_AI_CONFIG)?;
    let bag = client::find_books(
        &settings,
        input.trim(),
        input_type.as_deref().unwrap_or("auto"),
    )
    .await
    .inspect_err(|e| log::error!("AI 寻书失败: {}", e))?;
    Ok(bag)
}
