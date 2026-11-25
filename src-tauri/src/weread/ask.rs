//! 微信读书 AI 问书：建议问题、工具栏快捷提问、轮询式回答（逐帧推送前端，可取消）。
//!
//! 实测（2026-10-03，见 `dev_docs/weread-mobile-session.md` P3）：
//! - `/ai/chat/suggest` 默认返回 3 个 `questions`；`cmd: "toolbar"` 返回 `prompts`
//!   （全书总结 / 书籍亮点 / 背景解读，intent `weread-toolbar-book-scale`）；
//!   `questionHints[].hints` 是内部埋点串，不展示。
//! - `/ai/chatv2` 的 `result.text` 是累计快照；带旧 `session_id` 追问只会重放旧答案，**不支持多轮**。
//! - `weread_opt.query_context` 传划线原文无效，划线提问需把原文写进问题本身。

use super::client::{call, Request};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::util::LockExt;

pub const ASK_EVENT: &str = "weread-ask";
const MAX_POLLS: usize = 80;
const MAX_INTERVAL_MS: u64 = 1500;
const MAX_QUESTION_CHARS: usize = 1000;

static NEXT_ASK_ID: AtomicU64 = AtomicU64::new(1);
/// 进行中的提问；取消即移除，轮询循环下一轮发现不在集合中就退出。
static ACTIVE: Lazy<Mutex<HashSet<u64>>> = Lazy::new(|| Mutex::new(HashSet::new()));

static CITATION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<citation\b[^>]*>.*?</citation>|<citation\b[^>]*/?>").expect("valid regex")
});
static THINK_TAG: Lazy<Regex> = Lazy::new(|| Regex::new(r"</?think>").expect("valid regex"));

#[derive(Debug, Serialize, PartialEq)]
pub struct ToolbarPrompt {
    pub title: String,
    pub prompt: String,
    pub intent: String,
}

