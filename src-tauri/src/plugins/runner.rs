//! 插件执行器：按清单的 `exec` 契约调用插件可执行文件，解析进度、汇报结果。
//! 任何 capability 的插件都走这里，差异（参数模板、进度正则）由清单声明。

use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use super::manifest::{ActionSpec, PluginManifest};

#[derive(Debug, Serialize, Clone, PartialEq)]
pub enum TaskStatus {
    Running,
    Success,
    Failed,
}

#[derive(Debug, Serialize, Clone)]
pub struct PluginTask {
    pub id: String,
    pub plugin_id: String,
    pub input_path: String,
    pub output_path: String,
    pub file_name: String,
    pub target_format: String,
    pub progress: f64,
    pub status: TaskStatus,
    pub error: Option<String>,
}

static TASKS: Mutex<Option<HashMap<String, PluginTask>>> = Mutex::new(None);

fn with_tasks<F, R>(f: F) -> R
where
    F: FnOnce(&mut HashMap<String, PluginTask>) -> R,
{
    let mut guard = TASKS.lock().unwrap();
    f(guard.get_or_insert_with(HashMap::new))
}

pub fn all_tasks() -> Vec<PluginTask> {
    with_tasks(|tasks| tasks.values().cloned().collect())
}

/// 某个输入文件是否已有任务在跑（用于防重复提交）
pub fn is_running(input_path: &str) -> bool {
    with_tasks(|tasks| {
        tasks
            .values()
            .any(|t| t.status == TaskStatus::Running && t.input_path == input_path)
    })
}

/// 去掉 Windows canonicalize 产生的 `\\?\` 前缀——不少外部程序（如 Calibre）不认扩展长度路径
pub fn simplify_path(p: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = p.to_string_lossy().to_string();
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    p
}

/// 生成不冲突的输出路径：同目录、原文件名 + `suffix` + 新扩展名，已存在则追加 " (n)"。
/// `suffix` 用于「产物与输入同格式」的动作（瘦身、解密），否则会直接覆盖原文件。
pub fn unique_output_path(input: &Path, suffix: &str, target_ext: &str) -> PathBuf {
    let dir = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".to_string());
    let mut candidate = dir.join(format!("{}{}.{}", stem, suffix, target_ext));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{}{} ({}).{}", stem, suffix, n, target_ext));
        n += 1;
    }
    candidate
}

/// 登记一个任务（不启动任何东西），返回任务 id。
/// exec 型和 service 型插件共用同一张任务表，前端因此不必区分两者。
pub fn create_task(
    plugin_id: &str,
    input: &Path,
    registry_path: String,
    output: &Path,
    target_format: String,
) -> String {
    let task_id = uuid::Uuid::new_v4().to_string();
    let file_name = input
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    with_tasks(|tasks| {
        // 同一输入文件的历史记录清掉，只保留正在跑的
        tasks.retain(|_, t| t.input_path != registry_path || t.status == TaskStatus::Running);
        tasks.insert(
            task_id.clone(),
            PluginTask {
                id: task_id.clone(),
                plugin_id: plugin_id.to_string(),
                input_path: registry_path,
                output_path: output.to_string_lossy().to_string(),
                file_name,
                target_format,
                progress: 0.0,
                status: TaskStatus::Running,
                error: None,
            },
        );
    });
    task_id
}

pub fn set_progress(task_id: &str, percent: f64) {
    with_tasks(|tasks| {
        if let Some(task) = tasks.get_mut(task_id) {
            task.progress = percent.clamp(0.0, 100.0);
        }
    });
}

