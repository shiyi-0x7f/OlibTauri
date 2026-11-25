import { invoke } from "./core";

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  extension: string;
  modified: string | null;
}

/** dir 为 null 时列出下载根目录；路径必须在下载目录内 */
export function listFiles(dir: string | null = null): Promise<FileInfo[]> {
  return invoke("list_files", { dir });
}

export function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

export function renameFile(path: string, newName: string): Promise<void> {
  return invoke("rename_file", { path, newName });
}

export function openFile(path: string): Promise<void> {
  return invoke("open_file", { path });
}

export function openInExplorer(path: string): Promise<void> {
  return invoke("open_in_explorer", { path });
}
