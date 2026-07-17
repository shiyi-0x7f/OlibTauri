//! 通用插件安装器：按清单下载 → 校验 → 解压 → 定位可执行文件。
//! 所有插件共用这一套（多源换源、慢速切换、sha256 校验、体积校验），
//! 插件之间的差异全部由清单（manifest）声明，这里不含任何插件专属逻辑。

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

use super::manifest::{
    ActionSpec, Download, InstallKind, Origin, PluginManifest, SourceSpec, Target,
};

/// 国内下载加速代理，用法：PREFIX + 原始 URL
const MIRROR_PREFIX: &str = "https://down.npee.cn/?";

/// 判定「这个源太慢」的阈值：达到评估时长后平均速度仍低于此值就换源
const SLOW_SPEED_BYTES_PER_SEC: f64 = 300.0 * 1024.0;
const SPEED_PROBE_SECS: u64 = 12;
const STALL_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Serialize, Clone, PartialEq)]
pub enum PluginPhase {
    NotInstalled,
    Downloading,
    Verifying,
    Installing,
    Installed,
    Failed,
}

#[derive(Debug, Serialize, Clone)]
pub struct PluginStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub capability: String,
    pub publisher: String,
    pub homepage: String,
    pub license: String,
    pub origin: Origin,
    /// 当前平台是否支持一键安装
    pub supported: bool,
    pub phase: PluginPhase,
    pub progress: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_kbps: f64,
    pub source: String,
    pub engine_path: String,
    pub error: Option<String>,
    /// 供前端展示能转换成什么格式
    pub outputs: Vec<String>,
    pub inputs: Vec<String>,
}

struct ActiveTask {
    phase: PluginPhase,
    progress: f64,
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_kbps: f64,
    source: String,
}

/// 进行中的安装任务，按插件 id 索引（多个插件可并行安装）
static ACTIVE: Mutex<Option<HashMap<String, ActiveTask>>> = Mutex::new(None);
/// 上一次安装失败的原因，按插件 id 索引
static LAST_ERROR: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn with_active<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, ActiveTask>) -> R,
{
    let mut guard = ACTIVE.lock().unwrap();
    f(guard.get_or_insert_with(HashMap::new))
}

fn with_errors<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, String>) -> R,
{
    let mut guard = LAST_ERROR.lock().unwrap();
    f(guard.get_or_insert_with(HashMap::new))
}

/// 插件安装根目录。刻意选 %ProgramData%\Olib 这种短路径：
/// 某些安装器（Calibre 便携版）对路径长度有硬限制，app_data 路径太长会失败。
pub fn plugins_root() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let program_data =
            std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".to_string());
        PathBuf::from(program_data).join("Olib").join("plugins")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".olib").join("plugins")
    }
}

pub fn plugin_dir(id: &str) -> PathBuf {
    plugins_root().join(id)
}

/// 插件可执行文件路径（已安装时返回 Some）
pub fn engine_path(plugin: &PluginManifest) -> Option<PathBuf> {
    let target = plugin.target()?;
    let exe = plugin_dir(&plugin.id).join(&target.entry);
    exe.is_file().then_some(exe)
}

/// 某个动作要调用的可执行文件（已安装时返回 Some）。
/// 一个插件包里常有多个工具（Calibre 同时带 ebook-convert 和 ebook-polish），
/// 动作可用 `entry` 指定用哪个，不指定就用插件的主 entry。
pub fn action_exe(plugin: &PluginManifest, action: &ActionSpec) -> Option<PathBuf> {
    let target = plugin.target()?;
    let rel = action.entry.as_deref().unwrap_or(target.entry.as_str());
    let exe = plugin_dir(&plugin.id).join(rel);
    exe.is_file().then_some(exe)
}

