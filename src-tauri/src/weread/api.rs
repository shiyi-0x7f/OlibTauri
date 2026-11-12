//! 微信读书资源接口（移动端路径，参数与 olib-mobile `weread_api.dart` 对齐）。
//! 返回值保持原 API Key 网关时期的形状，前端无需改动。

use super::client::{call, Request};
use serde_json::{json, Value};
use std::collections::HashSet;

/// 笔记本翻页上限：服务端可能忽略游标返回全量快照，防止死循环。
const MAX_NOTEBOOK_PAGES: usize = 50;

pub async fn stats() -> Result<Value, String> {
    // 不传 mode 会 499；overall 为累计数据
    let mut data = call(Request::get(
        "/readdata/detail",
        vec![("mode", "overall".into())],
    ))
    .await?;
    fill_day_average(&mut data);
    Ok(data)
}

/// 指定周期的阅读统计（weekly / monthly / annually / overall），`base_time` 为周期起点（秒）。
pub async fn read_data(mode: &str, base_time: Option<i64>) -> Result<Value, String> {
    if !matches!(mode, "weekly" | "monthly" | "annually" | "overall") {
        return Err(format!("不支持的统计周期: {}", mode));
    }
    let mut query = vec![("mode", mode.to_string())];
    if let Some(t) = base_time {
        query.push(("baseTime", t.to_string()));
    }
    let mut data = call(Request::get("/readdata/detail", query)).await?;
    fill_day_average(&mut data);
    Ok(data)
}

/// overall 模式不返回 `dayAverageReadTime`（周 / 月 / 年模式才有，且官方按自然日平均）。
/// 累计没有明确的起始日，这里按「总时长 ÷ 阅读天数」补齐，单位秒。
fn fill_day_average(data: &mut Value) {
    let Some(obj) = data.as_object_mut() else {
        return;
    };
    if obj.get("dayAverageReadTime").is_some_and(|v| !v.is_null()) {
        return;
    }
    let total = obj
        .get("totalReadTime")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let days = obj.get("readDays").and_then(Value::as_i64).unwrap_or(0);
    let average = if days > 0 { total / days } else { 0 };
    obj.insert("dayAverageReadTime".into(), json!(average));
}

pub async fn shelf() -> Result<Value, String> {
    call(Request::get("/shelf/sync", vec![])).await
}

async fn notebooks_page(last_sort: Option<i64>) -> Result<Value, String> {
    let mut query = vec![("count", "100".to_string())];
    if let Some(sort) = last_sort {
        query.push(("lastSort", sort.to_string()));
    }
    call(Request::get("/user/notebooks", query)).await
}

pub async fn all_notebooks() -> Result<Value, String> {
    let first = notebooks_page(None).await?;
    let mut merger = NotebookMerger::new(&first);
    let mut pages = 1;
    while let Some(last_sort) = merger.next_cursor() {
        if pages >= MAX_NOTEBOOK_PAGES {
            log::warn!("微信读书笔记本翻页达到上限 {}，停止", MAX_NOTEBOOK_PAGES);
            break;
        }
        let page = notebooks_page(Some(last_sort)).await?;
        pages += 1;
        if !merger.add_page(&page) {
            break;
        }
    }
    Ok(merger.finish())
}

pub async fn book_info(book_id: &str) -> Result<Value, String> {
    call(Request::get("/book/info", vec![("bookId", book_id.into())])).await
}

pub async fn chapters(book_id: &str) -> Result<Value, String> {
    let data = call(Request::post(
        "/book/chapterInfos",
        json!({
            "bookIds": [book_id],
            "synckeys": [0],
            "updateTimes": [0],
            "maxfreeIdx": [0],
        }),
        true,
    ))
    .await?;
    normalize_chapters(&data, book_id)
}

pub async fn bookmarks(book_id: &str) -> Result<Value, String> {
    call(Request::get(
        "/book/bookmarklist",
        vec![("bookId", book_id.into()), ("synckey", "0".into())],
    ))
    .await
}

pub async fn my_reviews(book_id: &str) -> Result<Value, String> {
    call(Request::get(
        "/review/list",
        vec![
            ("bookId", book_id.into()),
            ("listType", "1".into()),
            ("listMode", "0".into()),
            ("mine", "1".into()),
            ("synckey", "0".into()),
            ("count", "100".into()),
        ],
    ))
    .await
}

pub async fn best_bookmarks(book_id: &str) -> Result<Value, String> {
    call(Request::get(
        "/book/bestbookmarks",
        vec![
            ("bookId", book_id.into()),
            ("chapterUid", "0".into()),
            ("count", "21".into()),
            ("maxIdx", "0".into()),
            ("synckey", "0".into()),
        ],
    ))
    .await
}

/// 相似书一页：`/book/detailinfo?listtypes=2`。续页时 `max_idx` 传上一页最后一条的 `idx`，
/// 并带回响应里的 `booksimilar.sessionId`。
pub async fn similar_page(
    book_id: &str,
    max_idx: i64,
    session_id: Option<&str>,
    count: u32,
) -> Result<Value, String> {
    let mut query = vec![
        ("bookId", book_id.to_string()),
        ("listtypes", "2".to_string()),
        ("synckey", "0".to_string()),
        ("count", count.to_string()),
        ("maxIdx", max_idx.to_string()),
    ];
    if let Some(sid) = session_id.filter(|s| !s.is_empty()) {
        query.push(("sessionId", sid.to_string()));
    }
    call(Request::get("/book/detailinfo", query)).await
}

