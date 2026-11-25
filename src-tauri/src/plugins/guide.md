# Olib 插件开发指南（给 AI Agent）

> 本文件由 Olib v{{APP_VERSION}} 自动生成，内容随应用内置。文中的路径和内置插件列表来自你正在使用的这台电脑上的 Olib。

Olib 是一款 Windows 电子书桌面应用。它的插件是**声明式**的：一个插件 = 一份 JSON 清单，把一个**现成的命令行工具**包装成书架右键菜单里的功能。下载、换源、sha256 校验、解压、调用、进度显示、卸载都由 Olib 完成——**你不需要写代码，也不需要编译**。

你的工作分四步：**找工具 → 筛选 → 实测 → 写清单**。每一步都要实际执行命令验证，**不要凭文档或记忆推测**参数、路径和下载地址。

## 本机关键位置

| 用途 | 路径 |
| --- | --- |
| 本地插件源目录（把你写的清单 JSON 放这里） | `{{REGISTRIES_DIR}}` |
| 插件安装目录（插件装好后在其下的 `<id>` 子目录） | `{{PLUGINS_ROOT}}` |

清单放进本地插件源目录后，用户在 Olib「插件」页点「刷新」即可看到你的插件，点「安装」完成下载与校验，然后在「书架」页右键对应格式的文件就能使用。

## Olib 已内置的插件（不要重复做）

{{BUILTIN_PLUGINS}}

如果需求已被覆盖，直接告诉用户用哪个插件、在哪里操作即可。

---

## 第一步：寻找候选工具

按下面顺序找，每个来源都记下 2–3 个候选，再进入筛选：

1. **Scoop 软件仓库（最推荐）**。Scoop 是 Windows 的便携软件包管理器，它的清单直接记录了「便携版 zip 的固定下载地址 + sha256」，正好是 Olib 需要的。
   - 搜索：打开 `https://scoop.sh/#/apps?q=<英文关键词>`，或在 GitHub 仓库 `ScoopInstaller/Main`、`ScoopInstaller/Extras` 的 `bucket/` 目录里搜索。
   - 读清单：`https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/<名字>.json`（Extras 同理）。关注 `version`、`architecture.64bit.url`（或顶层 `url`）、`hash`、`extract_dir`、`bin`。
   - 注意：URL 末尾若有 `#/xxx` 是 Scoop 的重命名标记，要去掉；`hash` 仍需你下载后亲自复算核对。
2. **GitHub 搜索**。用英文关键词并带上 cli / command line：
   - `https://github.com/search?q=<关键词>+cli&type=repositories&s=stars`
   - 关键词示例：「pdf to docx cli」「epub compress command line」「cbz optimize cli」「pdf page numbers command line」。
   - 优先 star 多、最近一年内有发布的项目。
3. **查看发布文件**。确定候选项目后，用 GitHub API 列出最新版的下载文件：
   - `https://api.github.com/repos/<owner>/<repo>/releases/latest`，看 `assets` 里每个文件的 `name`、`size`、`browser_download_url`。
   - 指定版本：`https://api.github.com/repos/<owner>/<repo>/releases/tags/<tag>`。
   - 文件名挑选：含 `windows` / `win64` / `x86_64` / `x64` / `msvc` / `mingw64` / `portable`，扩展名 `.zip`（或可静默解压的自解压 `.exe`）。
   - 排除：`.msi`、`setup.exe` / `installer` 安装向导、`arm64`、只有 32 位（有 64 位时）、源码包。
   - 项目若提供 `.sha256` / `checksums.txt`，下载后用它交叉核对。
4. **官方网站的 Download / Portable 页面**——只在前三步找不到时使用，下载地址必须是固定版本、https。

## 第二步：筛选（必须全部满足，否则淘汰）

- **能用「一个输入文件 → 一个输出文件」的命令完成**，即参数里能写出 `{input}` 和 `{output}`。以下情况淘汰：
  - 只能从标准输入读、或只能输出到标准输出；
  - 只能指定输出**目录**、产物文件名由工具自己决定（除非有参数能指定输出文件名）；
  - 需要交互确认、弹窗，或只有图形界面。
- **Windows x64 便携包**：zip（或可静默解压的自解压 exe），解压即用。单个裸 exe、msi、安装向导**目前都不支持**。
- **不依赖额外运行时**：不能要求用户另装 Python、Java、.NET、Node.js、Visual C++ 运行库等（随包自带的除外）。
- **完全离线**：处理过程不联网、不上传文件。
- **开源且 license 明确**；体积以几十 MB 内为佳，超过 200 MB 先征求用户同意。
- 不涉及去除 DRM 等版权风险功能。