/// 汇总一个插件的对外状态
pub fn status(plugin: &PluginManifest) -> PluginStatus {
    let active = with_active(|tasks| {
        tasks.get(&plugin.id).map(|t| {
            (
                t.phase.clone(),
                t.progress,
                t.downloaded_bytes,
                t.total_bytes,
                t.speed_kbps,
                t.source.clone(),
            )
        })
    });

    let installed = engine_path(plugin);
    let error = with_errors(|errs| errs.get(&plugin.id).cloned());

    let (phase, progress, downloaded_bytes, total_bytes, speed_kbps, source) = match active {
        Some((p, prog, dl, total, speed, src)) => (p, prog, dl, total, speed, src),
        None if installed.is_some() => (PluginPhase::Installed, 100.0, 0, 0, 0.0, String::new()),
        None if error.is_some() => (PluginPhase::Failed, 0.0, 0, 0, 0.0, String::new()),
        None => (PluginPhase::NotInstalled, 0.0, 0, 0, 0.0, String::new()),
    };

    PluginStatus {
        id: plugin.id.clone(),
        name: plugin.name.clone(),
        description: plugin.description.clone(),
        capability: plugin.capability.clone(),
        publisher: plugin.publisher.clone(),
        homepage: plugin.homepage.clone(),
        license: plugin.license.clone(),
        origin: plugin.origin,
        supported: plugin.supported(),
        phase,
        progress,
        downloaded_bytes,
        total_bytes,
        speed_kbps,
        source,
        engine_path: installed
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        error,
        outputs: plugin.outputs.clone(),
        inputs: plugin.inputs.clone(),
    }
}

fn update_active<F: FnOnce(&mut ActiveTask)>(id: &str, f: F) {
    with_active(|tasks| {
        if let Some(task) = tasks.get_mut(id) {
            f(task);
        }
    });
}

fn emit_status(app: &tauri::AppHandle, id: &str, status: &str, message: &str) {
    let _ = app.emit(
        "plugin-status",
        serde_json::json!({ "id": id, "status": status, "message": message }),
    );
}

/// 启动安装（后台任务）。已安装或正在安装则报错。
pub fn start_install(app: tauri::AppHandle, plugin: PluginManifest) -> Result<(), String> {
    if !plugin.supported() {
        return Err("当前平台不支持该插件".to_string());
    }
    if engine_path(&plugin).is_some() {
        return Err("插件已安装".to_string());
    }
    // 安装即执行外部程序，这里再校验一次清单（防止绕过加载期校验）
    plugin.validate()?;

    let already = with_active(|tasks| {
        if tasks.contains_key(&plugin.id) {
            return true;
        }
        tasks.insert(
            plugin.id.clone(),
            ActiveTask {
                phase: PluginPhase::Downloading,
                progress: 0.0,
                downloaded_bytes: 0,
                total_bytes: 0,
                speed_kbps: 0.0,
                source: String::new(),
            },
        );
        false
    });
    if already {
        return Err("插件正在安装中".to_string());
    }
    with_errors(|errs| errs.remove(&plugin.id));

    tauri::async_runtime::spawn(async move {
        let id = plugin.id.clone();
        if let Err(e) = run_install(&app, &plugin).await {
            log::error!("❌ Plugin {} install failed: {}", id, e);
            with_errors(|errs| errs.insert(id.clone(), e.clone()));
            with_active(|tasks| tasks.remove(&id));
            emit_status(&app, &id, "error", &format!("插件安装失败：{}", e));
        }
    });
    Ok(())
}

/// 卸载插件（删除其安装目录）
pub fn uninstall(id: &str) -> Result<(), String> {
    let installing = with_active(|tasks| tasks.contains_key(id));
    if installing {
        return Err("插件正在安装中，无法卸载".to_string());
    }
    let dir = plugin_dir(id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("删除插件目录失败: {}", e))?;
    }
    with_errors(|errs| errs.remove(id));
    Ok(())
}

// ---------- 安装流程 ----------