/// 标记任务成功：落库留痕 + 通知前端。
///
/// 任务表是内存态、重启即失，所以这里必须把「这个文件被加工过」写进数据库——
/// 否则用户过几天回来就不记得哪本转过、哪本 OCR 过了。
pub fn mark_success(app: &tauri::AppHandle, task_id: &str, output: &Path) {
    let mut done: Option<PluginTask> = None;
    with_tasks(|tasks| {
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = TaskStatus::Success;
            task.progress = 100.0;
            done = Some(task.clone());
        }
    });

    let Some(task) = done else { return };
    let output_name = output
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // 落库的路径必须和 list_files 返回的形式一致，否则前端匹配不上、标记永远不显示。
    // 传给外部进程的 output 是去掉 `\\?\` 前缀的（工具不认扩展长度路径），
    // 而 list_files 的路径继承自 canonicalize、带前缀——这里重新规范化补回来。
    let output_key = std::fs::canonicalize(output)
        .unwrap_or_else(|_| output.to_path_buf())
        .to_string_lossy()
        .to_string();

    // capability 来自清单；插件没了（被卸载/换源）也不该丢记录，退化成 plugin_id
    let capability = super::find(&task.plugin_id)
        .map(|p| p.capability)
        .unwrap_or_else(|| task.plugin_id.clone());

    if let Err(e) = crate::database::add_plugin_output(&crate::database::PluginOutput {
        output_path: output_key,
        source_path: task.input_path.clone(),
        source_name: task.file_name.clone(),
        output_name: output_name.clone(),
        plugin_id: task.plugin_id.clone(),
        capability,
        target_format: Some(task.target_format.clone()),
        created_at: None,
    }) {
        // 记不上账不该让用户丢结果，文件已经产出了——记日志即可
        log::warn!("⚠️ Failed to record plugin output: {}", e);
    }

    log::info!("✅ Plugin task completed: {}", output_name);
    let _ = app.emit(
        "plugin-task",
        serde_json::json!({
            "status": "success",
            "title": task.file_name,
            "message": format!("完成：{}", output_name),
        }),
    );
}

/// 提交一次「目标格式由用户挑」的调用（capability = convert 走这里），返回任务 id。
/// `input` 用于传给进程（已去 `\\?\`），`registry_path` 是登记在任务表里的规范路径（前端按它匹配）。
pub fn spawn_task(
    app: tauri::AppHandle,
    plugin: &PluginManifest,
    exe: PathBuf,
    input: PathBuf,
    registry_path: String,
    output: PathBuf,
    target_format: String,
) -> Result<String, String> {
    let exec = plugin
        .exec
        .as_ref()
        .ok_or_else(|| format!("插件 {} 不是命令行型插件", plugin.id))?;
    if exec.args.is_empty() {
        return Err(format!("插件 {} 没有声明默认调用参数", plugin.id));
    }
    spawn_exec(
        app,
        &plugin.id,
        exe,
        &exec.args,
        exec.progress_regex.as_deref(),
        input,
        registry_path,
        output,
        target_format,
    )
}

/// 提交一次「动作」调用（书架右键菜单里的一键操作），返回任务 id。
/// 任务的 `target_format` 记的是动作 id——前端据此回查动作名来显示标记。
pub fn spawn_action(
    app: tauri::AppHandle,
    plugin: &PluginManifest,
    action: &ActionSpec,
    exe: PathBuf,
    input: PathBuf,
    registry_path: String,
    output: PathBuf,
) -> Result<String, String> {
    let exec = plugin
        .exec
        .as_ref()
        .ok_or_else(|| format!("插件 {} 不是命令行型插件", plugin.id))?;
    // 动作可以自带进度正则，没有就沿用插件级的
    let progress_regex = action
        .progress_regex
        .as_deref()
        .or(exec.progress_regex.as_deref());
    spawn_exec(
        app,
        &plugin.id,
        exe,
        &action.args,
        progress_regex,
        input,
        registry_path,
        output,
        action.id.clone(),
    )
}

/// 展开参数模板、登记任务、后台跑起来。convert 与动作的唯一差别只是参数从哪来。
#[allow(clippy::too_many_arguments)]
fn spawn_exec(
    app: tauri::AppHandle,
    plugin_id: &str,
    exe: PathBuf,
    arg_templates: &[String],
    progress_regex: Option<&str>,
    input: PathBuf,
    registry_path: String,
    output: PathBuf,
    label: String,
) -> Result<String, String> {
    let task_id = create_task(plugin_id, &input, registry_path, &output, label);

    // 参数模板展开：{input} / {output}
    let args: Vec<String> = arg_templates
        .iter()
        .map(|a| {
            a.replace("{input}", &input.to_string_lossy())
                .replace("{output}", &output.to_string_lossy())
        })
        .collect();
    let progress_re = progress_regex.and_then(|re| Regex::new(re).ok());

    let id = task_id.clone();
    tauri::async_runtime::spawn(async move {
        run(app, exe, args, progress_re, id, output).await;
    });

    Ok(task_id)
}

