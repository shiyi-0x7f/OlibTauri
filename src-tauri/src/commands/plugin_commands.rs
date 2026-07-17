use serde::Serialize;
use std::path::Path;
use tauri::Manager;

use crate::commands::bookshelf_commands::ensure_within_download_root;
use crate::plugins::{
    self,
    installer::{self, PluginStatus},
    runner::{self, PluginTask},
};

/// 一个可在书架右键菜单里直接触发的插件动作
#[derive(Debug, Serialize)]
pub struct PluginActionInfo {
    pub plugin_id: String,
    pub plugin_name: String,
    pub action_id: String,
    pub name: String,
    pub description: String,
    /// 已归一化的输入扩展名（动作没声明就继承插件的）
    pub inputs: Vec<String>,
    pub installed: bool,
}

/// 列出所有插件及其安装状态（内置 + 已订阅的第三方）
#[tauri::command]
pub async fn list_plugins() -> Result<Vec<PluginStatus>, String> {
    Ok(plugins::all().iter().map(installer::status).collect())
}

/// 下载并安装插件（后台执行，进度轮询 list_plugins）
#[tauri::command]
pub async fn install_plugin(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let plugin = plugins::find(&id).ok_or_else(|| format!("插件不存在: {}", id))?;
    installer::start_install(app_handle, plugin)
}

/// 卸载插件（删除其安装目录）
#[tauri::command]
pub async fn uninstall_plugin(id: String) -> Result<(), String> {
    installer::uninstall(&id)
}

/// 列出所有插件动作。**未安装的插件也要列出来**——否则书架右键菜单里根本不出现这一项，
/// 用户无从发现这个功能、也就无从触发安装（与 detect_convert_engine 的取舍一致）。
#[tauri::command]
pub async fn list_plugin_actions() -> Result<Vec<PluginActionInfo>, String> {
    let mut out = Vec::new();
    for plugin in plugins::all() {
        let Some(exec) = &plugin.exec else { continue };
        for action in &exec.actions {
            out.push(PluginActionInfo {
                plugin_id: plugin.id.clone(),
                plugin_name: plugin.name.clone(),
                action_id: action.id.clone(),
                name: action.name.clone(),
                description: action.description.clone(),
                inputs: action.accepted_inputs(&plugin).to_vec(),
                installed: installer::action_exe(&plugin, action).is_some(),
            });
        }
    }
    Ok(out)
}

/// 执行一个插件动作，返回任务 id；进度与转换/OCR 共用 get_plugin_tasks 轮询
#[tauri::command]
pub async fn run_plugin_action(
    app_handle: tauri::AppHandle,
    plugin_id: String,
    action_id: String,
    input_path: String,
) -> Result<String, String> {
    let plugin = plugins::find(&plugin_id).ok_or_else(|| format!("插件不存在: {}", plugin_id))?;
    let action = plugin
        .exec
        .as_ref()
        .and_then(|e| e.actions.iter().find(|a| a.id == action_id))
        .cloned()
        .ok_or_else(|| format!("插件 {} 没有动作 {}", plugin_id, action_id))?;

    let exe = installer::action_exe(&plugin, &action)
        .ok_or_else(|| format!("「{}」未安装，请先在「插件」页安装", plugin.name))?;

    let canonical = ensure_within_download_root(Path::new(&input_path))?;
    // 进程参数用去前缀路径（外部工具不认 \\?\），任务表存规范化路径（前端按它匹配）
    let input = runner::simplify_path(canonical.clone());
    if !input.is_file() {
        return Err("文件不存在".to_string());
    }

    let ext = input
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !action.accepted_inputs(&plugin).iter().any(|i| i == &ext) {
        return Err(format!(
            "「{}」不支持 {} 文件",
            action.name,
            ext.to_uppercase()
        ));
    }

    let registry_path = canonical.to_string_lossy().to_string();
    if runner::is_running(&registry_path) {
        return Err("该文件正在处理中".to_string());
    }

    // 产物默认与输入同格式——瘦身、解密这类是原地加工，不换格式
    let out_ext = action.output_ext.clone().unwrap_or(ext);
    let output = runner::unique_output_path(&input, &action.output_suffix, &out_ext);

    runner::spawn_action(
        app_handle,
        &plugin,
        &action,
        exe,
        input,
        registry_path,
        output,
    )
}

/// 全部插件任务（转换等），前端轮询进度用
#[tauri::command]
pub async fn get_plugin_tasks() -> Result<Vec<PluginTask>, String> {
    Ok(runner::all_tasks())
}

/// 全部加工记录（哪些文件转换过/识别过），书架据此打标记。
/// 这份记录是持久的——任务表重启即失，但标记必须留住。
#[tauri::command]
pub async fn get_plugin_outputs() -> Result<Vec<crate::database::PluginOutput>, String> {
    crate::database::get_plugin_outputs()
}

/// 订阅第三方插件源。第三方插件必须带 sha256，否则整个源会被拒绝。
#[tauri::command]
pub async fn subscribe_plugin_registry(
    app_handle: tauri::AppHandle,
    url: String,
) -> Result<usize, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    plugins::subscribe(&app_data, &url).await
}
