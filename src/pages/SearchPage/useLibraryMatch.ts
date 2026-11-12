import { useEffect, useState } from "react";
import { searchBooks } from "../../api/search";
import type { ReadingTip } from "../../api/prescriber";
import type { Book } from "./types";

export type MatchState =
  | { status: "loading" }
  | { status: "found"; book: Book; editions: number }
  | { status: "none" }
  | { status: "error"; error: string };

/** 同一本书多个版本时的格式偏好（越靠前越好） */
const EXT_RANK = ["epub", "azw3", "mobi", "pdf", "fb2", "txt", "djvu"];
const CANDIDATES = 8;
/** 并发上限：AI 一次推荐 3–6 本，避免同时打满线路 */
const CONCURRENCY = 3;

/** 书名归一：去书名号 / 标点 / 空白 / 括号内副标题，转小写 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[（(【[].*?[）)】\]]/g, "")
    .replace(/[《》“”"'‘’:：·.,，、!！?？\-—_\s]/g, "");
}

/** 给候选打分：书名吻合 > 作者吻合 > 格式偏好；书名完全不沾边的不算匹配 */
export function scoreCandidate(tip: ReadingTip, book: Book): number {
  const want = normalizeTitle(tip.book_name);
  const got = normalizeTitle(book.title || "");
  if (!want || !got) return -1;
  let score: number;
  if (got === want) score = 100;
  else if (got.startsWith(want) || want.startsWith(got)) score = 70;
  else if (got.includes(want) || want.includes(got)) score = 50;
  else return -1;

  const author = normalizeTitle(tip.author || "");
  const bookAuthor = normalizeTitle(book.author || "");
  if (author && bookAuthor && (bookAuthor.includes(author) || author.includes(bookAuthor))) {
    score += 30;
  }
  const ext = (book.extension || "").toLowerCase();
  const rank = EXT_RANK.indexOf(ext);
  score += rank === -1 ? 0 : (EXT_RANK.length - rank) * 2;
  return score;
}

export function pickBest(tip: ReadingTip, books: Book[]): { book: Book; editions: number } | null {
  let best: Book | null = null;
  let bestScore = -1;
  let editions = 0;
  for (const b of books) {
    const s = scoreCandidate(tip, b);
    if (s < 0) continue;
    editions++;
    if (s > bestScore) {
      best = b;
      bestScore = s;
    }
  }
  return best ? { book: best, editions } : null;
}

/** AI 推荐书目 → 书库匹配（按书名搜索，挑最合适的版本）；drawId 变化即重新匹配 */
export function useLibraryMatch(tips: ReadingTip[] | null, drawId: number) {
  const [matches, setMatches] = useState<Record<number, MatchState>>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!tips || tips.length === 0) return;
    let alive = true;
    setMatches(Object.fromEntries(tips.map((_, i) => [i, { status: "loading" } as MatchState])));

    let next = 0;
    const worker = async () => {
      while (alive && next < tips.length) {
        const i = next++;
        const tip = tips[i];
        let state: MatchState;
        try {
          const res = await searchBooks({ title: tip.book_name, page: 1, limit: CANDIDATES });
          const hit = pickBest(tip, (res?.books ?? []) as Book[]);
          state = hit ? { status: "found", ...hit } : { status: "none" };
        } catch (err) {
          state = { status: "error", error: String(err ?? "搜索失败") };
        }
        if (alive) setMatches((m) => ({ ...m, [i]: state }));
      }
    };
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, tips.length) }, worker));
    return () => {
      alive = false;
    };
    // tips 随 drawId 一起变化，只看 drawId / 手动重试
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawId, version]);

  return { matches, retry: () => setVersion((v) => v + 1) };
}
