import { invoke } from "./core";

export interface LanStatus {
  running: boolean;
  url: string;
  qr_base64: string;
  port: number;
  wifi_name: string;
  opds_url: string;
}

/** 后端事件：收到手机发来的书（payload 为落盘后的文件名与字节数） */
export const LAN_FILE_RECEIVED = "lan://file-received";
export interface LanFileReceived {
  name: string;
  size: number;
}

/** 后端事件：收到手机推送的书单（已写入收藏） */
export const LAN_BOOKLIST_RECEIVED = "lan://booklist-received";
export interface LanBooklistReceived {
  imported: number;
  skipped: number;
}

/** 前端窗口事件：一批收书提示合并完成后派发，书架 / 收藏页据此刷新 */
export const LAN_RECEIVED_WINDOW_EVENT = "olib:lan-received";
export type LanReceivedKind = "files" | "booklist";

/** 手机版下载页 */
export const MOBILE_APP_URL = "https://mind.11xy.cn/projects/olib-mobile";

/** port 缺省时后端沿用上次的端口（默认 8765），保证手机记住的地址不变 */
export function startLanServer(port?: number | null): Promise<LanStatus> {
  return invoke("start_lan_server", { port });
}

export function stopLanServer(): Promise<void> {
  return invoke("stop_lan_server");
}

export function getLanStatus(): Promise<LanStatus> {
  return invoke("get_lan_status");
}
