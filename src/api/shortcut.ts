import { invoke } from "./core";

export function updateGlobalShortcut(shortcut: string): Promise<void> {
  return invoke("update_global_shortcut", { shortcut });
}
