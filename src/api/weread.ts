import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "./core";

// 微信读书接口经后端透传（扫码会话 + 移动端接口），以下形状以实际返回 + 前端使用为准。

export interface WereadStatus {
  connected: boolean;
  vid: string | null;
}

export interface WereadQrStart {
  uuid: string;
  /** data:image/svg+xml;base64,… */
  qr_image: string;
}

export type WereadQrStatus = "waiting" | "scanned" | "confirmed" | "expired" | "declined";

export interface WereadQrPoll {
  status: WereadQrStatus;
  /** 下次轮询回传 */
  last: number | null;
}

export function wereadStatus(): Promise<WereadStatus> {
  return invoke("weread_status");
}

export function wereadQrStart(): Promise<WereadQrStart> {
  return invoke("weread_qr_start");
}

/** 单次长轮询（后端最长约 70s）；confirmed 时后端已完成登录 */
export function wereadQrPoll(uuid: string, last: number | null): Promise<WereadQrPoll> {
  return invoke("weread_qr_poll", { uuid, last });
}

export function wereadDisconnect(): Promise<void> {
  return invoke("weread_disconnect");
}

/** /readdata/detail：时长均为秒 */
export interface WereadStats {
  /** 周期起点（秒）；weekly 为本周一 0 点 */
  baseTime?: number;
  totalReadTime: number;
  readDays?: number;
  dayAverageReadTime?: number;
  /** 日 / 月起点时间戳（秒，字符串键）→ 阅读秒数；只含有阅读的条目 */
  readTimes?: Record<string, number>;
  /** 「读过 / 读完 / 阅读 / 笔记」四项汇总（仅 overall） */
  readStat?: { stat: string; counts: string }[];
  preferCategory?: { categoryTitle: string; readingTime: number; readingCount: number }[];
  /** 24 小时阅读分布 */
  preferTime?: number[];
  preferTimeWord?: string;
  preferCategoryWord?: string;
  [key: string]: unknown;
}

export interface WereadShelfBook extends WereadBookMeta {
  /** 微信读书网页版书籍页 */
  deepLink?: string;
  readUpdateTime?: number;
  finishReading?: number;
  secret?: number;
}

export interface WereadBookProgress {
  bookId: string;
  /** 0–100 */
  progress?: number;
  /** 在本书累计阅读秒数 */
  readingTime?: number;
  updateTime?: number;
}

export interface WereadShelf {
  books?: WereadShelfBook[];
  bookProgress?: WereadBookProgress[];
  bookCount?: number;
  [key: string]: unknown;
}

export interface WereadBookMeta {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  [key: string]: unknown;
}

export interface WereadNotebookBook {
  bookId: string;
  book: WereadBookMeta;
  reviewCount: number;
  noteCount: number;
  bookmarkCount: number;
  readingProgress?: number;
  sort: number;
  [key: string]: unknown;
}

export interface WereadNotebooksResult {
  books?: WereadNotebookBook[];
  [key: string]: unknown;
}

export interface WereadBookInfo {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  intro?: string;
  category?: string;
  publisher?: string;
  publishTime?: string;
  isbn?: string;
  wordCount?: number;
  newRating?: number;
  newRatingCount?: number;
  [key: string]: unknown;
}

export interface WereadChapter {
  chapterUid: number;
  chapterIdx: number;
  title: string;
  wordCount?: number;
  [key: string]: unknown;
}

export interface WereadChaptersResult {
  chapters?: WereadChapter[];
  [key: string]: unknown;
}

export interface WereadBookmark {
  bookmarkId: string;
  chapterUid?: number;
  range: string;
  markText: string;
  createTime?: number;
  style?: number;
  [key: string]: unknown;
}

export interface WereadBookmarksResult {
  updated?: WereadBookmark[];
  [key: string]: unknown;
}

export interface WereadReview {
  reviewId: string;
  content: string;
  createTime?: number;
  chapterName?: string;
  abstract_?: string;
  [key: string]: unknown;
}

/** 条目可能是 { review: ... } 包装，也可能直接平铺（前端按 r.review || r 兼容） */
export interface WereadReviewItem {
  review?: WereadReview;
  [key: string]: unknown;
}

export interface WereadReviewsResult {
  reviews?: WereadReviewItem[];
  [key: string]: unknown;
}

export interface WereadBestBookmark {
  bookmarkId: string;
  chapterUid: number;
  markText: string;
  totalCount: number;
  [key: string]: unknown;
}

export interface WereadBestBookmarksResult {
  items?: WereadBestBookmark[];
  [key: string]: unknown;
}

export function wereadGetStats(): Promise<WereadStats> {
  return invoke("weread_get_stats");
}

export function wereadGetShelf(): Promise<WereadShelf> {
  return invoke("weread_get_shelf");
}