## 第三步：实测（Windows PowerShell，逐条执行并记录结果）

1. 新建一个空的工作目录，下载安装包并计算 sha256（取小写）：

   ```powershell
   Invoke-WebRequest "<下载地址>" -OutFile pkg.zip -UseBasicParsing
   (Get-FileHash pkg.zip -Algorithm SHA256).Hash.ToLower()
   (Get-Item pkg.zip).Length   # 用于填写 min_bytes（取实际体积的约 70%）
   ```

2. 解压到**另一个**空目录，找到主程序，记录它相对解压目录的路径——**包括压缩包自带的顶层目录**：

   ```powershell
   Expand-Archive pkg.zip x
   Get-ChildItem x -Recurse -Filter *.exe | ForEach-Object { $_.FullName }
   ```

   清单里的 `entry` 用 `/` 分隔，例如 `qpdf-12.4.2-msvc64/bin/qpdf.exe`。

3. 运行 `<exe> --help`（或 `-h`、`/?`）确认参数写法。
4. 准备真实格式的样本文件，**放在含中文和空格的路径下**（Olib 用户的书名多为中文），例如 `D:\测试 目录\样例 书.pdf`。
5. **切换到与工具无关的其他目录**再运行完整命令（Olib 调用时不保证工作目录），然后检查：

   ```powershell
   & "<exe 绝对路径>" <参数，用样本路径代替 {input}，用输出路径代替 {output}>
   $LASTEXITCODE          # 必须是 0
   Test-Path "<输出路径>"  # 必须是 True，并打开确认内容正确
   ```

6. 若成功时退出码也不是 0（例如 qpdf 有警告时返回 3），找让它返回 0 的参数（qpdf 是 `--warning-exit-0`）；找不到就换工具。
7. 若工具会在标准输出打印百分比进度，可写 `progress_regex` 并用真实输出验证匹配。

## 第四步：写清单并交付

1. 按下方「清单格式」写 registry JSON，逐条对照「字段规则」自查。
2. 保存为 `{{REGISTRIES_DIR}}\<插件 id>.json`（目录不存在就创建，文件用 UTF-8 编码）。
3. 告诉用户：去 Olib「插件」页点「刷新」→ 找到你的插件点「安装」→ 到「书架」右键对应文件使用。
4. 给用户一份测试报告：工具名、版本、license、下载地址、sha256、你实际运行的命令和结果（退出码、产物大小）、已知限制（如只支持 UTF-8 文本、扫描版无效等）。
5. 如需分享给别人：把 JSON 放到任意 https 地址（如 GitHub Gist 的 Raw 链接），对方在「插件」页点「添加插件源」填入该地址。

**如果找不到满足条件的工具，直接说明原因和替代方案，不要写一份装上了也用不了的清单。**

---

## 清单格式（schema_version 1）

一个文件就是一个「插件源」，可以包含多个插件：

```json
{
  "schema_version": 1,
  "plugins": [
    {
      "id": "pdf-pagenum",
      "name": "PDF 页码工具",
      "description": "一句话说明插件能做什么，显示在插件页。",
      "capability": "pdf-tools",
      "publisher": "工具作者",
      "homepage": "https://github.com/author/tool",
      "license": "MIT",
      "inputs": ["pdf"],
      "outputs": ["pdf"],
      "targets": {
        "windows": {
          "download": {
            "sources": [
              {
                "name": "GitHub",
                "url": "https://github.com/author/tool/releases/download/v1.2.0/tool-win64.zip"
              }
            ],
            "sha256": "<64 位小写十六进制>",
            "min_bytes": 1048576
          },
          "install": { "kind": "zip" },
          "entry": "tool-win64/tool.exe"
        }
      },
      "exec": {
        "actions": [
          {
            "id": "add-page-numbers",
            "name": "添加页码",
            "description": "鼠标悬停时显示的说明。",
            "args": ["stamp", "--page-numbers", "{input}", "{output}"],
            "output_suffix": "-页码"
          }
        ]
      }
    }
  ]
}
```

（以上工具和参数只是格式示意，实际以你实测的为准。）

## 字段说明

