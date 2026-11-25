import { invoke as tauriInvoke, type InvokeArgs } from "@tauri-apps/api/core";

/** Tauri invoke 薄封装：仅泛型透传，错误按原样冒泡（reject 值即后端 Err(String)）。 */
export function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}
