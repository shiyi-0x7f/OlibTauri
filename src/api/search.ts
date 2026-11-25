import { invoke } from "./core";
import type { BookListResult } from "./types";

/** 后端 SearchParams（serde 反序列化，字段保持 snake_case） */
export interface SearchParams {
  title: string;
  page?: number | null;
  limit?: number | null;
  order?: string | null;
  languages?: string[] | null;
  extensions?: string[] | null;
  year_from?: string | null;
  year_to?: string | null;
  exact?: boolean | null;
}

export function searchBooks(params: SearchParams): Promise<BookListResult> {
  return invoke("search_books", { params });
}
