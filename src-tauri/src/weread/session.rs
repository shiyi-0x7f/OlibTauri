//! 微信读书扫码会话的落盘与进程内缓存。
//!
//! 按 2026-10-03 决策明文存 `app_data_dir/weread_session.json`，刻意不放进
//! `config.json`：`get_config` 会把整个配置下发前端，令牌不应出现在前端。

use crate::util::LockExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const SESSION_FILE: &str = "weread_session.json";

static SESSION_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub vid: String,
    pub access_token: String,
    pub refresh_token: String,
    pub device_id: String,
}

/// 启动时加载已保存的会话；文件损坏时记日志并视为未连接（用户重新扫码即可覆盖）。
pub fn init(app_data_dir: &std::path::Path) {
    let path = app_data_dir.join(SESSION_FILE);
    let loaded = match fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<Session>(&text) {
            Ok(session) => Some(session),
            Err(e) => {
                log::warn!("微信读书会话文件损坏，需重新扫码: {}", e);
                None
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            log::warn!("读取微信读书会话失败: {}", e);
            None
        }
    };
    *SESSION_PATH.lock_ignore_poison() = Some(path);
    *SESSION.lock_ignore_poison() = loaded;
}

pub fn current() -> Option<Session> {
    SESSION.lock_ignore_poison().clone()
}

pub fn save(session: Session) -> Result<(), String> {
    let path = SESSION_PATH
        .lock_ignore_poison()
        .clone()
        .ok_or("微信读书会话存储未初始化")?;
    let json = serde_json::to_string_pretty(&session)
        .map_err(|e| format!("序列化微信读书会话失败: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("保存微信读书会话失败: {}", e))?;
    *SESSION.lock_ignore_poison() = Some(session);
    Ok(())
}

pub fn clear() -> Result<(), String> {
    *SESSION.lock_ignore_poison() = None;
    let path = SESSION_PATH.lock_ignore_poison().clone();
    if let Some(path) = path {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("删除微信读书会话失败: {}", e)),
        }
    }
    Ok(())
}
