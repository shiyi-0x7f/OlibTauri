use crate::{api::ZLibrary, config, database};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchParams {
    pub title: String,
    pub page: Option<i64>,
    pub limit: Option<i64>,
    pub order: Option<String>,
    pub languages: Option<Vec<String>>,
    pub extensions: Option<Vec<String>>,
    pub year_from: Option<String>,
    pub year_to: Option<String>,
    pub exact: Option<bool>,
}

#[tauri::command]
pub async fn search_books(
    _app: AppHandle,
    params: SearchParams,
) -> Result<serde_json::Value, String> {
    log::info!("🔍 search_books called with title: {}", params.title);
    log::debug!("Search params: {:?}", params);


    let cfg = config::get_config()?;
    log::info!(
        "📋 Config loaded - host_index: {}, search_limit: {}",
        cfg.host_index,
        cfg.search_limit
    );

    // Get user credentials for authenticated search
    let user = if !cfg.user_email.is_empty() {
        log::info!("👤 Loading user: {}", cfg.user_email);
        database::get_user(&cfg.user_email)?
    } else {
        log::warn!("⚠️  No user email configured, searching anonymously");
        None
    };

    let mut client = ZLibrary::new(cfg.host_index);
    log::info!(
        "🌐 ZLibrary client created with host index: {}",
        cfg.host_index
    );

    // Login with saved token if available
    if let Some(user) = &user {
        if let (Some(uid), Some(ukey)) = (&user.remix_user_id, &user.remix_user_key) {
            log::info!("🔐 Logging in with saved token for user: {}", user.email);
            client.login_with_token(uid, ukey);
        } else {
            log::warn!("⚠️  User found but no remix credentials available");
        }
    }

    log::info!("🚀 Starting search...");
    let result = client
        .search(
            &params.title,
            params.page,
            params.limit.or(Some(cfg.search_limit)),
            params.order.as_deref(),
            params.languages.as_ref(),
            params.extensions.as_ref(),
            params.year_from.as_deref(),
            params.year_to.as_deref(),
            params.exact,
        )
        .await;

    match &result {
        Ok(data) => {
            log::info!("✅ Search completed successfully");
            log::debug!("Search result: {:?}", data);
        }
        Err(e) => {
            log::error!("❌ Search failed: {}", e);
        }
    }

    result
}
