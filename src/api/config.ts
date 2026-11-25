import { invoke } from "./core";

export interface AppConfig {
  download_folder: string;
  cache_folder: string;
  download_with_browser: boolean;
  skip_duplicate_files: boolean;
  host_index: number;
  search_limit: number;
  language_index: number;
  extension_index: number;
  exact_search: boolean;
  user_email: string;
  window_width: number;
  window_height: number;
  theme: string;
  primary_color: string;
  notify_on_download: boolean;
  close_to_tray: boolean;
  shortcut_search: string;
  /** "builtin" | "browser" | "idm" | "motrix" | "copy_url"（空 = 兼容旧字段） */
  download_method: string;
  startup_page: string;
  calibre_path: string;
  /** 插件安装根目录（空 = 默认）；只读，修改走 setPluginsLocation */
  plugins_dir: string;
  /** 无线传书上次是否开着（启动时据此自动开启）；只读，由启停无线传书时记录 */
  lan_auto_start: boolean;
  /** 无线传书端口；只读 */
  lan_port: number;
}

export interface HostLatency {
  index: number;
  domain: string;
  /** 毫秒，-1 表示不可达 */
  latency_ms: number;
}

export interface HostsInfo {
  hosts: string[];
  /** "builtin"；旧版遗留的 "subscription" | "manual" 会在启动时重置为 builtin */
  source: string;
  updated_at: string | null;
}

/** 网盘下载直链 */
export interface UpdateLink {
  name: string;
  url: string;
}

/** 检查更新结果（MindSet 查更新接口，见 src-tauri/src/update_check.rs） */
export interface UpdateInfo {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  /** 服务端判定须强制更新（后台 min_version / 勾选强制更新的版本） */
  force_update: boolean;
  /** 比当前版本新的各版本更新说明 */
  notes: string;
  /** 网盘下载直链（取不到时为空） */
  links: UpdateLink[];
  /** 下载页（MindSet 项目页）：兜底渠道 */
  page_url: string;
}

// ── config 内存缓存 ──
// 启动时多个页面/hook 同时 getConfig 会打出重复 IPC，这里按 Promise 去重缓存。
// 后端除 set_config 外还有多处会改 config（登录/切号写 user_email、自动选节点写
// host_index），所有已知写路径必须调用 invalidateConfigCache()。
let configCache: Promise<AppConfig> | null = null;

export function invalidateConfigCache(): void {
  configCache = null;
}

export function getConfig(): Promise<AppConfig> {
  if (!configCache) {
    configCache = invoke<AppConfig>("get_config").catch((err) => {
      configCache = null; // 失败不缓存，下次重试
      throw err;
    });
  }
  return configCache;
}

export async function setConfig(newConfig: AppConfig): Promise<void> {
  await invoke("set_config", { newConfig });
  configCache = Promise.resolve(newConfig);
}

export function getHosts(): Promise<string[]> {
  return invoke("get_hosts");
}

export function pingHosts(): Promise<HostLatency[]> {
  return invoke("ping_hosts");
}

export async function autoSelectFastestHost(): Promise<HostLatency> {
  const result = await invoke<HostLatency>("auto_select_fastest_host");
  invalidateConfigCache(); // 后端写 host_index
  return result;
}

export function getHostsInfo(): Promise<HostsInfo> {
  return invoke("get_hosts_info");
}

export function getAppVersion(): Promise<string> {
  return invoke("get_app_version");
}

export function checkForUpdates(): Promise<UpdateInfo> {
  return invoke("check_for_updates");
}
