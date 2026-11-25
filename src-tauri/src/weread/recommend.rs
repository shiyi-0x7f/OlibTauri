//! 推荐池：以书架最近在读的书为种子，拉取 `/book/detailinfo?listtypes=2` 相似书。
//!
//! `/book/recommend` 实测 `books` 恒为空，不是推荐接口，不使用（见 `dev_docs/weread-recommend.md`）。
//! 规则：按 bookId 去重、排除书架已有书、多种子轮流交错；某种子一页无新书即耗尽；
//! 全部耗尽后从已展示的书从头轮转。池状态按账号（vid）缓存在进程内。

use super::client::NOT_CONNECTED;
use super::{api, session};
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{HashSet, VecDeque};

// 最近的几本可能都是用户导入的私人书；继续尝试较早的书架书籍。
const MAX_SEEDS: usize = 20;
const ACTIVE_SOURCES: usize = 3;
const PAGE_SIZE: u32 = 12;
/// 单个种子最多翻页数，防止服务端异常时无限拉取。
const MAX_PAGES_PER_SOURCE: u32 = 20;
const MAX_BATCH: usize = 24;

static POOL: Lazy<tokio::sync::Mutex<Option<Pool>>> = Lazy::new(|| tokio::sync::Mutex::new(None));

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    /// 微信读书 bookInfo 原样字段 + `reason`（推荐理由）
    pub books: Vec<Value>,
    /// 所有种子都已拉完且没有待展示的新书
    pub exhausted: bool,
    /// 本批来自已展示过的书（新书已看完，从头轮转）
    pub wrapped: bool,
    /// 书架里是否有可作为种子的书；false 时前端提示「先在微信读书读几本书」
    pub has_seeds: bool,
}

struct Source {
    seed_id: String,
    reason: String,
    session_id: Option<String>,
    next_idx: i64,
    pages: u32,
    exhausted: bool,
    buffer: VecDeque<Value>,
}

struct Pool {
    vid: String,
    sources: Vec<Source>,
    shelf_ids: HashSet<String>,
    seen: HashSet<String>,
    shown: Vec<Value>,
    replay: usize,
    turn: usize,
}