#[derive(Debug, Serialize)]
pub struct Suggestions {
    pub questions: Vec<String>,
    pub prompts: Vec<ToolbarPrompt>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AskFrame {
    ask_id: u64,
    text: String,
    thinking: String,
    done: bool,
    error: Option<String>,
}

/// 建议问题 + 工具栏快捷提问（两次请求并发）。`chapter_uid` 用于按章节出题。
pub async fn suggestions(book_id: &str, chapter_uid: i64) -> Result<Suggestions, String> {
    let questions = call(Request::post(
        "/ai/chat/suggest",
        json!({ "bookId": book_id, "chapterUid": chapter_uid, "mpReviewId": "", "range": "" }),
        true,
    ));
    let toolbar = call(Request::post(
        "/ai/chat/suggest",
        json!({ "bookId": book_id, "chapterUid": 0, "cmd": "toolbar" }),
        true,
    ));
    let (questions, toolbar) = tokio::join!(questions, toolbar);
    // 工具栏失败不影响建议问题，反之亦然；两者都失败才报错
    match (&questions, &toolbar) {
        (Err(e), Err(_)) => return Err(e.clone()),
        (Err(e), _) | (_, Err(e)) => log::warn!("微信读书 AI 建议部分失败: {}", e),
        _ => {}
    }
    Ok(Suggestions {
        questions: questions.map(|v| parse_questions(&v)).unwrap_or_default(),
        prompts: toolbar.map(|v| parse_prompts(&v)).unwrap_or_default(),
    })
}

fn parse_questions(v: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let from_questions = v.get("questions").and_then(Value::as_array);
    let from_hints = v.get("questionHints").and_then(Value::as_array);
    let candidates = from_questions
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .chain(
            from_hints
                .into_iter()
                .flatten()
                .filter_map(|h| h.get("question").and_then(Value::as_str)),
        );
    for q in candidates {
        let q = q.trim();
        if !q.is_empty() && !out.iter().any(|x| x == q) {
            out.push(q.to_string());
        }
    }
    out
}

fn parse_prompts(v: &Value) -> Vec<ToolbarPrompt> {
    v.get("prompts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let title = p.get("title").and_then(Value::as_str)?.trim();
            let prompt = p.get("prompt").and_then(Value::as_str)?.trim();
            if title.is_empty() || prompt.is_empty() {
                return None;
            }
            Some(ToolbarPrompt {
                title: title.to_string(),
                prompt: prompt.to_string(),
                intent: p
                    .get("intent")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect()
}

/// 去掉引用标签与开头空白（回答正文是 Markdown，交前端渲染）。
pub fn clean_answer(text: &str) -> String {
    CITATION.replace_all(text, "").trim().to_string()
}

pub fn clean_thinking(text: &str) -> String {
    THINK_TAG.replace_all(text, "").trim().to_string()
}

/// 开始提问，立即返回 ask_id；回答经 `weread-ask` 事件逐帧推送，最后一帧 `done = true`。
pub fn start(
    app: AppHandle,
    book_id: String,
    query: String,
    intent: String,
) -> Result<u64, String> {
    let query = query.trim().to_string();
    let len = query.chars().count();
    if len == 0 || len > MAX_QUESTION_CHARS {
        return Err(format!("问题长度需在 1–{} 字之间", MAX_QUESTION_CHARS));
    }
    let ask_id = NEXT_ASK_ID.fetch_add(1, Ordering::Relaxed);
    ACTIVE.lock_ignore_poison().insert(ask_id);
    tauri::async_runtime::spawn(async move {
        let result = run(&app, ask_id, &book_id, &query, &intent).await;
        let still_active = ACTIVE.lock_ignore_poison().remove(&ask_id);
        if !still_active {
            return; // 已取消，前端不再关心
        }
        if let Err(error) = result {
            log::warn!("微信读书 AI 问书失败: {}", error);
            emit(
                &app,
                AskFrame {
                    ask_id,
                    text: String::new(),
                    thinking: String::new(),
                    done: true,
                    error: Some(error),
                },
            );
        }
    });
    Ok(ask_id)
}

pub fn cancel(ask_id: u64) {
    ACTIVE.lock_ignore_poison().remove(&ask_id);
}

fn is_active(ask_id: u64) -> bool {
    ACTIVE.lock_ignore_poison().contains(&ask_id)
}

fn emit(app: &AppHandle, frame: AskFrame) {
    if let Err(e) = app.emit(ASK_EVENT, frame) {
        log::warn!("推送微信读书 AI 回答失败: {}", e);
    }
}

async fn run(
    app: &AppHandle,
    ask_id: u64,
    book_id: &str,
    query: &str,
    intent: &str,
) -> Result<(), String> {
    let mut chat_id = String::new();
    let mut session_id = String::new();
    let mut text = String::new();
    let mut thinking = String::new();

    for _ in 0..MAX_POLLS {
        if !is_active(ask_id) {
            return Ok(());
        }
        // 首帧没有 chatid，重放会开启第二次推理，故不可重放；续帧可重放
        let data = call(Request::post(
            "/ai/chatv2",
            json!({
                "accept_text_type": 1,
                "bookId": book_id,
                "query": query,
                "scene": 1,
                "isPlugin": false,
                "intent": intent,
                "weread_opt": { "intent": intent, "query_context": "" },
                "chatid": chat_id,
                "session_id": session_id,
            }),
            !chat_id.is_empty(),
        ))
        .await?;

        if let Some(id) = data
            .get("chatid")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            chat_id = id.to_string();
        }
        if let Some(id) = data
            .get("session_id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            session_id = id.to_string();
        }
        // result.text 是累计快照；末帧可能不重复正文，保留最后一个非空值
        let frame_text = data
            .pointer("/result/text")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !frame_text.is_empty() {
            text = clean_answer(frame_text);
        }
        if let Some(t) = data
            .pointer("/thinking_result/text")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            thinking = clean_thinking(t);
        }

        let stream_done = data.pointer("/result/has_more").and_then(Value::as_i64) == Some(0);
        let sections_done = data
            .pointer("/extra_sections/has_more")
            .and_then(Value::as_bool)
            == Some(false);
        let done = stream_done || (sections_done && !frame_text.is_empty());
        if done && text.is_empty() {
            return Err("AI 没有返回回答".to_string());
        }
        if !is_active(ask_id) {
            return Ok(());
        }
        emit(
            app,
            AskFrame {
                ask_id,
                text: text.clone(),
                thinking: thinking.clone(),
                done,
                error: None,
            },
        );
        if done {
            return Ok(());
        }
        if chat_id.is_empty() {
            return Err("AI 回答缺少会话 ID".to_string());
        }
        let interval = data
            .get("request_interval")
            .and_then(Value::as_u64)
            .unwrap_or(200)
            .min(MAX_INTERVAL_MS);
        tokio::time::sleep(Duration::from_millis(interval)).await;
    }
    Err("AI 回答超时未完成".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answer_strips_citations_and_leading_blank_lines() {
        let raw = "\n\n**正义**<citation idx='1'></citation>是城邦的基础<citation idx=\"2\"/>。";
        assert_eq!(clean_answer(raw), "**正义**是城邦的基础。");
    }

    #[test]
    fn thinking_strips_think_tags() {
        assert_eq!(
            clean_thinking("先分析。\n\n<think>再总结</think>"),
            "先分析。\n\n再总结"
        );
    }

    #[test]
    fn questions_are_merged_and_deduped() {
        let v = json!({
            "questions": ["甲？", " 乙？ "],
            "questionHints": [{"question": "甲？", "hints": "book_id=1&task_type=14"}, {"question": "丙？"}],
        });
        assert_eq!(parse_questions(&v), ["甲？", "乙？", "丙？"]);
    }

    #[test]
    fn prompts_skip_incomplete_entries() {
        let v = json!({"prompts": [
            {"title": "全书总结", "prompt": "这本书讲了什么？", "intent": "weread-toolbar-book-scale"},
            {"title": "", "prompt": "x"},
            {"title": "缺 intent", "prompt": "y"},
        ]});
        let p = parse_prompts(&v);
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].intent, "weread-toolbar-book-scale");
        assert_eq!(p[1].intent, "");
    }
}