export type WereadReadMode = "weekly" | "monthly" | "annually" | "overall";

/** 指定周期阅读统计；baseTime 缺省为当前周期 */
export function wereadReadData(mode: WereadReadMode, baseTime?: number): Promise<WereadStats> {
  return invoke("weread_read_data", { mode, baseTime });
}

export function wereadGetNotebooks(): Promise<WereadNotebooksResult> {
  return invoke("weread_get_notebooks");
}

export function wereadGetBookInfo(bookId: string): Promise<WereadBookInfo> {
  return invoke("weread_get_book_info", { bookId });
}

export function wereadGetChapters(bookId: string): Promise<WereadChaptersResult> {
  return invoke("weread_get_chapters", { bookId });
}

export function wereadGetBookmarks(bookId: string): Promise<WereadBookmarksResult> {
  return invoke("weread_get_bookmarks", { bookId });
}

export function wereadGetMyReviews(bookId: string): Promise<WereadReviewsResult> {
  return invoke("weread_get_my_reviews", { bookId });
}

export function wereadGetBestBookmarks(bookId: string): Promise<WereadBestBookmarksResult> {
  return invoke("weread_get_best_bookmarks", { bookId });
}

export interface WereadRecommendBook extends WereadBookInfo {
  /** 推荐理由，如「因为你在读《X》」 */
  reason?: string;
}

export interface WereadRecommendBatch {
  books: WereadRecommendBook[];
  /** 新书已全部拉完 */
  exhausted: boolean;
  /** 本批是已看过的书（从头轮转） */
  wrapped: boolean;
  /** 书架是否有可作种子的书 */
  hasSeeds: boolean;
}

export interface WereadSimilarPage {
  books: WereadBookInfo[];
  sessionId: string | null;
  nextIdx: number;
  hasMore: boolean;
}

/** 「为你推荐」下一批（以书架最近在读为种子的相似书）；refresh 时重建推荐池 */
export function wereadRecommendNext(
  count: number,
  refresh: boolean,
): Promise<WereadRecommendBatch> {
  return invoke("weread_recommend_next", { count, refresh });
}

/** 某本书的相似书分页：首页 maxIdx=0、sessionId=null，续页传上一页返回的 nextIdx/sessionId */
export function wereadSimilarBooks(
  bookId: string,
  maxIdx: number,
  sessionId: string | null,
): Promise<WereadSimilarPage> {
  return invoke("weread_similar_books", { bookId, maxIdx, sessionId });
}

export interface WereadToolbarPrompt {
  /** 按钮文字，如「全书总结」 */
  title: string;
  /** 实际发送的问题 */
  prompt: string;
  intent: string;
}

export interface WereadAiSuggestions {
  questions: string[];
  prompts: WereadToolbarPrompt[];
}

/** weread-ask 事件帧：text / thinking 为累计快照，done 为最后一帧 */
export interface WereadAskFrame {
  askId: number;
  text: string;
  thinking: string;
  done: boolean;
  error: string | null;
}

export function wereadAiSuggestions(
  bookId: string,
  chapterUid?: number,
): Promise<WereadAiSuggestions> {
  return invoke("weread_ai_suggestions", { bookId, chapterUid });
}

/** 开始提问，返回 askId；回答经 onWereadAsk 逐帧到达（不支持多轮，每问独立） */
export function wereadAiAsk(bookId: string, query: string, intent?: string): Promise<number> {
  return invoke("weread_ai_ask", { bookId, query, intent });
}

export function wereadAiCancel(askId: number): Promise<void> {
  return invoke("weread_ai_cancel", { askId });
}

export function onWereadAsk(handler: (frame: WereadAskFrame) => void): Promise<UnlistenFn> {
  return listen<WereadAskFrame>("weread-ask", (e) => handler(e.payload));
}

/** 可导入微信读书的格式（与后端 weread::import 一致），单本 ≤ 200 MB */
export const WEREAD_IMPORT_EXTENSIONS = ["epub", "pdf", "mobi", "txt", "azw3"];

export interface WereadImportResult {
  bookId: string;
}

/** weread-import 事件：上传进度（字节），按百分比节流 */
export interface WereadImportProgress {
  path: string;
  sent: number;
  total: number;
}

/** 导入本机书籍到微信读书书架；失败信息若含「勿直接重试」表示结果不确定 */
export function wereadImportBook(path: string): Promise<WereadImportResult> {
  return invoke("weread_import_book", { path });
}

export function onWereadImport(
  handler: (progress: WereadImportProgress) => void,
): Promise<UnlistenFn> {
  return listen<WereadImportProgress>("weread-import", (e) => handler(e.payload));
}

export function wereadSaveNotes(path: string, content: string): Promise<void> {
  return invoke("weread_save_notes", { path, content });
}
