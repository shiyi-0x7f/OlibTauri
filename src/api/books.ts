import { invoke } from "./core";
import type { BookListResult, Book, FormatEntry } from "./types";

export interface BookInfoResult {
  success?: number;
  book?: Book;
  [key: string]: unknown;
}

export interface FormatsResult {
  success?: number;
  books?: FormatEntry[];
  [key: string]: unknown;
}

/** Z-Library 账号的下载历史条目 */
export interface DownloadedBook {
  id: string;
  title: string;
  author?: string;
  year?: number;
  extension?: string;
  filesize?: number;
  downloaded_at?: string;
  cover?: string;
  [key: string]: unknown;
}

export interface DownloadHistoryResult {
  success?: number;
  books?: DownloadedBook[];
  [key: string]: unknown;
}

export function getPopularBooks(switchLanguage?: string | null): Promise<BookListResult> {
  return invoke("get_popular_books", { switchLanguage });
}

export function getRecentBooks(): Promise<BookListResult> {
  return invoke("get_recent_books");
}

/** 需要登录 */
export function getRecommendedBooks(): Promise<BookListResult> {
  return invoke("get_recommended_books");
}

export function getSimilarBooks(bookId: string, hashId: string): Promise<BookListResult> {
  return invoke("get_similar_books", { bookId, hashId });
}

export function getBookFormats(bookId: string, hashId: string): Promise<FormatsResult> {
  return invoke("get_book_formats", { bookId, hashId });
}

/** 需要登录 */
export function getDownloadHistory(
  args: {
    order?: string | null;
    page?: number | null;
    limit?: number | null;
  } = {},
): Promise<DownloadHistoryResult> {
  return invoke("get_download_history", args);
}

export function getBookInfo(bookId: string, hashId: string): Promise<BookInfoResult> {
  return invoke("get_book_info", { bookId, hashId });
}
