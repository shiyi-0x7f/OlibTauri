use reqwest::Client;
use serde_json::{json, Value};

const GATEWAY_URL: &str = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION: &str = "1.0.3";

pub struct WereadClient {
    client: Client,
    api_key: String,
}

impl WereadClient {
    pub fn new(api_key: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to create WeRead HTTP client");
        Self { client, api_key }
    }

    async fn call(&self, api_name: &str, extra_params: Value) -> Result<Value, String> {
        let mut body = json!({
            "api_name": api_name,
            "skill_version": SKILL_VERSION,
        });

        if let Value::Object(params) = extra_params {
            let obj = body.as_object_mut().unwrap();
            for (k, v) in params {
                obj.insert(k, v);
            }
        }

        let resp = self
            .client
            .post(GATEWAY_URL)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("WeRead request failed: {}", e))?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read WeRead response: {}", e))?;

        if !status.is_success() {
            return Err(format!(
                "WeRead HTTP {}: {}",
                status,
                if text.len() > 200 {
                    &text[..200]
                } else {
                    &text
                }
            ));
        }

        let data: Value =
            serde_json::from_str(&text).map_err(|e| format!("WeRead JSON parse error: {}", e))?;

        let errcode = data.get("errcode").and_then(|v| v.as_i64()).unwrap_or(0);
        if errcode != 0 {
            let errmsg = data
                .get("errmsg")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("WeRead API error ({}): {}", errcode, errmsg));
        }

        Ok(data)
    }

    pub async fn get_stats(&self) -> Result<Value, String> {
        self.call("/readdata/detail", json!({"mode": "overall"}))
            .await
    }

    pub async fn get_shelf(&self) -> Result<Value, String> {
        self.call("/shelf/sync", json!({})).await
    }

    pub async fn get_notebooks(
        &self,
        count: Option<i64>,
        last_sort: Option<i64>,
    ) -> Result<Value, String> {
        let mut params = json!({});
        let obj = params.as_object_mut().unwrap();
        if let Some(c) = count {
            obj.insert("count".into(), json!(c));
        }
        if let Some(ls) = last_sort {
            obj.insert("lastSort".into(), json!(ls));
        }
        self.call("/user/notebooks", params).await
    }

    pub async fn get_all_notebooks(&self) -> Result<Value, String> {
        let first_page = self.get_notebooks(Some(100), None).await?;

        let mut all_books: Vec<Value> = first_page
            .get("books")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let total_book_count = first_page
            .get("totalBookCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let total_note_count = first_page
            .get("totalNoteCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let mut has_more = first_page
            .get("hasMore")
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
            == 1;

        while has_more && !all_books.is_empty() {
            let last_sort = all_books
                .last()
                .and_then(|b| b.get("sort"))
                .and_then(|v| v.as_i64());

            if last_sort.is_none() {
                break;
            }

            let page = self.get_notebooks(Some(100), last_sort).await?;
            let page_books = page
                .get("books")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            if page_books.is_empty() {
                break;
            }

            all_books.extend(page_books);
            has_more = page.get("hasMore").and_then(|v| v.as_i64()).unwrap_or(0) == 1;
        }

        Ok(json!({
            "totalBookCount": total_book_count,
            "totalNoteCount": total_note_count,
            "hasMore": 0,
            "books": all_books,
        }))
    }

    pub async fn get_book_info(&self, book_id: &str) -> Result<Value, String> {
        self.call("/book/info", json!({"bookId": book_id})).await
    }

    pub async fn get_chapters(&self, book_id: &str) -> Result<Value, String> {
        self.call("/book/chapterinfo", json!({"bookId": book_id}))
            .await
    }

    pub async fn get_bookmarks(&self, book_id: &str) -> Result<Value, String> {
        self.call("/book/bookmarklist", json!({"bookId": book_id}))
            .await
    }

    pub async fn get_my_reviews(&self, book_id: &str) -> Result<Value, String> {
        self.call("/review/list/mine", json!({"bookid": book_id}))
            .await
    }

    pub async fn get_best_bookmarks(&self, book_id: &str) -> Result<Value, String> {
        self.call("/book/bestbookmarks", json!({"bookId": book_id}))
            .await
    }
}
