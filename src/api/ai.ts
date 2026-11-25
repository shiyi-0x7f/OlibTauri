import { invoke } from "./core";

/** AI 寻书 BYOK 配置（后端不回传 Key） */
export interface AiSettings {
  provider: string;
  base_url: string;
  model: string;
  has_key: boolean;
  /** 每次推荐几本 */
  tip_count: number;
  /** 追加到内置提示词后的用户偏好 */
  extra_prompt: string;
}

export interface AiSettingsInput {
  provider: string;
  base_url: string;
  model: string;
  /** 留空则沿用已保存的 Key */
  api_key: string | null;
  tip_count: number;
  extra_prompt: string;
}

/** 推荐数量可选档位（后端上限 10，见 ai_finder::MAX_TIP_COUNT） */
export const TIP_COUNT_OPTIONS = [3, 5, 8];
export const DEFAULT_TIP_COUNT = 3;
/** 与后端 ai_finder::MAX_EXTRA_PROMPT_CHARS 一致 */
export const MAX_EXTRA_PROMPT_CHARS = 300;

export interface ReadingTip {
  book_name: string;
  author: string;
  reason: string;
  category: string;
}

export interface ReadingBag {
  diagnosis: string;
  tips: ReadingTip[];
}

/** 未配置 AI 服务时 reject 的错误码 */
export const NEED_AI_CONFIG = "NEED_AI_CONFIG";

export function getAiSettings(): Promise<AiSettings | null> {
  return invoke("get_ai_settings");
}

export function saveAiSettings(input: AiSettingsInput): Promise<AiSettings> {
  return invoke("save_ai_settings", { input });
}

/** 用已保存的配置发一条极短请求验证可用 */
export function testAiSettings(): Promise<void> {
  return invoke("test_ai_settings");
}

/** apiKey 为空时用已保存的 Key */
export function listAiModels(baseUrl: string, apiKey: string | null): Promise<string[]> {
  return invoke("list_ai_models", { baseUrl, apiKey });
}

/** 未配置 reject NEED_AI_CONFIG */
export function aiFindBooks(args: {
  input: string;
  inputType?: string | null;
}): Promise<ReadingBag> {
  return invoke("ai_find_books", args);
}
