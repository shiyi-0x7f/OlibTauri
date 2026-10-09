// Z-Library 相关接口后端透传 serde_json::Value，以下形状以前端实际使用为准。

/** Z-Library 书目条目（搜索接口返回 number id，热门接口返回 string id） */
export interface Book {
  id: number | string;
  title: string;
  author: string;
  publisher?: string;
  year?: number;
  language?: string;
  extension?: string;
  filesize?: number;
  filesizeString?: string;
  hash?: string;
  cover?: string;
  description?: string;
  pages?: number;
  readOnlineUrl?: string;
  [key: string]: unknown;
}

export interface Pagination {
  limit?: number;
  current?: number;
  total_items?: number;
  total_pages?: number;
}

/** /formats 返回的同书其他格式版本（独立书目，各自 id/hash） */
export interface FormatEntry {
  id: number;
  hash: string;
  extension: string;
  filesize?: number;
  filesizeString?: string;
}

/** 搜索 / 热门 / 最新等书单类响应的公共形状 */
export interface BookListResult {
  success?: number;
  books?: Book[];
  pagination?: Pagination;
  [key: string]: unknown;
}
