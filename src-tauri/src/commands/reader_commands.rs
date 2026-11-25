use crate::{api, config, database, hosts};

/// Build the reader URL from a book's readOnlineUrl.
/// 域名/凭证拼接细节封装在私有 vendor crate（api::build_reader_url）。
#[tauri::command]
pub async fn get_reader_url(read_online_url: String) -> Result<String, String> {
    log::info!("📖 Building reader URL from: {}", read_online_url);

    let cfg = config::get_config()?;
    let custom_domain = hosts::get_host(cfg.host_index);

    // 读取登录凭证（如已登录）
    let creds = if !cfg.user_email.is_empty() {
        database::get_user(&cfg.user_email)?.and_then(|user| {
            match (user.remix_user_id, user.remix_user_key) {
                (Some(uid), Some(ukey)) => Some((uid, ukey)),
                _ => None,
            }
        })
    } else {
        None
    };

    let creds_ref = creds
        .as_ref()
        .map(|(uid, ukey)| (uid.as_str(), ukey.as_str()));
    let url = api::build_reader_url(&custom_domain, &read_online_url, creds_ref);

    log::info!("📖 Final reader URL: {}", url);
    Ok(url)
}