/// `/book/chapterInfos` 返回 `{ data: [{ bookId, updated: [...] }] }`，归一为 `{ bookId, chapters }`。
fn normalize_chapters(data: &Value, book_id: &str) -> Result<Value, String> {
    let entries = data
        .get("data")
        .and_then(Value::as_array)
        .ok_or("章节响应缺少 data")?;
    let entry = entries.first().cloned().unwrap_or_else(|| json!({}));
    let chapters = match entry.get("updated") {
        None | Some(Value::Null) => json!([]),
        Some(Value::Array(list)) => Value::Array(list.clone()),
        Some(_) => return Err("章节响应格式无效".to_string()),
    };
    Ok(json!({
        "bookId": entry.get("bookId").cloned().unwrap_or_else(|| json!(book_id)),
        "chapters": chapters,
    }))
}

/// 笔记本分页合并：按 bookId 去重，某页无新书即终止。
struct NotebookMerger {
    total_book_count: Value,
    total_note_count: Value,
    books: Vec<Value>,
    seen: HashSet<String>,
    has_more: bool,
}

impl NotebookMerger {
    fn new(first: &Value) -> Self {
        let mut merger = Self {
            total_book_count: first.get("totalBookCount").cloned().unwrap_or(json!(0)),
            total_note_count: first.get("totalNoteCount").cloned().unwrap_or(json!(0)),
            books: Vec::new(),
            seen: HashSet::new(),
            has_more: false,
        };
        merger.add_page(first);
        merger
    }

    /// 合并一页，返回是否带来了新书。
    fn add_page(&mut self, page: &Value) -> bool {
        let mut added = false;
        for book in page
            .get("books")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let id = book
                .get("bookId")
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
                .unwrap_or_default();
            if self.seen.insert(id) {
                self.books.push(book.clone());
                added = true;
            }
        }
        self.has_more = added && page.get("hasMore").and_then(Value::as_i64) == Some(1);
        added
    }

    fn next_cursor(&self) -> Option<i64> {
        if !self.has_more {
            return None;
        }
        self.books
            .last()
            .and_then(|b| b.get("sort"))
            .and_then(Value::as_i64)
    }

    fn finish(self) -> Value {
        json!({
            "totalBookCount": self.total_book_count,
            "totalNoteCount": self.total_note_count,
            "hasMore": 0,
            "books": self.books,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_average_is_filled_only_when_missing() {
        let mut overall = json!({"totalReadTime": 696225, "readDays": 337});
        fill_day_average(&mut overall);
        assert_eq!(overall["dayAverageReadTime"], 2065);

        let mut yearly = json!({"totalReadTime": 20608, "readDays": 26, "dayAverageReadTime": 74});
        fill_day_average(&mut yearly);
        assert_eq!(yearly["dayAverageReadTime"], 74);

        let mut empty = json!({"totalReadTime": 0, "readDays": 0});
        fill_day_average(&mut empty);
        assert_eq!(empty["dayAverageReadTime"], 0);
    }

    #[test]
    fn chapters_are_normalized_from_first_entry() {
        let data = json!({"data": [{"bookId": "b1", "updated": [{"chapterUid": 1}]}]});
        let out = normalize_chapters(&data, "b1").unwrap();
        assert_eq!(out["bookId"], "b1");
        assert_eq!(out["chapters"][0]["chapterUid"], 1);

        let empty = normalize_chapters(&json!({"data": []}), "b2").unwrap();
        assert_eq!(empty["bookId"], "b2");
        assert_eq!(empty["chapters"], json!([]));

        assert!(normalize_chapters(&json!({}), "b").is_err());
    }

    #[test]
    fn notebook_merger_stops_when_snapshot_repeats() {
        let page = json!({
            "totalBookCount": 2, "totalNoteCount": 5, "hasMore": 1,
            "books": [{"bookId": "a", "sort": 9}, {"bookId": "b", "sort": 5}],
        });
        let mut merger = NotebookMerger::new(&page);
        assert_eq!(merger.next_cursor(), Some(5));
        // 服务端忽略游标、返回同一快照：无新书 → 终止
        assert!(!merger.add_page(&page));
        assert_eq!(merger.next_cursor(), None);
        let out = merger.finish();
        assert_eq!(out["books"].as_array().unwrap().len(), 2);
        assert_eq!(out["hasMore"], 0);
    }

    #[test]
    fn notebook_merger_follows_real_pagination() {
        let first = json!({"hasMore": 1, "books": [{"bookId": "a", "sort": 9}]});
        let mut merger = NotebookMerger::new(&first);
        let second = json!({"hasMore": 0, "books": [{"bookId": "b", "sort": 3}]});
        assert!(merger.add_page(&second));
        assert_eq!(merger.next_cursor(), None);
        assert_eq!(merger.finish()["books"].as_array().unwrap().len(), 2);
    }
}
