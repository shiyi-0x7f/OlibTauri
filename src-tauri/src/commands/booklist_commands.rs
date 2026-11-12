//! 书单分享命令：收藏页导出二维码 / 口令粘贴导入。
//! `olib://booklist` 协议的编解码在 TS 侧（`src/utils/booklistCodec.ts`），
//! 本模块只负责二维码渲染与落库。

use serde::Serialize;

use crate::{config, database};

#[derive(Serialize)]
pub struct BooklistImportResult {
    pub imported: u32,
    pub skipped: u32,
}

/// 把书单 URI 渲染为二维码（SVG data URI），供收藏页导出弹窗展示
#[tauri::command]
pub fn booklist_qr(text: String) -> Result<String, String> {
    crate::lan_server::generate_qr_base64(&text).map_err(|e| format!("生成二维码失败: {}", e))
}

/// 导入书单条目到当前账号收藏，按 (book_id, user_email) 去重
#[tauri::command]
pub async fn import_booklist(
    entries: Vec<database::BooklistImportEntry>,
) -> Result<BooklistImportResult, String> {
    let cfg = config::get_config()?;
    if cfg.user_email.is_empty() {
        return Err("请先登录".to_string());
    }
    let (imported, skipped) = database::import_booklist(entries, &cfg.user_email);
    log::info!(
        "📚 booklist import: {} imported, {} skipped",
        imported,
        skipped
    );
    Ok(BooklistImportResult { imported, skipped })
}