### 插件顶层

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 唯一标识，也是安装目录名。只允许字母、数字、`-`、`_`。不要与内置插件重名（重名时内置优先，你的插件会被忽略） |
| `name` | ✅ | 插件页显示的名字 |
| `description` | — | 插件页显示的说明，写清能做什么、有什么限制 |
| `capability` | ✅ | 能力分类的简短英文标识，如 `pdf-tools`、`doc-convert`、`text-tools`、`comic-tools`。`convert`、`ocr` 接入的是 Olib 内置的专用功能（「转换格式」「OCR 识别」），只提供右键动作的插件不要用 |
| `inputs` / `outputs` | — | 支持的输入/输出扩展名（小写、不带点）。`inputs` 决定书架右键菜单对哪些文件显示该插件的动作 |
| `publisher` / `homepage` / `license` | — | 展示用，建议填写 |
| `targets` | ✅ | 按平台分的安装配置，键为 `windows` / `macos` / `linux`。只写实际支持并测试过的平台 |
| `exec` | ✅ | 调用方式，见下文 |

### `targets.<平台>.download`

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `sources` | ✅ | 下载源数组 `[{ "name": "...", "url": "..." }]`，按顺序尝试。**必须是 https**，必须是固定版本的地址（不能用 latest 这类会变的链接）。Olib 会自动在最前面加一个国内加速源 |
| `sha256` | ✅ | 安装包的 sha256（64 位十六进制）。**第三方插件强制要求**，安装前逐字节校验，不符即删除并拒绝安装 |
| `min_bytes` | — | 安装包合理体积下限，用于识破「下载到错误页」这类假成功 |

### `targets.<平台>.install`

| 字段 | 说明 |
| --- | --- |
| `kind` | `"zip"`：解压到安装目录。`"sfx-exe"`：运行自解压 exe，把文件静默解压到安装目录 |
| `args` | 仅 `sfx-exe` 用，参数模板，`{dir}` 替换为安装目录。7-Zip 自解压包通常是 `["-o{dir}", "-y"]`，务必实测能静默解压、不弹窗 |
| `max_path_len` | 可选。安装路径长度上限——有的安装器路径过长会静默失败，声明后 Olib 会提前拦截 |

### `targets.<平台>.entry`

解压后主可执行文件的**相对路径**（用 `/` 分隔）。很多压缩包自带一层顶层目录，要写完整。不得包含 `..`。Olib 以「entry 是否真实存在」判定安装成败，不信任安装器的退出码。

### `exec`：一次性命令行调用

| 字段 | 说明 |
| --- | --- |
| `actions` | 一键动作数组，**每个动作直接出现在书架右键菜单**，是第三方插件的主要扩展点 |
| `args` | 参数模板，供 `capability: "convert"` 这类「目标格式由用户在对话框里选择」的内置能力使用。第三方插件请用 `actions` |
| `progress_regex` | 可选。从标准输出逐行匹配进度的正则，**第 1 个捕获组**须为 0–100 的整数。不提供则任务只有「运行中 / 完成」两态 |

`args` 与 `actions` 至少要有一个。

