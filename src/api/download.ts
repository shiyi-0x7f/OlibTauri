import { invoke } from "./core";

export type DownloadStatus =
  "Pending" | "Downloading" | "Completed" | "Failed" | "Cancelled" | "Dispatched";

export interface DownloadProgress {
  book_id: string;
  title: string;
  /** 0.0 - 100.0 */
  progress: number;
  speed_kbps: number;
  status: DownloadStatus;
  error: string | null;
  downloaded_bytes: number;
  total_bytes: number;
}

/** 成功返回文件名；转交外部工具时返回 "dispatched:<method>" */
export function downloadBook(args: {
  bookId: string;
  hashId: string;
  title: string;
  extension: string;
  /** 以下两项只用于写入本地下载历史 */
  author?: string | null;
  cover?: string | null;
}): Promise<string> {
  return invoke("download_book", args);
}

/** 本地下载记录（每本书一条，重新下载刷新时间） */
export interface DownloadRecord {
  book_id: string;
  hash: string | null;
  title: string;
  author: string | null;
  extension: string | null;
  cover: string | null;
  /** builtin | browser | idm | motrix | copy_url */
  method: string;
  /** 交给浏览器 / 复制链接时为 null */
  file_path: string | null;
  /** 本地时间 YYYY-MM-DD HH:MM:SS */
  downloaded_at: string;
  file_exists: boolean;
}

/** 新的在前 */
export function listDownloadRecords(): Promise<DownloadRecord[]> {
  return invoke("list_download_records");
}

export function deleteDownloadRecord(bookId: string): Promise<void> {
  return invoke("delete_download_record", { bookId });
}

export function cancelDownload(bookId: string): Promise<void> {
  return invoke("cancel_download", { bookId });
}

export function getDownloadProgress(bookId: string): Promise<DownloadProgress | null> {
  return invoke("get_download_progress", { bookId });
}

export function getAllDownloads(): Promise<DownloadProgress[]> {
  return invoke("get_all_downloads");
}

export function deleteDownload(bookId: string): Promise<void> {
  return invoke("delete_download", { bookId });
}