async fn run_install(app: &tauri::AppHandle, plugin: &PluginManifest) -> Result<(), String> {
    let target = plugin.target().ok_or("当前平台不支持该插件")?;
    let dir = plugin_dir(&plugin.id);

    // 某些安装器路径过长会静默失败（退出码仍为 0），清单声明后在此前置拦截
    if let Some(max) = target.install.max_path_len {
        let len = dir.to_string_lossy().chars().count();
        if len > max {
            return Err(format!(
                "安装路径过长（{} > {} 字符）：{}",
                len,
                max,
                dir.display()
            ));
        }
    }

    std::fs::create_dir_all(&dir).map_err(|e| format!("创建插件目录失败: {}", e))?;
    let archive = dir.join("__download.tmp");

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;

    // 1. 下载（多源，失败/慢自动换源）
    download_with_fallback(&client, plugin, target, &archive).await?;

    // 2. 校验 sha256（第三方插件必有；内置插件可选）
    if let Some(expected) = &target.download.sha256 {
        update_active(&plugin.id, |t| t.phase = PluginPhase::Verifying);
        let actual = sha256_file(&archive)?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(format!(
                "校验和不匹配，安装包可能被篡改或损坏（期望 {}，实际 {}）",
                expected, actual
            ));
        }
        log::info!("🔒 Plugin {} sha256 verified", plugin.id);
    }

    // 3. 解压/安装
    update_active(&plugin.id, |t| t.phase = PluginPhase::Installing);
    match target.install.kind {
        InstallKind::SfxExe => install_sfx(&archive, &dir, &target.install.args).await?,
        InstallKind::Zip => install_zip(&archive, &dir)?,
    }
    let _ = std::fs::remove_file(&archive);

    // 4. 以 entry 是否存在判定成败——某些安装器失败时退出码仍为 0
    if engine_path(plugin).is_none() {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(format!(
            "安装完成但未找到 {}，请重试或改用手动安装",
            target.entry
        ));
    }

    with_active(|tasks| tasks.remove(&plugin.id));
    log::info!("✅ Plugin {} installed", plugin.id);
    emit_status(
        app,
        &plugin.id,
        "success",
        &format!("{} 安装完成", plugin.name),
    );
    Ok(())
}

/// 一个待尝试的下载源（清单声明的 + 加速代理包装的）
struct ResolvedSource {
    name: String,
    url: String,
    /// 权威体积；加速代理用 chunked 传输不报 content-length，靠它算进度和校验
    expected_total: u64,
}

/// 组装下载源列表：加速源优先，然后清单声明的原始源
async fn resolve_sources(
    client: &reqwest::Client,
    plugin: &PluginManifest,
    download: &Download,
) -> Vec<ResolvedSource> {
    // 内置插件可以用动态解析器取「最新版」（第三方禁用，见 manifest 安全校验）
    let mut specs: Vec<SourceSpec> = download.sources.clone();
    let mut expected_total = 0u64;

    if plugin.origin == Origin::Builtin {
        if let Some(name) = &download.resolver {
            if let Some((url, size)) = super::resolvers::resolve(client, name).await {
                expected_total = size;
                specs.insert(
                    0,
                    SourceSpec {
                        name: "官方最新版".to_string(),
                        url,
                    },
                );
            } else {
                log::warn!("⚠️ Resolver {} failed for plugin {}", name, plugin.id);
            }
        }
    }

    // 没有权威体积时，向第一个源问一次 content-length
    if expected_total == 0 {
        if let Some(first) = specs.first() {
            expected_total = client
                .head(&first.url)
                .send()
                .await
                .ok()
                .and_then(|r| r.content_length())
                .unwrap_or(0);
        }
    }

    let mut sources = Vec::new();
    // 加速源：把第一个（最权威的）源包一层国内代理，放最前面
    if let Some(first) = specs.first() {
        sources.push(ResolvedSource {
            name: "加速源".to_string(),
            url: format!("{}{}", MIRROR_PREFIX, first.url),
            expected_total,
        });
    }
    for s in specs {
        sources.push(ResolvedSource {
            name: s.name,
            url: s.url,
            expected_total,
        });
    }
    sources
}

async fn download_with_fallback(
    client: &reqwest::Client,
    plugin: &PluginManifest,
    target: &Target,
    dest: &Path,
) -> Result<(), String> {
    let sources = resolve_sources(client, plugin, &target.download).await;
    if sources.is_empty() {
        return Err("没有可用的下载源".to_string());
    }
    let last = sources.len() - 1;
    let mut last_err = String::new();

    for (i, source) in sources.iter().enumerate() {
        // 最后一个源不再因为慢而放弃——再慢也得下完
        let allow_slow_switch = i < last;
        log::info!("⬇️ Downloading {} from {}", plugin.id, source.name);
        update_active(&plugin.id, |t| {
            t.phase = PluginPhase::Downloading;
            t.source = source.name.clone();
            t.progress = 0.0;
            t.downloaded_bytes = 0;
            t.total_bytes = 0;
            t.speed_kbps = 0.0;
        });

        match download_from(
            client,
            &plugin.id,
            source,
            dest,
            target.download.min_bytes,
            allow_slow_switch,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(e) => {
                log::warn!("⚠️ Source {} failed: {}", source.name, e);
                last_err = format!("{}：{}", source.name, e);
                let _ = std::fs::remove_file(dest);
            }
        }
    }
    Err(format!("所有下载源均失败（{}）", last_err))
}

