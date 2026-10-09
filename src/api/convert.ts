import { invoke } from "./core";

export interface EngineInfo {
  available: boolean;
  path: string;
  version: string;
  /** 引擎支持的目标格式（来自插件清单，未安装也会返回） */
  outputs: string[];
  /** 引擎能接受的输入格式 */
  inputs: string[];
}

export function detectConvertEngine(): Promise<EngineInfo> {
  return invoke("detect_convert_engine");
}

/** 返回任务 id，进度轮询 getPluginTasks */
export function convertBook(inputPath: string, targetFormat: string): Promise<string> {
  return invoke("convert_book", { inputPath, targetFormat });
}
