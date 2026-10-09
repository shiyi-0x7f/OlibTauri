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
  subscription_url: string;
  /** "builtin" | "browser" | "idm" | "motrix" | "copy_url"（空 = 兼容旧字段） */
  download_method: string;
  startup_page: string;
  calibre_path: string;
  /** 插件安装根目录（空 = 默认）；只读，修改走 setPluginsLocation */
  plugins_dir: string;
}

export interface HostLatency {
  index: number;
  domain: string;
  /** 毫秒，-1 表示不可达 */
  latency_ms: number;
}

export interface HostsInfo {
  hosts: string[];
  /** "builtin" | "subscription" | "manual" */
  source: string;
  updated_at: string | null;
}

export interface UpdateInfo {
  has_update: boolean;
  current_version: string;
  latest_version: string;
}

// ── config 内存缓存 ──
// 启动时多个页面/hook 同时 getConfig 会打出重复 IPC，这里按 Promise 去重缓存。
// 后端除 set_config 外还有 7 处会改 config（登录/切号写 user_email、节点操作写
// host_index/subscription_url），所有已知写路径必须调用 invalidateConfigCache()。
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

/** 返回节点数量 */
export async function updateSubscription(url: string): Promise<number> {
  const count = await invoke<number>("update_subscription", { url });
  invalidateConfigCache(); // 后端写 subscription_url + host_index
  return count;
}

/** 返回节点数量 */
export async function importHosts(text: string): Promise<number> {
  const count = await invoke<number>("import_hosts", { text });
  invalidateConfigCache(); // 后端写 host_index
  return count;
}

/** 返回节点数量 */
export async function resetHosts(): Promise<number> {
  const count = await invoke<number>("reset_hosts");
  invalidateConfigCache(); // 后端写 host_index + subscription_url
  return count;
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
