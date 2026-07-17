# 插件开发指南

Olib 的插件是**声明式**的：一个插件 = 一份 JSON 清单，声明「从哪下载、怎么校验、怎么解压、可执行文件在哪、怎么调用」。下载、换源、校验、解压、进度解析、卸载全部由 Olib 的通用引擎接管——**你不需要写一行 Rust，也不需要编译任何东西**。

插件本质上是把一个**现成的命令行工具**（Calibre、Tesseract、pdfcpu……）包装成 Olib 里的一个功能。

## 最小示例

```json
{
  "schema_version": 1,
  "plugins": [
    {
      "id": "my-converter",
      "name": "我的转换引擎",
      "description": "一句话说明这个插件能做什么。",
      "capability": "convert",
      "publisher": "Your Name",
      "homepage": "https://github.com/you/your-tool",
      "license": "MIT",
      "inputs": ["pdf", "epub"],
      "outputs": ["epub", "txt"],
      "targets": {
        "windows": {
          "download": {
            "sources": [
              { "name": "GitHub", "url": "https://github.com/you/tool/releases/download/v1.0/tool-win.zip" }
            ],
            "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            "min_bytes": 1048576
          },
          "install": { "kind": "zip" },
          "entry": "tool/bin/tool.exe"
        }
      },
      "exec": {
        "args": ["--input", "{input}", "--output", "{output}"],
        "progress_regex": "^\\s*(\\d{1,3})%"
      }
    }
  ]
}
```

把这份 JSON 放到任意 HTTPS 地址上，用户在「插件」页点「添加插件源」填入该地址即可安装。

## 字段说明

### 顶层

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一标识，也是安装目录名。只允许字母、数字、`-`、`_` |
| `name` / `description` | ✅ / — | 展示在插件页 |
| `capability` | ✅ | 声明提供什么能力，Olib 据此决定在哪露出入口。目前支持 `convert`（书架右键「转换格式」）和 `ocr`（书架右键「OCR 识别」） |
| `inputs` / `outputs` | — | 支持的输入/输出扩展名（小写、不含点）。描述的是**能力**，与是否已安装、用哪种调用方式无关 |
| `publisher` / `homepage` / `license` | — | 展示用，建议填写 |
| `targets` | ✅ | 按平台分的安装配置，键为 `windows` / `macos` / `linux`。只填你支持的平台 |
| `exec` / `service` | 二选一 | 调用方式，见下文 |

> `inputs` 决定书架右键菜单对哪些文件显示入口。它**不依赖插件是否已安装**——否则用户在装之前根本看不到这个功能，也就无从触发安装。

### `targets.<platform>.download`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `sources` | ✅ | 下载源数组，按顺序尝试。**必须是 https**。Olib 会自动在最前面插入国内加速源 |
| `sha256` | ✅ | 安装包的 sha256（小写十六进制）。**第三方插件强制要求**，见下方「安全模型」 |
| `min_bytes` | — | 合理体积下限，用于识破「代理返回错误页」这类假成功 |

### `targets.<platform>.install`

| 字段 | 说明 |
| --- | --- |
| `kind` | `zip`（解压到安装目录）或 `sfx-exe`（自解压 exe，以安装目录为参数运行） |
| `args` | 仅 `sfx-exe` 用，参数模板，`{dir}` 会替换为安装目录 |
| `max_path_len` | 安装路径长度上限。某些安装器路径过长会**静默失败且退出码仍为 0**（Calibre 便携版就是），声明后 Olib 会前置拦截 |

### `targets.<platform>.entry`

解压后可执行文件的**相对路径**。注意有些压缩包会自带一层目录，要写完整，例如 Calibre 是 `Calibre Portable/Calibre/ebook-convert.exe`。不得包含 `..`。

Olib 以「entry 是否真实存在」判定安装成败——**不信任安装器的退出码**。

## 两种调用方式

### `exec` —— 一次性命令行调用（推荐，绝大多数工具都属此类）

| 字段 | 说明 |
| --- | --- |
| `args` | 参数模板，支持占位符 `{input}`（源文件绝对路径）、`{output}`（目标文件绝对路径） |
| `progress_regex` | 从 stdout 逐行提取进度的正则，**第 1 个捕获组**须为 0–100 的整数。不提供则任务只有「运行中/完成」两态 |