### 动作（`exec.actions[]`）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 插件内唯一，且不能与 `outputs` 里的任何格式同名 |
| `name` | ✅ | 右键菜单显示的名字，如「添加页码」 |
| `description` | — | 鼠标悬停时的说明 |
| `args` | ✅ | 参数模板，占位符见下文 |
| `inputs` | — | 该动作接受的扩展名（小写、不带点），不填则继承插件的 `inputs` |
| `entry` | — | 同一安装包里的另一个可执行文件（相对路径，不得含 `..`），不填用插件的主 `entry` |
| `output_ext` | — | 产物扩展名（仅字母数字），不填则与输入相同 |
| `output_suffix` | 视情况 | 产物文件名后缀，如 `"-页码"` → `书名-页码.pdf`。**产物与输入同格式时必须填写**。不得含 `/`、`\`、`:`、`..` |
| `progress_regex` | — | 该动作专用的进度正则，不填则用 `exec.progress_regex` |

## Olib 如何调用插件

等价于在命令行执行：

```
<安装目录>\<id>\<entry> <展开后的 args>
```

- 占位符只有两个：`{input}` 是用户在书架上右键的那个文件的绝对路径，`{output}` 是 Olib 生成的产物绝对路径（与输入同目录，按 `output_suffix` / `output_ext` 命名，重名时自动加序号）。
- **工作目录不固定**。工具的配置文件、数据文件需能被它自行找到（例如 OpenCC 的 `-c s2t.json` 会在它自己的 share 目录里查找）。
- 不弹出控制台窗口；标准输出用于解析进度，标准错误在失败时取末尾几行展示给用户。
- **成败判定：退出码为 0 且产物文件真的生成**才算成功。成功后产物出现在书架上，并带「已××」标记。

## 安全规则（不满足会导致整个插件源被拒绝加载）

1. 第三方插件**必须提供 `sha256`**，Olib 安装前逐字节校验，不匹配就删除并拒绝安装。
2. 所有下载源**必须是 https**。
3. `entry`（含动作的 `entry`）不得包含 `..`；zip 解压时会拒绝任何逃逸出安装目录的条目。
4. `output_suffix` 不得含路径分隔符；`output_ext` 只能是字母数字。
5. Olib **不执行插件包里的任何脚本**，只调用清单声明的 `entry`。
6. 第三方插件不能使用 `resolver`（动态获取最新版）：动态地址无法预知 sha256，也就无法校验。请锁定具体版本，发布新版时更新清单即可。
7. 第三方插件请只用 `exec`。`service`（常驻 HTTP 服务）需要 Olib 内置对应的处理逻辑，第三方声明了也无法工作。
8. 插件 id 与内置插件冲突时内置优先，第三方不能顶替官方插件。

## 排查问题

- **点「刷新」后插件页没有出现你的插件**：清单没通过校验，整个文件会被跳过。逐条核对「安全规则」与「字段说明」，特别是 sha256 长度、https、id 字符、动作 id 与 `outputs` 重名、同格式动作缺 `output_suffix`。
- **安装失败「校验和不匹配」**：sha256 写错，或下载地址指向了会变化的文件。
- **安装失败「安装完成但未找到 …」**：`entry` 路径不对，通常是漏了压缩包的顶层目录。
- **右键菜单里没有动作**：文件扩展名不在动作（或插件）的 `inputs` 里；扩展名要小写。
- **执行失败**：看 Olib 显示的错误（来自 stderr 末尾）；用第三步的方法在「其他目录 + 中文路径」下复现。

## 完整示例：内置的 qpdf 插件是怎么做出来的

1. 需求「修复打不开的 PDF」→ GitHub 搜索 `pdf repair cli` → 选中 `qpdf/qpdf`（Apache-2.0，持续维护）。
2. 查 `https://api.github.com/repos/qpdf/qpdf/releases/latest` → 选 `qpdf-12.4.2-msvc64.zip`（排除 `.exe` 安装包、32 位、arm64）。
3. 下载、复算 sha256；解压后主程序在 `qpdf-12.4.2-msvc64/bin/qpdf.exe`。
4. 手写一个交叉引用表损坏的 PDF 测试：`qpdf 坏.pdf 好.pdf` 能修好，但退出码为 3（有警告）→ 查 `--help` 找到 `--warning-exit-0` → 再测：退出码 0、产物可正常打开。
5. 产物与输入同为 PDF → 设置 `output_suffix: "-修复"`。

```json
{
  "schema_version": 1,
  "plugins": [
    {
      "id": "qpdf",
      "name": "PDF 修复（qpdf）",
      "description": "修复打不开、显示不全或报错的 PDF。",
      "capability": "pdf-tools",
      "publisher": "Jay Berkenbilt",
      "homepage": "https://qpdf.sourceforge.io",
      "license": "Apache-2.0",
      "inputs": ["pdf"],
      "outputs": ["pdf"],
      "targets": {
        "windows": {
          "download": {
            "sources": [
              {
                "name": "GitHub",
                "url": "https://github.com/qpdf/qpdf/releases/download/v12.4.2/qpdf-12.4.2-msvc64.zip"
              }
            ],
            "sha256": "db87077e683630c1217e0e8f9a20a9749d952ab676e881c3689187763a5de25d",
            "min_bytes": 20971520
          },
          "install": { "kind": "zip" },
          "entry": "qpdf-12.4.2-msvc64/bin/qpdf.exe"
        }
      },
      "exec": {
        "actions": [
          {
            "id": "repair",
            "name": "修复损坏的 PDF",
            "args": ["--warning-exit-0", "{input}", "{output}"],
            "output_suffix": "-修复"
          }
        ]
      }
    }
  ]
}
```

（这是内置插件，所以 id 为 `qpdf` 的第三方清单会被忽略——你自己的插件请换一个 id。）
