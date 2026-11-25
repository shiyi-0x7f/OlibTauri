//! 下载文件名清洗：把书名转成在 Windows / macOS / Linux 上都能安全落盘的文件名。
//!
//! 书名可能很长（合集书名常见数百字符），并夹带换行、零宽字符、路径分隔符等，
//! 直接拼文件名会超出单段 255 上限 / Windows MAX_PATH，或被文件系统拒绝。

/// 书名部分最多保留的字符数（兼顾可读性与外部工具的 MAX_PATH 限制）
const MAX_STEM_CHARS: usize = 100;
/// 书名部分最多保留的 UTF-8 字节数（macOS / Linux 单段上限 255 字节，留出后缀余量）
const MAX_STEM_BYTES: usize = 180;
/// 扩展名最长字符数
const MAX_EXT_CHARS: usize = 10;
/// 清洗后为空时的兜底名
const FALLBACK_STEM: &str = "book";

/// 文件系统非法字符，外加历史上为兼容外部下载器 / URL 一并去掉的 `& # ! @ =`
const INVALID_CHARS: &[char] = &[
    '/', '\\', ':', '*', '?', '"', '<', '>', '|', '&', '#', '!', '@', '=',
];

/// Windows 保留设备名（不区分大小写，带扩展名也不行）
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 不可见的格式字符：零宽、双向控制、BOM、软连字符等
fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{00AD}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}'
    )
}

/// 截断/清洗后不应出现在结尾（Windows 不允许结尾点和空格，其余是截断残留的分隔符）
fn is_trailing_junk(c: char) -> bool {
    matches!(
        c,
        ' ' | '.' | ',' | ';' | '-' | '_' | '(' | '[' | '（' | '【' | '，' | '；'
    )
}

/// 清洗书名部分（不含扩展名）
fn sanitize_stem(title: &str) -> String {
    // 非法 / 控制字符替换为空格，避免前后单词粘连；连续空白折叠为一个
    let mut stem = String::with_capacity(title.len());
    let mut last_space = true; // 同时去掉开头空白
    for c in title.chars() {
        // 不可见字符直接丢弃（常夹在单词中间，替换成空格反而拆词）
        if is_invisible(c) {
            continue;
        }
        let c = if INVALID_CHARS.contains(&c) || c.is_control() {
            ' '
        } else {
            c
        };
        if c.is_whitespace() {
            if !last_space {
                stem.push(' ');
                last_space = true;
            }
        } else {
            stem.push(c);
            last_space = false;
        }
    }

    // 按字符数与字节数双重上限截断（只在字符边界截）
    let mut end = 0;
    for (count, (idx, c)) in stem.char_indices().enumerate() {
        if count >= MAX_STEM_CHARS || idx + c.len_utf8() > MAX_STEM_BYTES {
            break;
        }
        end = idx + c.len_utf8();
    }
    stem.truncate(end);

    let stem = stem
        .trim_start_matches(['.', ' '])
        .trim_end_matches(is_trailing_junk);
    if stem.is_empty() {
        return FALLBACK_STEM.to_string();
    }

    let base = stem.split('.').next().unwrap_or(stem);
    if RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(base)) {
        return format!("_{}", stem);
    }
    stem.to_string()
}

/// 扩展名只保留 ASCII 字母数字
fn sanitize_extension(extension: &str) -> String {
    extension
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(MAX_EXT_CHARS)
        .collect::<String>()
        .to_ascii_lowercase()
}

/// 由书名、扩展名与可选后缀（如去重时间戳）生成安全文件名：`{书名}[_{后缀}].{扩展名}`
pub fn build_filename(title: &str, extension: &str, suffix: Option<&str>) -> String {
    let mut name = sanitize_stem(title);
    if let Some(s) = suffix {
        name.push('_');
        name.push_str(s);
    }
    let ext = sanitize_extension(extension);
    if !ext.is_empty() {
        name.push('.');
        name.push_str(&ext);
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_normal_title() {
        assert_eq!(build_filename("三体", "epub", None), "三体.epub");
        assert_eq!(build_filename("Clean Code", "PDF", None), "Clean Code.pdf");
    }

    #[test]
    fn replaces_invalid_and_collapses_whitespace() {
        assert_eq!(
            build_filename("A/B: C?  *D*\n\tE", "epub", None),
            "A B C D E.epub"
        );
    }

    #[test]
    fn strips_invisible_chars() {
        assert_eq!(
            build_filename("\u{FEFF}Py\u{200B}thon\u{202E}", "epub", None),
            "Python.epub"
        );
    }

    #[test]
    fn trims_trailing_dots_and_spaces() {
        assert_eq!(build_filename("  Title...  ", "epub", None), "Title.epub");
        assert_eq!(build_filename("...hidden", "epub", None), "hidden.epub");
    }

    #[test]
    fn truncates_long_ascii_title() {
        let title = "Harry Potter and the Sorcerer's Stone; ".repeat(20);
        let name = build_filename(&title, "epub", Some("1700000000"));
        let stem = name.strip_suffix("_1700000000.epub").unwrap();
        assert!(stem.chars().count() <= MAX_STEM_CHARS);
        assert!(!stem.ends_with([' ', ';', '.']));
    }

    #[test]
    fn truncates_long_cjk_title_by_bytes() {
        let title = "这是一个非常长的中文书名".repeat(30);
        let name = build_filename(&title, "epub", None);
        let stem = name.strip_suffix(".epub").unwrap();
        assert!(stem.len() <= MAX_STEM_BYTES);
        assert!(name.len() <= 255);
    }

    #[test]
    fn handles_reserved_and_empty_names() {
        assert_eq!(build_filename("con", "txt", None), "_con.txt");
        assert_eq!(build_filename("NUL.tar", "gz", None), "_NUL.tar.gz");
        assert_eq!(build_filename("???", "epub", None), "book.epub");
        assert_eq!(build_filename("", "epub", None), "book.epub");
    }

    #[test]
    fn sanitizes_extension() {
        assert_eq!(build_filename("a", ".E/PUB", None), "a.epub");
        assert_eq!(build_filename("a", "", None), "a");
    }
}
