//! 插件开发指南：随应用内置（编译进二进制），打开插件页时写到 app 数据目录，
//! 供用户本机的 AI Agent（Claude Code / Codex 等）直接读取。
//!
//! 内置插件列表与本机路径在生成时填入，保证指南与正在运行的这份 Olib 一致。
//! 校验规则在 guide.md 里是手写的——改了 manifest.rs 的校验或 runner.rs 的成败判定，必须同步 guide.md。

use serde::Serialize;
use std::path::{Path, PathBuf};

use super::manifest::Origin;

const TEMPLATE: &str = include_str!("guide.md");
const FILE_NAME: &str = "plugin-dev-guide.md";

#[derive(Debug, Serialize)]
pub struct PluginGuide {
    /// 指南文件的绝对路径（给 Agent 读）
    pub guide_path: String,
    /// 本地插件源目录（Agent 写好的清单放这里）
    pub registries_dir: String,
    /// 指南全文（页面内预览）
    pub content: String,
}

/// 生成指南并写到 `app_data/plugin-dev-guide.md`；顺带建好本地插件源目录，Agent 可直接往里放清单
pub fn export(app_data: &Path) -> Result<PluginGuide, String> {
    let registries = super::registries_dir(app_data);
    std::fs::create_dir_all(&registries).map_err(|e| format!("创建插件源目录失败: {}", e))?;

    let content = render(&registries, &super::location::root());
    let path: PathBuf = app_data.join(FILE_NAME);
    std::fs::write(&path, &content).map_err(|e| format!("写入插件开发指南失败: {}", e))?;

    Ok(PluginGuide {
        guide_path: path.to_string_lossy().to_string(),
        registries_dir: registries.to_string_lossy().to_string(),
        content,
    })
}

fn render(registries_dir: &Path, plugins_root: &Path) -> String {
    TEMPLATE
        .replace("{{APP_VERSION}}", env!("CARGO_PKG_VERSION"))
        .replace("{{REGISTRIES_DIR}}", &registries_dir.to_string_lossy())
        .replace("{{PLUGINS_ROOT}}", &plugins_root.to_string_lossy())
        .replace("{{BUILTIN_PLUGINS}}", &builtin_table())
}

/// 内置插件一览：id / 名称 / 能做什么（动作名或输入→输出格式）
fn builtin_table() -> String {
    let mut rows = vec![
        "| id | 名称 | 功能 |".to_string(),
        "| --- | --- | --- |".to_string(),
    ];
    for p in super::all().iter().filter(|p| p.origin == Origin::Builtin) {
        let actions: Vec<&str> = p
            .exec
            .iter()
            .flat_map(|e| e.actions.iter().map(|a| a.name.as_str()))
            .collect();
        let formats = format!(
            "{} → {}",
            p.inputs.join(" / ").to_uppercase(),
            p.outputs.join(" / ").to_uppercase()
        );
        let what = if actions.is_empty() {
            formats
        } else {
            format!("{}（{}）", actions.join("、"), formats)
        };
        rows.push(format!("| `{}` | {} | {} |", p.id, p.name, what));
    }
    rows.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rendered_guide_has_no_placeholders_and_lists_builtins() {
        crate::plugins::init(&std::env::temp_dir().join("olib-guide-test"));
        let text = render(Path::new(r"C:\data\registries"), Path::new(r"D:\plugins"));

        assert!(!text.contains("{{"), "every placeholder must be filled");
        assert!(text.contains(r"C:\data\registries"));
        assert!(text.contains(r"D:\plugins"));
        for id in ["calibre", "pdfcpu", "umi-ocr", "qpdf"] {
            assert!(
                text.contains(&format!("| `{}` |", id)),
                "missing builtin {}",
                id
            );
        }
    }
}
