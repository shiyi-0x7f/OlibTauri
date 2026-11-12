import { invoke } from "./core";

export interface FavoriteBook {
  book_id: string;
  user_email: string;
  hash: string | null;
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | null;
  language: string | null;
  extension: string | null;
  filesize: number | null;
  cover: string | null;
  description: string | null;
  pages: number | null;
  added_at: string | null;
}

/** 后端 AddFavoriteParams（serde 反序列化，字段保持 snake_case） */
export interface AddFavoriteParams {
  book_id: string;
  hash?: string | null;
  title: string;
  author?: string | null;
  publisher?: string | null;
  year?: number | null;
  language?: string | null;
  extension?: string | null;
  filesize?: number | null;
  cover?: string | null;
  description?: string | null;
  pages?: number | null;
}

export function addFavorite(params: AddFavoriteParams): Promise<void> {
  return invoke("add_favorite", { params });
}

export function removeFavorite(bookId: string): Promise<void> {
  return invoke("remove_favorite", { bookId });
}

export function getFavorites(page?: number | null, limit?: number | null): Promise<FavoriteBook[]> {
  return invoke("get_favorites", { page, limit });
}

export function isFavorite(bookId: string): Promise<boolean> {
  return invoke("is_favorite", { bookId });
}

/** 返回入参中已收藏的 book_id 子集 */
export function checkFavoritesBatch(bookIds: string[]): Promise<string[]> {
  return invoke("check_favorites_batch", { bookIds });
}
