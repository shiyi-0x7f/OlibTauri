import { invoke } from "./core";

export interface PrescriberAuthState {
  authorized: boolean;
}

export interface PrescriberLoginQr {
  qr_url: string;
  scene_id: string;
  expire_seconds: number;
}

export interface ReadingTip {
  book_name: string;
  author: string;
  reason: string;
  category: string;
  from_ai: boolean;
}

export interface ReadingBag {
  diagnosis: string;
  tips: ReadingTip[];
}

export function prescriberStatus(): Promise<PrescriberAuthState> {
  return invoke("prescriber_status");
}

export function prescriberStartLogin(): Promise<PrescriberLoginQr> {
  return invoke("prescriber_start_login");
}

/** 返回 "authorized" / "waiting" / "expired"（或后端透传的其他状态字符串） */
export function prescriberPollLogin(sceneId: string): Promise<string> {
  return invoke("prescriber_poll_login", { sceneId });
}

export function prescriberLogout(): Promise<void> {
  return invoke("prescriber_logout");
}

/** 未登录 reject "NEED_LOGIN"；配额用尽 reject "QUOTA_AI_USER" / "QUOTA_AI_GLOBAL" */
export function prescriberDiagnose(args: {
  input: string;
  inputType?: string | null;
  language?: string | null;
}): Promise<ReadingBag> {
  return invoke("prescriber_diagnose", args);
}
