//! 插件清单（manifest）schema —— 这是对第三方开发者开放的契约。
//!
//! 一个插件 = 一份 JSON 声明：从哪下载、怎么校验、怎么解压、可执行文件在哪、怎么调用。
//! 通用引擎（installer / runner）按清单行事，插件作者无需写一行 Rust。
//!
//! 安全模型：信任边界取决于清单来源。
//! - 内置清单（`plugins.builtin.json`，编译进应用）= 应用作者背书，允许用动态解析器取最新版；
//! - 第三方清单（用户订阅的远程 registry / 本地导入）**必须提供 sha256**，否则拒绝安装，
//!   因为安装即执行外部可执行文件，没有校验和等同于放任远程代码执行。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 当前支持的清单格式版本；registry 声明的版本高于它就拒绝加载
pub const SCHEMA_VERSION: u32 = 1;

/// 一个 registry（内置的或订阅来的）
#[derive(Debug, Clone, Deserialize)]
pub struct Registry {
    pub schema_version: u32,
    pub plugins: Vec<PluginManifest>,
}

/// 清单来源，决定信任级别
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum Origin {
    /// 随应用编译，等同应用自身
    Builtin,
    /// 用户订阅的远程 registry
    Remote,
    /// 开发者本地导入（调试用）
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    /// 唯一标识，用作安装目录名，必须是 kebab-case 且不含路径分隔符
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 插件提供的能力，应用据此决定在哪露出入口（目前：convert）
    pub capability: String,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub homepage: String,
    #[serde(default)]
    pub license: String,
    /// 支持的输入扩展名（小写，不含点）。描述的是「这个能力吃什么」，与调用方式无关
    #[serde(default)]
    pub inputs: Vec<String>,
    /// 支持的输出扩展名（小写，不含点）
    #[serde(default)]
    pub outputs: Vec<String>,
    /// 按平台分的安装配置，键为 "windows" / "macos" / "linux"
    pub targets: HashMap<String, Target>,
    /// 调用方式之一：一次性命令行调用（输入输出都是文件）
    #[serde(default)]
    pub exec: Option<ExecSpec>,
    /// 调用方式之二：常驻 HTTP 服务（如 Umi-OCR，任务经其 HTTP 接口提交）
    #[serde(default)]
    pub service: Option<ServiceSpec>,

    /// 以下字段不来自 JSON，由加载器填充
    #[serde(skip, default = "default_origin")]
    pub origin: Origin,
}