fn id_of(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

impl Pool {
    fn from_shelf(vid: String, shelf: &Value) -> Self {
        let books: Vec<&Value> = shelf
            .get("books")
            .and_then(Value::as_array)
            .map(|a| a.iter().collect())
            .unwrap_or_default();
        let shelf_ids = books
            .iter()
            .filter_map(|b| id_of(b.get("bookId")))
            .collect();

        let mut recent = books.clone();
        recent.sort_by_key(|b| {
            std::cmp::Reverse(b.get("readUpdateTime").and_then(Value::as_i64).unwrap_or(0))
        });
        let sources = recent
            .into_iter()
            .filter(|b| b.get("secret").and_then(Value::as_i64).unwrap_or(0) == 0)
            .filter_map(|b| {
                let seed_id = id_of(b.get("bookId"))?;
                let title = b.get("title").and_then(Value::as_str).unwrap_or("").trim();
                let reason = if title.is_empty() {
                    "与你书架上的书相似".to_string()
                } else {
                    format!("因为你在读《{}》", title)
                };
                Some(Source {
                    seed_id,
                    reason,
                    session_id: None,
                    next_idx: 0,
                    pages: 0,
                    exhausted: false,
                    buffer: VecDeque::new(),
                })
            })
            .take(MAX_SEEDS)
            .collect();

        Self {
            vid,
            sources,
            shelf_ids,
            seen: HashSet::new(),
            shown: Vec::new(),
            replay: 0,
            turn: 0,
        }
    }

    fn buffered(&self) -> usize {
        self.sources.iter().map(|s| s.buffer.len()).sum()
    }

    /// 缓冲不足 `want` 时，优先从最近的三个未耗尽种子里选缓冲最少者。
    fn fetch_target(&self, want: usize) -> Option<usize> {
        if self.buffered() >= want {
            return None;
        }
        self.sources
            .iter()
            .enumerate()
            .filter(|(_, s)| !s.exhausted)
            .take(ACTIVE_SOURCES)
            .min_by_key(|(_, s)| s.buffer.len())
            .map(|(i, _)| i)
    }

    fn mark_failed(&mut self, i: usize) {
        self.sources[i].exhausted = true;
    }

    fn apply_page(&mut self, i: usize, page: &Value) {
        let similar = page.get("booksimilar");
        let source = &mut self.sources[i];
        source.pages += 1;
        if let Some(sid) = similar
            .and_then(|s| s.get("sessionId"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            source.session_id = Some(sid.to_string());
        }
        let items = similar
            .and_then(|s| s.get("books"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let mut new_ids = 0;
        for item in &items {
            if let Some(idx) = item.get("idx").and_then(Value::as_i64) {
                source.next_idx = source.next_idx.max(idx);
            }
            let Some(info) = item
                .get("book")
                .and_then(|b| b.get("bookInfo"))
                .and_then(Value::as_object)
            else {
                continue;
            };
            let Some(id) = id_of(info.get("bookId")) else {
                continue;
            };
            if !self.seen.insert(id.clone()) {
                continue;
            }
            new_ids += 1;
            if self.shelf_ids.contains(&id) || id == source.seed_id {
                continue;
            }
            let mut book: Map<String, Value> = info.clone();
            book.insert("reason".into(), Value::String(source.reason.clone()));
            source.buffer.push_back(Value::Object(book));
        }
        // 无新书（含服务端忽略游标重复返回）即视为耗尽
        if new_ids == 0 || source.pages >= MAX_PAGES_PER_SOURCE {
            source.exhausted = true;
        }
    }

    fn take(&mut self, want: usize) -> Batch {
        let mut books = Vec::with_capacity(want);
        let n = self.sources.len();
        let mut idle = 0;
        while books.len() < want && n > 0 && idle < n {
            let source = &mut self.sources[self.turn % n];
            self.turn = (self.turn + 1) % n;
            match source.buffer.pop_front() {
                Some(b) => {
                    books.push(b);
                    idle = 0;
                }
                None => idle += 1,
            }
        }
        self.shown.extend(books.iter().cloned());

        let exhausted = self.buffered() == 0 && self.sources.iter().all(|s| s.exhausted);
        let mut wrapped = false;
        if books.is_empty() && exhausted && !self.shown.is_empty() {
            wrapped = true;
            let len = self.shown.len();
            for k in 0..want.min(len) {
                books.push(self.shown[(self.replay + k) % len].clone());
            }
            self.replay = (self.replay + want.min(len)) % len;
        }
        Batch {
            books,
            exhausted,
            wrapped,
            has_seeds: n > 0,
        }
    }
}

/// 取下一批推荐。`refresh` 为 true 时重读书架、重建推荐池。
pub async fn next_batch(want: usize, refresh: bool) -> Result<Batch, String> {
    let want = want.clamp(1, MAX_BATCH);
    let vid = session::current().ok_or(NOT_CONNECTED)?.vid;
    let mut guard = POOL.lock().await;
    let stale = guard.as_ref().is_none_or(|p| p.vid != vid);
    if refresh || stale {
        let shelf = api::shelf().await?;
        *guard = Some(Pool::from_shelf(vid, &shelf));
    }
    let Some(pool) = guard.as_mut() else {
        return Err("推荐池初始化失败".to_string());
    };

    let mut last_error = None;
    while let Some(i) = pool.fetch_target(want) {
        let s = &pool.sources[i];
        let (seed, idx, sid) = (s.seed_id.clone(), s.next_idx, s.session_id.clone());
        match api::similar_page(&seed, idx, sid.as_deref(), PAGE_SIZE).await {
            Ok(page) => pool.apply_page(i, &page),
            Err(e) => {
                // 单个种子失败（如导入的私人书无相似书）不拖垮整体，其余种子继续
                log::warn!("微信读书相似书拉取失败，跳过该种子: {}", e);
                pool.mark_failed(i);
                last_error = Some(e);
            }
        }
    }
    let batch = pool.take(want);
    match last_error {
        Some(e) if batch.books.is_empty() => Err(e),
        _ => Ok(batch),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarPage {
    pub books: Vec<Value>,
    pub session_id: Option<String>,
    pub next_idx: i64,
    pub has_more: bool,
}

/// 详情弹窗的相似书分页：把 `{ booksimilar: { sessionId, books: [{ idx, book: { bookInfo } }] } }` 拍平。
pub fn normalize_similar(page: &Value, prev_idx: i64) -> SimilarPage {
    let similar = page.get("booksimilar");
    let items = similar
        .and_then(|s| s.get("books"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut next_idx = prev_idx;
    let mut books = Vec::new();
    for item in &items {
        if let Some(idx) = item.get("idx").and_then(Value::as_i64) {
            next_idx = next_idx.max(idx);
        }
        if let Some(info) = item.get("book").and_then(|b| b.get("bookInfo")) {
            if info.is_object() {
                books.push(info.clone());
            }
        }
    }
    SimilarPage {
        has_more: !books.is_empty() && next_idx > prev_idx,
        books,
        session_id: similar
            .and_then(|s| s.get("sessionId"))
            .and_then(Value::as_str)
            .map(str::to_string),
        next_idx,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(ids: &[(i64, &str)]) -> Value {
        let books: Vec<Value> = ids
            .iter()
            .map(|(idx, id)| json!({"idx": idx, "book": {"bookInfo": {"bookId": id, "title": id}}}))
            .collect();
        json!({"booksimilar": {"sessionId": "s1", "books": books}})
    }

    fn shelf() -> Value {
        json!({"books": [
            {"bookId": "old", "title": "旧书", "readUpdateTime": 1},
            {"bookId": "new", "title": "新书", "readUpdateTime": 9},
            {"bookId": "mid", "title": "", "readUpdateTime": 5},
        ]})
    }

    fn ids(batch: &Batch) -> Vec<String> {
        batch
            .books
            .iter()
            .map(|b| b["bookId"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn seeds_are_most_recent_shelf_books() {
        let pool = Pool::from_shelf("v".into(), &shelf());
        let seeds: Vec<_> = pool.sources.iter().map(|s| s.seed_id.as_str()).collect();
        assert_eq!(seeds, ["new", "mid", "old"]);
        assert_eq!(pool.sources[0].reason, "因为你在读《新书》");
        assert_eq!(pool.sources[1].reason, "与你书架上的书相似");
    }

    #[test]
    fn tries_older_seed_when_recent_books_have_no_similar_books() {
        let shelf = json!({"books": [
            {"bookId": "public", "readUpdateTime": 1},
            {"bookId": "upload-1", "readUpdateTime": 4},
            {"bookId": "upload-2", "readUpdateTime": 3},
            {"bookId": "upload-3", "readUpdateTime": 2},
            {"bookId": "hidden", "readUpdateTime": 5, "secret": 1},
        ]});
        let mut pool = Pool::from_shelf("v".into(), &shelf);
        let seeds: Vec<_> = pool.sources.iter().map(|s| s.seed_id.as_str()).collect();
        assert_eq!(seeds, ["upload-1", "upload-2", "upload-3", "public"]);
        for i in 0..3 {
            pool.apply_page(i, &page(&[]));
        }
        assert_eq!(pool.fetch_target(6), Some(3));
        pool.apply_page(3, &page(&[(1, "similar")]));
        assert_eq!(ids(&pool.take(6)), ["similar"]);
    }

    #[test]
    fn dedupes_excludes_shelf_and_interleaves() {
        let mut pool = Pool::from_shelf("v".into(), &shelf());
        pool.apply_page(0, &page(&[(1, "a"), (2, "old"), (3, "b")]));
        pool.apply_page(1, &page(&[(1, "a"), (2, "c")]));
        let batch = pool.take(10);
        // 书架上的 old 被排除，重复的 a 只出现一次，两个种子交错
        assert_eq!(ids(&batch), ["a", "c", "b"]);
        assert_eq!(batch.books[0]["reason"], "因为你在读《新书》");
        assert_eq!(pool.sources[0].next_idx, 3);
        assert_eq!(pool.sources[0].session_id.as_deref(), Some("s1"));
    }

    #[test]
    fn source_exhausts_when_page_has_no_new_ids() {
        let mut pool = Pool::from_shelf("v".into(), &shelf());
        pool.apply_page(0, &page(&[(1, "a")]));
        assert!(!pool.sources[0].exhausted);
        pool.apply_page(0, &page(&[(1, "a")]));
        assert!(pool.sources[0].exhausted);
        pool.apply_page(1, &page(&[]));
        assert!(pool.sources[1].exhausted);
    }

    #[test]
    fn fetch_target_prefers_emptiest_live_source() {
        let mut pool = Pool::from_shelf("v".into(), &shelf());
        pool.apply_page(0, &page(&[(1, "a"), (2, "b")]));
        assert_eq!(pool.fetch_target(6), Some(1));
        assert_eq!(pool.fetch_target(2), None);
        for i in 0..3 {
            pool.mark_failed(i);
        }
        assert_eq!(pool.fetch_target(6), None);
    }

    #[test]
    fn does_not_fetch_all_candidates_when_first_sources_have_enough_books() {
        let shelf = json!({"books": (0..10).map(|i| json!({"bookId": format!("seed-{i}")})).collect::<Vec<_>>()});
        let mut pool = Pool::from_shelf("v".into(), &shelf);
        pool.apply_page(
            0,
            &page(&[(1, "a"), (2, "b"), (3, "c"), (4, "d"), (5, "e"), (6, "f")]),
        );
        assert_eq!(pool.fetch_target(6), None);
        assert_eq!(ids(&pool.take(6)).len(), 6);
    }

    #[test]
    fn wraps_around_shown_books_after_exhaustion() {
        let mut pool = Pool::from_shelf("v".into(), &shelf());
        pool.apply_page(0, &page(&[(1, "a"), (2, "b"), (3, "c")]));
        for i in 0..3 {
            pool.mark_failed(i);
        }
        let first = pool.take(2);
        assert_eq!(ids(&first), ["a", "b"]);
        assert!(!first.wrapped);
        let second = pool.take(2);
        assert_eq!(ids(&second), ["c"]);
        assert!(second.exhausted);
        let third = pool.take(2);
        assert!(third.wrapped);
        assert_eq!(ids(&third), ["a", "b"]);
        assert_eq!(ids(&pool.take(2)), ["c", "a"]);
    }

    #[test]
    fn empty_shelf_has_no_seeds() {
        let mut pool = Pool::from_shelf("v".into(), &json!({"books": []}));
        assert_eq!(pool.fetch_target(4), None);
        let batch = pool.take(4);
        assert!(!batch.has_seeds && batch.books.is_empty() && batch.exhausted);
    }

    #[test]
    fn normalize_similar_flattens_and_tracks_cursor() {
        let out = normalize_similar(&page(&[(7, "x"), (8, "y")]), 6);
        assert_eq!(out.books.len(), 2);
        assert_eq!(out.next_idx, 8);
        assert!(out.has_more);
        assert_eq!(out.session_id.as_deref(), Some("s1"));
        let end = normalize_similar(&page(&[]), 8);
        assert!(!end.has_more);
    }
}