async fn download_from(
    client: &reqwest::Client,
    id: &str,
    source: &ResolvedSource,
    dest: &Path,
    min_bytes: u64,
    allow_slow_switch: bool,
) -> Result<(), String> {
    let resp = client
        .get(&source.url)
        .send()
        .await
        .map_err(|e| format!("连接失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    // 加速代理对无效 URL 也会返回 200 + 一小段错误文本，据 content-length 提前识破
    let reported = resp.content_length().unwrap_or(0);
    if min_bytes > 0 && reported > 0 && reported < min_bytes {
        return Err(format!("返回内容不是安装包（仅 {} 字节）", reported));
    }
    let total = if reported > 0 {
        reported
    } else {
        source.expected_total
    };
    update_active(id, |t| t.total_bytes = total);

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("创建临时文件失败: {}", e))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let started = std::time::Instant::now();
    let mut slow_checked = false;

    loop {
        let next = tokio::time::timeout(
            std::time::Duration::from_secs(STALL_TIMEOUT_SECS),
            stream.next(),
        )
        .await;

        let chunk = match next {
            Err(_) => return Err("下载卡住（长时间无数据）".to_string()),
            Ok(None) => break,
            Ok(Some(c)) => c.map_err(|e| format!("下载中断: {}", e))?,
        };

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;

        let elapsed = started.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 {
            downloaded as f64 / elapsed
        } else {
            0.0
        };
        update_active(id, |t| {
            t.downloaded_bytes = downloaded;
            t.speed_kbps = speed / 1024.0;
            if total > 0 {
                t.progress = downloaded as f64 / total as f64 * 100.0;
            }
        });

        if allow_slow_switch && !slow_checked && elapsed >= SPEED_PROBE_SECS as f64 {
            slow_checked = true;
            if speed < SLOW_SPEED_BYTES_PER_SEC {
                return Err(format!("速度过慢（{:.0} KB/s）", speed / 1024.0));
            }
        }
    }

    file.flush().await.ok();
    drop(file);

    let size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    if min_bytes > 0 && size < min_bytes {
        return Err(format!("下载内容不完整（{} 字节）", size));
    }
    if source.expected_total > 0 && size != source.expected_total {
        return Err(format!(
            "文件体积不符（{} ≠ {} 字节）",
            size, source.expected_total
        ));
    }
    log::info!(
        "✅ Downloaded {} from {} ({:.1} MB)",
        id,
        source.name,
        size as f64 / 1024.0 / 1024.0
    );
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("打开安装包失败: {}", e))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("计算校验和失败: {}", e))?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// 自解压 exe：以安装目录为参数静默运行
async fn install_sfx(archive: &Path, dir: &Path, args: &[String]) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new(archive);
    for arg in args {
        cmd.arg(arg.replace("{dir}", &dir.to_string_lossy()));
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let exit = cmd
        .status()
        .await
        .map_err(|e| format!("运行安装器失败: {}", e))?;
    if !exit.success() {
        return Err(format!(
            "安装器退出异常（退出码 {}）",
            exit.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

/// zip 解压到安装目录。拒绝任何逃逸出目标目录的条目（zip slip 攻击）。
fn install_zip(archive: &Path, dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("打开安装包失败: {}", e))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("解析 zip 失败: {}", e))?;

    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| format!("读取 zip 条目失败: {}", e))?;

        // zip slip 防护：只接受 zip 自己认为安全的相对路径
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("zip 含非法路径条目: {}", entry.name()));
        };
        let out = dir.join(rel);
        if !out.starts_with(dir) {
            return Err(format!("zip 条目逃逸出安装目录: {}", entry.name()));
        }

        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| format!("创建目录失败: {}", e))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        let mut dest = std::fs::File::create(&out).map_err(|e| format!("写入文件失败: {}", e))?;
        std::io::copy(&mut entry, &mut dest).map_err(|e| format!("解压失败: {}", e))?;

        // Unix 下保留可执行位，否则解压出来的 entry 无法执行
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode)).ok();
            }
        }
    }
    Ok(())
}
