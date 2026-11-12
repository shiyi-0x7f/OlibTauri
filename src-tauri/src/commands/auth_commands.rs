use crate::{api::ZLibrary, config, database, hosts};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResult {
    pub success: bool,
    pub message: String,
    pub user_name: Option<String>,
}

/// Try to login on a specific host, returning the response + client on success
async fn try_login_on_host(
    host_index: usize,
    email: &str,
    password: &str,
) -> Result<(serde_json::Value, ZLibrary), String> {
    let host_name = hosts::get_host(host_index);
    log::info!("🌐 Trying login on host #{} ({})", host_index, host_name);
    let mut client = ZLibrary::new(host_index);
    let resp = client.login(email, password).await?;
    Ok((resp, client))
}

#[tauri::command]
pub async fn login(email: String, password: String) -> Result<LoginResult, String> {
    log::info!("🔐 Login attempt for: {}", email);

    let configured_index = config::get_config().map(|c| c.host_index).unwrap_or(0);

    let all_hosts = hosts::get_hosts();
    let total = all_hosts.len();
    let max_attempts = total.min(5); // Try up to 5 hosts

    // Build the list of host indices to try: configured first, then others
    let mut indices_to_try: Vec<usize> = Vec::with_capacity(max_attempts);
    indices_to_try.push(configured_index);
    for i in 0..total {
        if i != configured_index && indices_to_try.len() < max_attempts {
            indices_to_try.push(i);
        }
    }

    let mut last_error = String::new();

    for &host_index in &indices_to_try {
        match try_login_on_host(host_index, &email, &password).await {
            Ok((resp, client)) => {
                // Check if login was actually successful
                let success = resp.get("success").and_then(|v| v.as_i64()).unwrap_or(0) == 1;

                if !success {
                    // This is a genuine login failure (wrong password etc), not a host issue
                    let error = resp
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown error");
                    log::error!("❌ Login failed for {}: {}", email, error);
                    return Ok(LoginResult {
                        success: false,
                        message: error.to_string(),
                        user_name: None,
                    });
                }

                // Login succeeded!
                log::info!("✅ Login successful for: {} on host #{}", email, host_index);

                // If we used a different host than configured, save it
                if host_index != configured_index {
                    log::info!(
                        "🔄 Auto-switched to host #{} ({}), saving to config",
                        host_index,
                        all_hosts.get(host_index).unwrap_or(&"?".to_string())
                    );
                    let _ = config::update_value(|c| c.host_index = host_index);
                }

                let user = resp.get("user").cloned().unwrap_or_default();
                let name = user
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("User")
                    .to_string();
                let (uid, ukey) = client.get_credentials();

                log::debug!(
                    "User ID: {:?}, User Key length: {}",
                    uid,
                    ukey.as_ref().map(|k| k.len()).unwrap_or(0)
                );

                let downloads_today = user
                    .get("downloads_today")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32;
                let downloads_limit = user
                    .get("downloads_limit")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0) as i32;

                log::info!("📊 Downloads: {}/{}", downloads_today, downloads_limit);

                // Save to DB
                log::info!("💾 Saving user to database...");
                database::upsert_user(&database::User {
                    email: email.clone(),
                    password,
                    name: Some(name.clone()),
                    remix_user_id: uid,
                    remix_user_key: ukey,
                    downloads_today,
                    downloads_limit,
                })?;

                // Update active user in config
                log::info!("⚙️  Updating config with active user");
                config::update_value(|c| c.user_email = email)?;

                log::info!("🎉 Login process completed for: {}", name);
                return Ok(LoginResult {
                    success: true,
                    message: format!("Welcome back, {}!", name),
                    user_name: Some(name),
                });
            }
            Err(e) => {
                log::warn!("⚠️ Host #{} failed: {}", host_index, e);
                last_error = e;
                // Continue to next host
            }
        }
    }

    // All hosts failed
    log::error!("❌ All {} hosts failed for login", indices_to_try.len());
    Err(format!(
        "登录失败：所有节点均不可用，请稍后重试。最后一个错误: {}",
        last_error
    ))
}

#[tauri::command]
pub async fn get_all_users() -> Result<Vec<database::User>, String> {
    database::get_all_users()
}

#[tauri::command]
pub async fn delete_user(email: String) -> Result<(), String> {
    database::delete_user(&email)
}

#[tauri::command]
pub async fn get_current_user() -> Result<Option<database::User>, String> {
    let email = config::get_config()
        .map(|c| c.user_email.clone())
        .unwrap_or_default();

    if email.is_empty() {
        return Ok(None);
    }

    database::get_user(&email)
}

#[tauri::command]
pub async fn switch_user(email: String) -> Result<LoginResult, String> {
    log::info!("🔄 Switching to user: {}", email);

    // Verify user exists in DB
    let user = database::get_user(&email)?.ok_or_else(|| format!("User {} not found", email))?;

    // Update active user in config
    config::update_value(|c| c.user_email = email.clone())?;

    // Touch last_active
    database::upsert_user(&user)?;

    let name = user.name.unwrap_or_else(|| "User".to_string());
    log::info!("✅ Switched to user: {}", name);

    Ok(LoginResult {
        success: true,
        message: format!("Switched to {}", name),
        user_name: Some(name),
    })
}

#[tauri::command]
pub async fn logout() -> Result<(), String> {
    log::info!("🚪 Logging out current user");
    config::update_value(|c| c.user_email = String::new())?;
    Ok(())
}

#[tauri::command]
pub async fn refresh_user_downloads() -> Result<Option<database::User>, String> {
    let cfg = config::get_config()?;
    if cfg.user_email.is_empty() {
        return Ok(None);
    }

    let user = match database::get_user(&cfg.user_email)? {
        Some(u) => u,
        None => return Ok(None),
    };

    let (uid, ukey) = match (&user.remix_user_id, &user.remix_user_key) {
        (Some(uid), Some(ukey)) => (uid.clone(), ukey.clone()),
        _ => {
            log::warn!(
                "⚠️  User {} has no credentials, skipping refresh",
                cfg.user_email
            );
            return Ok(Some(user));
        }
    };

    let mut client = ZLibrary::new(cfg.host_index);
    client.login_with_token(&uid, &ukey);

    match client.get_profile().await {
        Ok(resp) => {
            let profile_user = resp.get("user").cloned().unwrap_or_default();
            let downloads_today = profile_user
                .get("downloads_today")
                .and_then(|v| v.as_i64())
                .unwrap_or(user.downloads_today as i64) as i32;
            let downloads_limit = profile_user
                .get("downloads_limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(user.downloads_limit as i64) as i32;

            log::info!(
                "📊 Refreshed downloads: {}/{}",
                downloads_today,
                downloads_limit
            );

            let updated = database::User {
                downloads_today,
                downloads_limit,
                ..user
            };
            database::upsert_user(&updated)?;
            Ok(Some(updated))
        }
        Err(e) => {
            log::warn!("⚠️  Failed to refresh downloads: {}", e);
            Ok(Some(user))
        }
    }
}
