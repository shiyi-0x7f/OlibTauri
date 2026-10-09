import { invoke } from "./core";

export type PluginPhase =
  "NotInstalled" | "Downloading" | "Verifying" | "Installing" | "Installed" | "Failed";

export type PluginOrigin = "Builtin" | "Remote" | "Local";

export interface PluginStatus {
  id: string;
  name: string;
  description: string;
  capability: string;
  publisher: string;
  homepage: string;
  license: string;
  origin: PluginOrigin;
  /** 当前平台是否支持一键安装 */
  supported: boolean;
  phase: PluginPhase;
  progress: number;
  downloaded_bytes: number;
  total_bytes: number;
  speed_kbps: number;
  source: string;
  engine_path: string;
  error: string | null;
  outputs: string[];
  inputs: string[];
}

export interface PluginActionInfo {
  plugin_id: string;
  plugin_name: string;
  action_id: string;
  name: string;
  description: string;
  inputs: string[];
  installed: boolean;
}

export type PluginTaskStatus = "Running" | "Success" | "Failed";

export interface PluginTask {
  id: string;
  plugin_id: string;
  input_path: string;
  output_path: string;
  file_name: string;
  target_format: string;
  progress: number;
  status: PluginTaskStatus;
  error: string | null;
}

/** 一条持久化的加工记录：某文件被转换/识别过，产出了什么 */
export interface PluginOutput {
  output_path: string;
  source_path: string;
  source_name: string;
  output_name: string;
  plugin_id: string;
  /** "convert" | "ocr" */
  capability: string;
  target_format: string | null;
  created_at: string | null;
}

export function listPlugins(): Promise<PluginStatus[]> {
  return invoke("list_plugins");
}

/** 后台安装，进度轮询 listPlugins */
export function installPlugin(id: string): Promise<void> {
  return invoke("install_plugin", { id });
}

export function uninstallPlugin(id: string): Promise<void> {
  return invoke("uninstall_plugin", { id });
}

export function listPluginActions(): Promise<PluginActionInfo[]> {
  return invoke("list_plugin_actions");
}

/** 返回任务 id，进度轮询 getPluginTasks */
export function runPluginAction(args: {
  pluginId: string;
  actionId: string;
  inputPath: string;
}): Promise<string> {
  return invoke("run_plugin_action", args);
}

export function getPluginTasks(): Promise<PluginTask[]> {
  return invoke("get_plugin_tasks");
}

export function getPluginOutputs(): Promise<PluginOutput[]> {
  return invoke("get_plugin_outputs");
}

export interface PluginsLocation {
  path: string;
  default_path: string;
  is_default: boolean;
  /** 在该位置会安装失败的插件说明（路径长度限制） */
  warnings: string[];
}

export interface RelocateReport {
  location: PluginsLocation;
  /** 已迁移到新位置的插件名 */
  moved: string[];
  /** 新位置已有同名目录、未迁移的插件名 */
  kept: string[];
}

export function getPluginsLocation(): Promise<PluginsLocation> {
  return invoke("get_plugins_location");
}

/** path 为 null = 恢复默认位置；已装插件会被迁移过去 */
export function setPluginsLocation(path: string | null): Promise<RelocateReport> {
  return invoke("set_plugins_location", { path });
}

export interface PluginsUsage {
  total_bytes: number;
  /** 磁盘上存在安装目录的插件，按占用从大到小 */
  plugins: { id: string; name: string; bytes: number }[];
}

/** 遍历插件目录统计占用，可能要一两秒 */
export function getPluginsUsage(): Promise<PluginsUsage> {
  return invoke("get_plugins_usage");
}

export interface PluginGuide {
  /** 指南文件绝对路径（给 AI Agent 读） */
  guide_path: string;
  /** 本地插件源目录（Agent 写好的清单放这里） */
  registries_dir: string;
  content: string;
}

/** 把内置的插件开发指南写到 app 数据目录，返回路径与全文 */
export function exportPluginGuide(): Promise<PluginGuide> {
  return invoke("export_plugin_guide");
}

export function openPluginGuideFolder(): Promise<void> {
  return invoke("open_plugin_guide_folder");
}

/** 重新扫描插件源（本地 registries/ 目录新增的清单无需重启即生效） */
export function reloadPluginRegistries(): Promise<void> {
  return invoke("reload_plugin_registries");
}

export function openPluginsLocation(): Promise<void> {
  return invoke("open_plugins_location");
}

/** 返回该源的插件数量 */
export function subscribePluginRegistry(url: string): Promise<number> {
  return invoke("subscribe_plugin_registry", { url });
}
