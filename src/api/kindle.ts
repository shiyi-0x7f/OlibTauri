import { invoke } from "./core";

export type SmtpSecurity = "tls" | "starttls";

/** 后端返回的 Kindle 配置（不含授权码） */
export interface KindleSettings {
  to: string;
  from: string;
  smtp_host: string;
  smtp_port: number;
  security: SmtpSecurity;
  has_password: boolean;
}

export interface KindleSettingsInput {
  to: string;
  from: string;
  smtp_host: string;
  smtp_port: number;
  security: SmtpSecurity;
  /** 留空则沿用已保存的授权码 */
  password: string | null;
}

/** 亚马逊 Send to Kindle 支持的格式，与后端 kindle::sender::SUPPORTED_EXTENSIONS 一致 */
export const KINDLE_EXTENSIONS = ["epub", "pdf", "txt", "doc", "docx", "rtf", "htm", "html"];
export const KINDLE_MAX_SIZE = 200 * 1024 * 1024;

/** 465 为隐式 TLS，其余按 STARTTLS（与后端 Security::for_port 一致） */
export function securityForPort(port: number): SmtpSecurity {
  return port === 465 ? "tls" : "starttls";
}

export function getKindleSettings(): Promise<KindleSettings | null> {
  return invoke("get_kindle_settings");
}

export function saveKindleSettings(input: KindleSettingsInput): Promise<KindleSettings> {
  return invoke("save_kindle_settings", { input });
}

/** 用已保存的配置登录 SMTP 验证，不发信 */
export function testKindleSmtp(): Promise<void> {
  return invoke("test_kindle_smtp");
}

export function sendToKindle(path: string): Promise<void> {
  return invoke("send_to_kindle", { path });
}
