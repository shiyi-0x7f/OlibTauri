import { invoke } from "./core";
import type { BookListResult, Book, BookComment, FormatEntry } from "./types";

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

/** Z站账号的下载历史条目 */
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

export interface CommentsResult {
  success?: number;
  /** 无评论时接口可能返回对象而非数组，调用方需兼容 */
  comments?: BookComment[] | Record<string, BookComment>;
  commentsDisabled?: boolean;
  [key: string]: unknown;
}

/** 只读，无需登录。实测接口忽略 limit、一次返回 offset 之后的全部评论，故不分页 */
export function getBookComments(bookId: string): Promise<CommentsResult> {
  return invoke("get_book_comments", { bookId });
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
