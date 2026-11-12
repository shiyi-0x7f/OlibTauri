import { invoke } from "./core";

export function ocrAvailable(): Promise<boolean> {
  return invoke("ocr_available");
}

/** 返回任务 id，进度轮询 getPluginTasks */
export function ocrDocument(inputPath: string): Promise<string> {
  return invoke("ocr_document", { inputPath });
}