fn default_origin() -> Origin {
    Origin::Remote
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Target {
    pub download: Download,
    pub install: Install,
    /// 解压后可执行文件的相对路径（相对插件安装目录）。
    /// 注意有些安装器会自建一层子目录，这里要写出完整相对路径。
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Download {
    /// 下载源，按顺序尝试；慢/失败自动切下一个
    #[serde(default)]
    pub sources: Vec<SourceSpec>,
    /// 内置动态解析器（如 "calibre-latest"，用于「总是取最新版」的官方插件）。
    /// 仅 Origin::Builtin 可用——动态 URL 无法预置 sha256。
    #[serde(default)]
    pub resolver: Option<String>,
    /// 安装包 sha256（小写十六进制）。第三方插件必填。
    #[serde(default)]
    pub sha256: Option<String>,
    /// 合理体积下限，用于识破「代理返回错误页」这类假成功
    #[serde(default)]
    pub min_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceSpec {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Install {
    pub kind: InstallKind,
    /// 仅 sfx-exe 用：安装器参数模板，`{dir}` 会被替换为安装目录
    #[serde(default)]
    pub args: Vec<String>,
    /// 安装路径长度上限（字符数）。某些安装器（如 Calibre 便携版）路径过长会
    /// 静默失败且退出码仍为 0，声明后由安装器前置校验。
    #[serde(default)]
    pub max_path_len: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstallKind {
    /// 自解压 exe：以安装目录为参数运行它
    SfxExe,
    /// zip 压缩包：解压到安装目录
    Zip,
}

/// 一次性命令行调用契约
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecSpec {
    /// 参数模板，支持占位符 `{input}` `{output}`。
    /// 供「目标格式由用户挑」的能力（如 convert）使用——产物扩展名来自用户选择，清单无法预知。
    #[serde(default)]
    pub args: Vec<String>,
    /// 从 stdout 提取进度的正则，第 1 个捕获组须为 0-100 的整数百分比。
    /// 不提供则任务只有「运行中/完成」两态。
    #[serde(default)]
    pub progress_regex: Option<String>,
    /// 动作：一插件包可暴露多个「一键操作」，直接出现在书架右键菜单里。
    /// 这是第三方插件的主要扩展点——参数、产物命名全在清单里说清，无需应用侧写任何代码。
    #[serde(default)]
    pub actions: Vec<ActionSpec>,
}

/// 一个一键动作（无参数，选中文件即可执行）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionSpec {
    /// 插件内唯一，用作调用标识
    pub id: String,
    /// 菜单里显示的名字，如「压缩瘦身」
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 该动作接受的输入扩展名；留空则继承插件的 `inputs`
    #[serde(default)]
    pub inputs: Vec<String>,
    /// 参数模板，支持占位符 `{input}` `{output}`
    pub args: Vec<String>,
    /// 同一插件包内的另一个可执行文件（相对安装目录）。
    /// 不填则用 `target.entry`——一个包里常有多个工具（如 Calibre 同时带
    /// ebook-convert 和 ebook-polish），动作可以各自指定。
    #[serde(default)]
    pub entry: Option<String>,
    /// 产物扩展名；不填 = 与输入相同（瘦身、解密这类「原地加工」的产物不换格式）
    #[serde(default)]
    pub output_ext: Option<String>,
    /// 产物文件名后缀，如 "-瘦身" → `书名-瘦身.epub`。为空则靠 " (n)" 去重
    #[serde(default)]
    pub output_suffix: String,
    /// 该动作专用的进度正则；不填则回落到 `ExecSpec::progress_regex`
    #[serde(default)]
    pub progress_regex: Option<String>,
}

impl ActionSpec {
    /// 该动作实际接受的输入扩展名（继承插件的 inputs）
    pub fn accepted_inputs<'a>(&'a self, plugin: &'a PluginManifest) -> &'a [String] {
        if self.inputs.is_empty() {
            &plugin.inputs
        } else {
            &self.inputs
        }
    }
}

/// 常驻 HTTP 服务契约。应用负责拉起进程、等它就绪、退出时关掉它；
/// 具体的接口调用由对应 capability 的处理器实现（HTTP 协议因工具而异，无法完全声明化）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceSpec {
    /// 启动参数
    #[serde(default)]
    pub args: Vec<String>,
    /// 服务监听端口
    pub port: u16,
    /// 健康检查路径（GET 返回 2xx 视为就绪）
    pub health: String,
    /// 就绪后立刻执行的参数（如把 GUI 收进托盘）
    #[serde(default)]
    pub post_start_args: Vec<String>,
    /// 应用退出时用于优雅关闭服务的参数
    #[serde(default)]
    pub quit_args: Vec<String>,
    /// 等待就绪的超时秒数
    #[serde(default = "default_startup_timeout")]
    pub startup_timeout_secs: u64,
}

fn default_startup_timeout() -> u64 {
    90
}

impl PluginManifest {
    /// 取当前平台的安装配置
    pub fn target(&self) -> Option<&Target> {
        self.targets.get(current_platform())
    }

    /// 当前平台是否支持一键安装
    pub fn supported(&self) -> bool {
        self.target().is_some()
    }

    /// 校验清单自身是否合法、是否满足其来源对应的安全要求
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self
                .id
                .contains(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
        {
            return Err(format!("插件 id 非法: {}", self.id));
        }

        for (platform, target) in &self.targets {
            if target.entry.is_empty() {
                return Err(format!("插件 {} 的 {} 缺少 entry", self.id, platform));
            }
            // entry 不得逃逸出插件目录
            if target.entry.contains("..") {
                return Err(format!("插件 {} 的 entry 含非法路径", self.id));
            }
            // 只允许 HTTPS
            for s in &target.download.sources {
                if !s.url.starts_with("https://") {
                    return Err(format!("插件 {} 的下载源必须是 https: {}", self.id, s.url));
                }
            }
            if target.download.sources.is_empty() && target.download.resolver.is_none() {
                return Err(format!("插件 {} 的 {} 没有可用下载源", self.id, platform));
            }
        }

        // 安全红线：只有内置清单可以用动态解析器 / 省略 sha256
        if self.origin != Origin::Builtin {
            for (platform, target) in &self.targets {
                if target.download.resolver.is_some() {
                    return Err(format!(
                        "第三方插件 {} 不允许使用内置解析器（无法校验 sha256）",
                        self.id
                    ));
                }
                match &target.download.sha256 {
                    Some(h) if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()) => {}
                    _ => {
                        return Err(format!(
                            "第三方插件 {} 的 {} 必须提供合法的 sha256 校验和",
                            self.id, platform
                        ))
                    }
                }
            }
        }

        // 必须声明一种调用方式，否则装了也没法用
        if self.exec.is_none() && self.service.is_none() {
            return Err(format!("插件 {} 必须声明 exec 或 service", self.id));
        }

        if let Some(exec) = &self.exec {
            if exec.args.is_empty() && exec.actions.is_empty() {
                return Err(format!("插件 {} 的 exec 必须声明 args 或 actions", self.id));
            }
            if let Some(re) = &exec.progress_regex {
                self.check_regex(re)?;
            }
            let mut ids = std::collections::HashSet::new();
            for action in &exec.actions {
                self.check_action(action)?;
                if !ids.insert(&action.id) {
                    return Err(format!("插件 {} 的动作 id 重复: {}", self.id, action.id));
                }
            }
        }

        Ok(())
    }

    fn check_regex(&self, re: &str) -> Result<(), String> {
        regex::Regex::new(re)
            .map(|_| ())
            .map_err(|e| format!("插件 {} 的进度正则非法: {}", self.id, e))
    }

    fn check_action(&self, action: &ActionSpec) -> Result<(), String> {
        if action.id.is_empty() || action.name.is_empty() {
            return Err(format!("插件 {} 的动作缺少 id 或 name", self.id));
        }
        if action.args.is_empty() {
            return Err(format!("插件 {} 的动作 {} 没有参数", self.id, action.id));
        }
        // 加工记录里用 `target_format` 字段存动作 id（转换任务存的是目标格式），
        // 两者重名的话就再也分不清「这是转出来的 PDF」还是「这是某动作的产物」
        if self.outputs.iter().any(|o| o == &action.id) {
            return Err(format!(
                "插件 {} 的动作 id 不能与输出格式重名: {}",
                self.id, action.id
            ));
        }
        // entry 覆盖同样不得逃逸出插件目录
        if let Some(entry) = &action.entry {
            if entry.is_empty() || entry.contains("..") {
                return Err(format!(
                    "插件 {} 的动作 {} 的 entry 非法",
                    self.id, action.id
                ));
            }
        }
        // 后缀与扩展名都会拼进产物文件名——放任路径分隔符就等于让清单决定往哪写文件
        if action.output_suffix.contains(['/', '\\', ':']) || action.output_suffix.contains("..") {
            return Err(format!(
                "插件 {} 的动作 {} 的 output_suffix 含非法字符",
                self.id, action.id
            ));
        }
        if let Some(ext) = &action.output_ext {
            if ext.is_empty() || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err(format!(
                    "插件 {} 的动作 {} 的 output_ext 非法: {}",
                    self.id, action.id, ext
                ));
            }
        }
        if let Some(re) = &action.progress_regex {
            self.check_regex(re)?;
        }
        Ok(())
    }
}

pub fn current_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    return "windows";
    #[cfg(target_os = "macos")]
    return "macos";
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    return "linux";
}

