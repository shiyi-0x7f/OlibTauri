import { invoke } from "./core";

/** 未登录 / token 失效（需扫码登录） */
export const FEEDBACK_NEED_LOGIN = "NEED_LOGIN";
/** client_ref 被占用（409），换新 ref 重试 */
export const FEEDBACK_DUPLICATE_REF = "DUPLICATE_REF";

export interface FeedbackDiagnostics {
  /** SCC platform；当前系统不受支持时为 null（禁用提交） */
  platform: string | null;
  device_model: string | null;
  os_version: string | null;
  app_version: string;
}

export interface FeedbackDetails {
  steps?: string;
  expected?: string;
  actual?: string;
}

/** app_version / platform / 设备信息由后端补齐，这里不传 */
export interface FeedbackInput {
  client_ref: string;
  type: string;
  area: string;
  severity: string | null;
  title: string;
  content: string;
  details: FeedbackDetails | null;
  diagnostics_consent: boolean;
}

export interface FeedbackSubmitted {
  id: number;
  status: string;
  created_at: string;
}

export interface MyFeedbackItem {
  id: number;
  type: string;
  area: string;
  title: string;
  status: string;
  app_version: string;
  created_at: string;
  issue_status: string | null;
  fixed_in_version: string | null;
}

export function feedbackDiagnostics(): Promise<FeedbackDiagnostics> {
  return invoke("feedback_diagnostics");
}

/** 未登录 reject "NEED_LOGIN"；client_ref 冲突 reject "DUPLICATE_REF" */
export function feedbackSubmit(input: FeedbackInput): Promise<FeedbackSubmitted> {
  return invoke("feedback_submit", { input });
}

/** 未登录 reject "NEED_LOGIN" */
export function feedbackListMine(page = 1): Promise<MyFeedbackItem[]> {
  return invoke("feedback_list_mine", { page });
}
