//! 阅读锦囊 prompt 与结果解析，移植自原 olibai `app/routers/prescribe.py`（仅保留中文）。

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ReadingTip {
    #[serde(default)]
    pub book_name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ReadingBag {
    pub diagnosis: String,
    pub tips: Vec<ReadingTip>,
}

/// 主题快捷入口 → 用户状态描述（与前端 aiThemes 的 key 对应）
fn theme_description(key: &str) -> Option<&'static str> {
    Some(match key {
        "relax" => "工作压力大，想放松，需要减压",
        "direction" => "感到迷茫，想找人生方向",
        "learn" => "想系统学习某个领域的知识",
        "bedtime" => "睡前想读点轻松的内容",
        "heal" => "情感低落，需要治愈和安慰",
        "thinking" => "想提升认知能力和思维水平",
        _ => return None,
    })
}

/// `count`：推荐几本；`extra`：用户补充要求（空 = 无），追加在格式要求之后，不改动 JSON 约定
pub fn build_prompt(input: &str, input_type: &str, count: u8, extra: &str) -> String {
    let description = match input_type {
        "free" => input,
        _ => theme_description(input).unwrap_or(input),
    };
    let extra = extra.trim();
    let extra = if extra.is_empty() {
        String::new()
    } else {
        format!("\n- 用户的补充要求（在不违反以上格式的前提下遵守）：{extra}")
    };
    format!(
        r#"你是一位资深阅读顾问。用户描述了当前状态："{description}"。

请推荐 {count} 本最适合的书，严格按以下 JSON 格式返回：
{{
  "diagnosis": "一句相关的著名谚语或者名言",
  "tips": [
    {{
      "book_name": "书名",
      "author": "作者",
      "reason": "一句推荐理由",
      "category": "分类标签"
    }}
  ]
}}

要求：
- 只返回 JSON，不要包含其他文字
- tips 数组固定 {count} 项
- category 使用简短中文标签（如：治愈、思维、文学、技能、心灵、小说、随笔、管理、哲学、成长、心理、学习）{extra}"#
    )
}

/// 从模型回复中提取 JSON：去掉推理模型的 `<think>` 段，兼容 markdown 代码块与前后多余文字
pub fn extract_json(text: &str) -> Result<serde_json::Value, String> {
    let mut text = text;
    if let Some(end) = text.rfind("</think>") {
        text = &text[end + "</think>".len()..];
    }
    let text = text.trim();
    if let Ok(v) = serde_json::from_str(text) {
        return Ok(v);
    }
    // 代码块或前后夹带说明文字：取第一个 `{` 到最后一个 `}`
    match (text.find('{'), text.rfind('}')) {
        (Some(start), Some(end)) if start < end => serde_json::from_str(&text[start..=end])
            .map_err(|e| format!("AI 返回的不是合法 JSON: {}", e)),
        _ => Err("AI 返回中没有找到 JSON".to_string()),
    }
}

/// `max_tips`：最多保留几本（模型多给时截断）
pub fn validate_reading_bag(
    data: &serde_json::Value,
    max_tips: usize,
) -> Result<ReadingBag, String> {
    let diagnosis = data
        .get("diagnosis")
        .and_then(|v| v.as_str())
        .ok_or("缺少 diagnosis 字段")?;
    let tips = data
        .get("tips")
        .and_then(|v| v.as_array())
        .ok_or("tips 必须是数组")?;
    let tips: Vec<ReadingTip> = tips
        .iter()
        .take(max_tips)
        .filter_map(|t| serde_json::from_value::<ReadingTip>(t.clone()).ok())
        .filter(|t| !t.book_name.trim().is_empty())
        .collect();
    if tips.is_empty() {
        return Err("tips 为空".to_string());
    }
    Ok(ReadingBag {
        diagnosis: diagnosis.to_string(),
        tips,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bag(n: usize) -> serde_json::Value {
        json!({
            "diagnosis": "短句诊断",
            "tips": (0..n).map(|i| json!({
                "book_name": format!("书{}", i), "author": "作者", "reason": "理由", "category": "分类"
            })).collect::<Vec<_>>(),
        })
    }

    #[test]
    fn prompt_maps_theme_and_keeps_free_text() {
        assert!(build_prompt("relax", "theme", 3, "").contains("工作压力大"));
        assert!(build_prompt("relax", "free", 3, "").contains("\"relax\""));
        assert!(build_prompt("想学心理学", "theme", 3, "").contains("想学心理学"));
    }

    #[test]
    fn prompt_uses_count_and_appends_extra() {
        let p = build_prompt("x", "free", 5, "");
        assert!(p.contains("推荐 5 本") && p.contains("固定 5 项"));
        assert!(!p.contains("补充要求"));
        let p = build_prompt("x", "free", 3, "  只推荐中文书 ");
        assert!(p.contains("补充要求") && p.contains("只推荐中文书"));
    }

    #[test]
    fn extract_plain_and_fenced_json() {
        assert_eq!(extract_json(r#"{"a": 1}"#).unwrap(), json!({"a": 1}));
        assert_eq!(
            extract_json("```json\n{\"a\": 1}\n```").unwrap(),
            json!({"a": 1})
        );
        assert_eq!(
            extract_json("Sure! Here is the result:\n```\n{\"b\": 2}\n```\n").unwrap(),
            json!({"b": 2})
        );
        assert_eq!(
            extract_json("```json   \n  {\"c\": 3}  \n```").unwrap(),
            json!({"c": 3})
        );
    }

    #[test]
    fn extract_strips_think_block() {
        let text = "<think>先想想 {不是 JSON}</think>\n{\"d\": 4}";
        assert_eq!(extract_json(text).unwrap(), json!({"d": 4}));
    }

    #[test]
    fn extract_rejects_non_json() {
        assert!(extract_json("not json").is_err());
    }

    #[test]
    fn validate_bag_rules() {
        assert_eq!(validate_reading_bag(&bag(3), 3).unwrap().tips.len(), 3);
        assert_eq!(validate_reading_bag(&bag(5), 3).unwrap().tips.len(), 3);
        assert_eq!(validate_reading_bag(&bag(5), 8).unwrap().tips.len(), 5);
        assert_eq!(validate_reading_bag(&bag(1), 3).unwrap().tips.len(), 1);
        assert!(validate_reading_bag(&bag(0), 3).is_err());
        assert!(validate_reading_bag(&json!({"tips": []}), 3).is_err());
        assert!(validate_reading_bag(&json!({"diagnosis": "x"}), 3).is_err());
        assert!(validate_reading_bag(&json!({"diagnosis": "x", "tips": "oops"}), 3).is_err());
    }
}