/// 解析一份 registry JSON，校验每个插件并打上来源标记
pub fn parse_registry(json: &str, origin: Origin) -> Result<Vec<PluginManifest>, String> {
    let registry: Registry =
        serde_json::from_str(json).map_err(|e| format!("清单格式错误: {}", e))?;
    if registry.schema_version > SCHEMA_VERSION {
        return Err(format!(
            "清单版本 {} 高于当前支持的 {}，请升级应用",
            registry.schema_version, SCHEMA_VERSION
        ));
    }

    let mut out = Vec::new();
    for mut plugin in registry.plugins {
        plugin.origin = origin;
        plugin.validate()?;
        out.push(plugin);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const THIRD_PARTY: &str = r#"{
        "schema_version": 1,
        "plugins": [{
            "id": "demo",
            "name": "Demo",
            "capability": "convert",
            "targets": {
                "windows": {
                    "download": { "sources": [{"name":"src","url":"https://example.com/a.zip"}] },
                    "install": { "kind": "zip" },
                    "entry": "bin/demo.exe"
                }
            },
            "exec": { "args": ["{input}", "{output}"] }
        }]
    }"#;

    #[test]
    fn third_party_without_sha256_is_rejected() {
        let err = parse_registry(THIRD_PARTY, Origin::Remote).unwrap_err();
        assert!(err.contains("sha256"), "unexpected error: {}", err);
    }

    #[test]
    fn third_party_with_sha256_is_accepted() {
        let json = r#"{
            "schema_version": 1,
            "plugins": [{
                "id": "demo", "name": "Demo", "capability": "convert",
                "targets": { "windows": {
                    "download": {
                        "sources": [{"name":"src","url":"https://example.com/a.zip"}],
                        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    },
                    "install": { "kind": "zip" },
                    "entry": "bin/demo.exe"
                }},
                "exec": { "args": ["{input}", "{output}"] }
            }]
        }"#;
        assert!(parse_registry(json, Origin::Remote).is_ok());
    }

    #[test]
    fn third_party_resolver_is_rejected() {
        let json = r#"{
            "schema_version": 1,
            "plugins": [{
                "id": "demo", "name": "Demo", "capability": "convert",
                "targets": { "windows": {
                    "download": { "resolver": "calibre-latest", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
                    "install": { "kind": "sfx-exe" },
                    "entry": "x.exe"
                }},
                "exec": { "args": [] }
            }]
        }"#;
        let err = parse_registry(json, Origin::Remote).unwrap_err();
        assert!(err.contains("解析器"), "unexpected error: {}", err);
    }

    #[test]
    fn http_source_is_rejected() {
        let json = THIRD_PARTY.replace("https://example.com/a.zip", "http://example.com/a.zip");
        let err = parse_registry(&json, Origin::Builtin).unwrap_err();
        assert!(err.contains("https"), "unexpected error: {}", err);
    }

    #[test]
    fn entry_path_traversal_is_rejected() {
        let json = THIRD_PARTY.replace("bin/demo.exe", "../../evil.exe");
        let err = parse_registry(&json, Origin::Builtin).unwrap_err();
        assert!(err.contains("非法路径"), "unexpected error: {}", err);
    }

    #[test]
    fn builtin_may_omit_sha256() {
        assert!(parse_registry(THIRD_PARTY, Origin::Builtin).is_ok());
    }

    /// 带动作的插件（第三方的主要形态）
    fn with_action(action: &str) -> String {
        format!(
            r#"{{
                "schema_version": 1,
                "plugins": [{{
                    "id": "demo", "name": "Demo", "capability": "pdf-tools",
                    "inputs": ["pdf"],
                    "targets": {{ "windows": {{
                        "download": {{ "sources": [{{"name":"src","url":"https://example.com/a.zip"}}] }},
                        "install": {{ "kind": "zip" }},
                        "entry": "bin/demo.exe"
                    }}}},
                    "exec": {{ "actions": [{}] }}
                }}]
            }}"#,
            action
        )
    }

    #[test]
    fn action_only_plugin_is_accepted() {
        let json = with_action(
            r#"{"id":"opt","name":"压缩","args":["opt","{input}","{output}"],"output_suffix":"-瘦身"}"#,
        );
        let plugins = parse_registry(&json, Origin::Builtin).unwrap();
        let exec = plugins[0].exec.as_ref().unwrap();
        assert_eq!(exec.actions.len(), 1);
        // 动作没声明 inputs，应继承插件的
        assert_eq!(exec.actions[0].accepted_inputs(&plugins[0]), ["pdf"]);
    }

    /// output_suffix 会拼进产物文件名——放行路径分隔符等于让清单决定往哪写文件
    #[test]
    fn action_output_suffix_path_traversal_is_rejected() {
        let json = with_action(
            r#"{"id":"evil","name":"x","args":["{input}","{output}"],"output_suffix":"/../../evil"}"#,
        );
        let err = parse_registry(&json, Origin::Builtin).unwrap_err();
        assert!(err.contains("output_suffix"), "unexpected error: {}", err);
    }

    #[test]
    fn action_entry_traversal_is_rejected() {
        let json = with_action(
            r#"{"id":"evil","name":"x","args":["{input}"],"entry":"../../../Windows/System32/cmd.exe"}"#,
        );
        let err = parse_registry(&json, Origin::Builtin).unwrap_err();
        assert!(err.contains("entry"), "unexpected error: {}", err);
    }

    #[test]
    fn exec_without_args_or_actions_is_rejected() {
        let json = THIRD_PARTY.replace(
            r#""exec": { "args": ["{input}", "{output}"] }"#,
            r#""exec": {}"#,
        );
        let err = parse_registry(&json, Origin::Builtin).unwrap_err();
        assert!(err.contains("args 或 actions"), "unexpected error: {}", err);
    }

    #[test]
    fn duplicate_action_ids_are_rejected() {
        let json = with_action(
            r#"{"id":"a","name":"A","args":["{input}"]},{"id":"a","name":"B","args":["{input}"]}"#,
        );
        let err = parse_registry(&json, Origin::Builtin).unwrap_err();
        assert!(err.contains("重复"), "unexpected error: {}", err);
    }
}