pub fn mark_failed(app: &tauri::AppHandle, task_id: &str, error: String) {
    let mut title = String::new();
    with_tasks(|tasks| {
        if let Some(task) = tasks.get_mut(task_id) {
            task.status = TaskStatus::Failed;
            task.error = Some(error.clone());
            title = task.file_name.clone();
        }
    });
    log::error!("❌ Plugin task failed for {}: {}", title, error);
    let _ = app.emit(
        "plugin-task",
        serde_json::json!({
            "status": "error",
            "title": title,
            "message": format!("失败：{}", error),
        }),
    );
}

async fn run(
    app: tauri::AppHandle,
    exe: PathBuf,
    args: Vec<String>,
    progress_re: Option<Regex>,
    task_id: String,
    output: PathBuf,
) {
    log::info!("🔄 Running plugin task: {:?} {:?}", exe, args);

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            mark_failed(&app, &task_id, format!("启动插件失败: {}", e));
            return;
        }
    };

    // 并发排空 stderr，避免管道写满导致子进程阻塞
    let stderr_handle = child.stderr.take().map(|mut se| {
        tauri::async_runtime::spawn(async move {
            let mut buf = String::new();
            se.read_to_string(&mut buf).await.ok();
            buf
        })
    });

    if let Some(stdout) = child.stdout.take() {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(percent) = progress_re.as_ref().and_then(|re| parse_percent(re, &line)) {
                with_tasks(|tasks| {
                    if let Some(task) = tasks.get_mut(&task_id) {
                        task.progress = percent;
                    }
                });
            }
        }
    }

    let exit_status = child.wait().await;
    let stderr_buf = match stderr_handle {
        Some(h) => h.await.unwrap_or_default(),
        None => String::new(),
    };

    let succeeded = matches!(&exit_status, Ok(s) if s.success()) && output.is_file();
    if succeeded {
        mark_success(&app, &task_id, &output);
    } else {
        // 取 stderr 末尾几行作为错误信息（外部工具的报错通常在最后）
        let tail: Vec<&str> = stderr_buf
            .lines()
            .filter(|l| !l.trim().is_empty())
            .rev()
            .take(3)
            .collect();
        let detail = if tail.is_empty() {
            match exit_status {
                Ok(s) => format!("退出码 {}", s.code().unwrap_or(-1)),
                Err(e) => e.to_string(),
            }
        } else {
            tail.into_iter().rev().collect::<Vec<_>>().join(" | ")
        };
        let _ = std::fs::remove_file(&output); // 清理不完整的输出
        mark_failed(&app, &task_id, detail);
    }
}

/// 用清单声明的正则从一行输出里取进度百分比（第 1 个捕获组）
fn parse_percent(re: &Regex, line: &str) -> Option<f64> {
    let caps = re.captures(line)?;
    let value: u32 = caps.get(1)?.as_str().parse().ok()?;
    (value <= 100).then_some(value as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_calibre_progress_lines() {
        // Calibre ebook-convert 的真实输出格式
        let re = Regex::new(r"^\s*(\d{1,3})%").unwrap();
        assert_eq!(
            parse_percent(&re, "34% 正在对电子书进行转换..."),
            Some(34.0)
        );
        assert_eq!(parse_percent(&re, "1% 转换为HTML中..."), Some(1.0));
        assert_eq!(parse_percent(&re, "Detecting structure..."), None);
    }

    #[test]
    fn rejects_out_of_range_percent() {
        let re = Regex::new(r"^\s*(\d{1,3})%").unwrap();
        assert_eq!(parse_percent(&re, "999% bogus"), None);
    }

    /// 落库的产出路径必须和 `list_files` 返回的形式一致，否则书架上的
    /// 「转换生成 / OCR 生成」标记永远匹配不上（Windows 上 list_files 的路径带
    /// `\\?\` 前缀，而传给外部工具的路径是去前缀的）。
    #[test]
    fn recorded_output_path_matches_list_files_form() {
        let dir = std::env::temp_dir().join("olib-runner-path-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("out.pdf");
        std::fs::write(&file, b"x").unwrap();

        // list_files 的路径来自 canonicalize 过的根目录 + read_dir
        let root = std::fs::canonicalize(&dir).unwrap();
        let listed = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| e.file_name() == "out.pdf")
            .unwrap()
            .path();

        // mark_success 里对产出路径做的规范化
        let simplified = simplify_path(file.clone()); // 传给外部进程的形式
        let recorded = std::fs::canonicalize(&simplified).unwrap();

        assert_eq!(
            recorded, listed,
            "recorded output path must match the form list_files returns"
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}
