import { invoke } from "./core";

export interface LanStatus {
  running: boolean;
  url: string;
  qr_base64: string;
  port: number;
  wifi_name: string;
  opds_url: string;
}

/** port 缺省时后端默认 8765 */
export function startLanServer(port?: number | null): Promise<LanStatus> {
  return invoke("start_lan_server", { port });
}

export function stopLanServer(): Promise<void> {
  return invoke("stop_lan_server");
}

export function getLanStatus(): Promise<LanStatus> {
  return invoke("get_lan_status");
}
