//! 常驻服务型插件的生命周期管理：拉起进程 → 等它就绪 → 收进托盘 → 应用退出时关掉。
//!
//! 服务**按需启动**（第一次用到时才拉起），之后复用同一个进程，避免每个任务都付一次
//! 冷启动开销。进程本身由清单声明（端口、健康检查、启动/隐藏/退出参数），
//! 这里不含任何特定工具的知识。

use std::collections::HashMap;
use std::sync::Mutex;

use super::installer;
use super::manifest::{PluginManifest, ServiceSpec};

/// 已拉起的服务：plugin_id → 子进程 id（用于退出时收尾）
static RUNNING: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

fn with_running<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, u32>) -> R,
{
    let mut guard = RUNNING.lock().unwrap();
    f(guard.get_or_insert_with(HashMap::new))
}

fn base_url(spec: &ServiceSpec) -> String {
    format!("http://127.0.0.1:{}", spec.port)
}

async fn is_healthy(client: &reqwest::Client, spec: &ServiceSpec) -> bool {
    client
        .get(format!("{}{}", base_url(spec), spec.health))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// 确保服务已就绪，返回其 base url（如 `http://127.0.0.1:1224`）。
/// 已在跑（哪怕是用户自己开的同一个程序）就直接复用。
pub async fn ensure_running(plugin: &PluginManifest) -> Result<String, String> {
    let spec = plugin
        .service
        .as_ref()
        .ok_or_else(|| format!("插件 {} 不是服务型插件", plugin.id))?;
    let exe =
        installer::engine_path(plugin).ok_or_else(|| format!("插件 {} 未安装", plugin.name))?;

    let client = reqwest::Client::new();
    if is_healthy(&client, spec).await {
        return Ok(base_url(spec));
    }

    log::info!("🚀 Starting plugin service: {}", plugin.id);
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(&spec.args);
    // 服务的工作目录必须是它自己的安装目录，否则大概率找不到模型/配置
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 {} 失败: {}", plugin.name, e))?;
    if let Some(pid) = child.id() {
        with_running(|map| map.insert(plugin.id.clone(), pid));
    }

    // 轮询健康检查直到就绪
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_secs(spec.startup_timeout_secs);
    while std::time::Instant::now() < deadline {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        if is_healthy(&client, spec).await {
            log::info!("✅ Plugin service ready: {}", plugin.id);
            // 就绪后把界面收起来（这类工具通常是 GUI 程序，不收会一直杵在桌面上）
            if !spec.post_start_args.is_empty() {
                run_control(&exe, &spec.post_start_args).await;
            }
            return Ok(base_url(spec));
        }
    }

    Err(format!(
        "{} 启动超时（{} 秒内未就绪）",
        plugin.name, spec.startup_timeout_secs
    ))
}

/// 执行一条控制命令（隐藏窗口 / 退出等），不关心结果
async fn run_control(exe: &std::path::Path, args: &[String]) {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(args);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let _ = cmd.status().await;
}

/// 应用退出时关掉所有由我们拉起的服务——否则它们会作为孤儿进程留在后台。
/// 先按清单声明的方式优雅退出，失败再强杀。
pub fn shutdown_all() {
    let running = with_running(|map| std::mem::take(map));
    if running.is_empty() {
        return;
    }

    for (id, pid) in running {
        let Some(plugin) = super::find(&id) else {
            continue;
        };
        let quit_args = plugin
            .service
            .as_ref()
            .map(|s| s.quit_args.clone())
            .unwrap_or_default();
        let exe = installer::engine_path(&plugin);

        let mut exited = false;
        if let (Some(exe), false) = (exe, quit_args.is_empty()) {
            let mut cmd = std::process::Command::new(&exe);
            cmd.args(&quit_args);
            if let Some(dir) = exe.parent() {
                cmd.current_dir(dir);
            }
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            exited = cmd.status().map(|s| s.success()).unwrap_or(false);
            log::info!("🛑 Stopped plugin service {} (graceful: {})", id, exited);
        }

        if !exited {
            kill_pid(pid);
            log::info!("🛑 Killed plugin service {} (pid {})", id, pid);
        }
    }
}

fn kill_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status();
    }
}