Olib 调用插件的方式等价于：

```
<entry> <展开后的 args>
```

进程的 stdout 用于解析进度，stderr 在失败时取末尾几行作为错误信息展示给用户。Olib 以**输出文件是否真的生成**判定成败，不轻信退出码。

### `service` —— 常驻 HTTP 服务

有些工具（如 OCR 引擎 Umi-OCR）不是「一进一出」，而是跑一个本地 HTTP 服务、通过接口提交任务。这类插件声明 `service`，Olib 负责**按需拉起进程、等它就绪、收进托盘、应用退出时关掉**：

| 字段 | 说明 |
| --- | --- |
| `port` | 服务监听端口 |
| `health` | 健康检查路径，GET 返回 2xx 视为就绪 |
| `args` | 启动参数 |
| `post_start_args` | 就绪后立刻执行的参数（如 `["--hide"]` 把 GUI 收进托盘） |
| `quit_args` | 应用退出时优雅关闭服务的参数（如 `["--quit"]`）。**必须提供**，否则服务会变成孤儿进程 |
| `startup_timeout_secs` | 等待就绪的超时秒数，默认 90 |

服务**按需启动**（第一次用到才拉起），之后复用同一进程。

> ⚠️ **service 型插件目前只对内置清单开放。** 因为 HTTP 接口的调用流程（上传/轮询/取结果的路径与字段）因工具而异，无法完全声明化，需要在 Olib 内实现对应 capability 的处理器。第三方插件请用 `exec`——它能覆盖绝大多数命令行工具。如果你的工具只能以服务方式工作，欢迎提 issue 讨论。

## 安全模型

插件安装 = 下载并执行一个外部可执行文件，因此信任边界必须明确。**信任级别取决于清单来源**：

| 来源 | 说明 | `sha256` | 动态解析器 |
| --- | --- | --- | --- |
| 内置（编译进 Olib） | 应用作者背书 | 可选 | 允许 |
| 第三方（用户订阅的 registry） | 不可信 | **强制** | 禁止 |

具体规则：

1. **第三方插件必须提供 `sha256`**，且 Olib 会在解压前逐字节校验；不匹配就删除并拒绝安装。没有 `sha256` 的第三方清单**整个源都会被拒绝加载**。这条不可协商——否则等于给任意远程代码执行开了门。
2. 所有下载源**必须是 HTTPS**。
3. `entry` 不得包含 `..`；zip 解压时会拒绝任何逃逸出安装目录的条目（zip slip 防护）。
4. Olib **不执行插件包里的任何脚本**，只调用清单声明的 `entry`。
5. 插件 id 与内置插件冲突时，内置优先——第三方不能顶替官方插件。

### 为什么第三方不能用「动态解析最新版」

内置的 Calibre 插件用了 `"resolver": "calibre-latest"` 来始终获取最新版。这个能力对第三方关闭，因为动态解析出的 URL 无法预先知道其 sha256，也就无法校验——而校验是第三方插件的安全底线。第三方插件请**锁定具体版本**并给出该版本的 sha256；发布新版本时更新你的 registry JSON 即可。

## 计算 sha256

```bash
# Linux / macOS
shasum -a 256 your-tool-win.zip

# Windows PowerShell
Get-FileHash your-tool-win.zip -Algorithm SHA256
```

## 本地调试

开发期不必每次都发布到远程：把你的 registry JSON 放到 Olib 的 app 数据目录下的 `registries/` 里（文件名任意，扩展名 `.json`），重启应用即可加载。加载失败的原因会打在日志里（坏的源会被跳过，不影响其他插件）。

Windows 上该目录通常是：

```
%APPDATA%\<Olib 的 identifier>\registries\
```

## 插件装在哪

- Windows：`%ProgramData%\Olib\plugins\<id>\`
- macOS / Linux：`~/.olib/plugins/<id>/`

刻意选了短路径——某些安装器对路径长度有硬限制。卸载 = 删除该目录，不写注册表、不留残留。

## 提交到官方插件源

欢迎提 PR 到本仓库的 `src-tauri/plugins.builtin.json`，或维护你自己的 registry 并分享地址。收录到官方源的插件需要：开源、可离线运行、不上传用户文件、有明确的 license。
