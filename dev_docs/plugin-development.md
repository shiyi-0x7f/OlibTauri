# 插件系统（内部实现说明）

> **面向插件作者 / AI Agent 的完整开发规范已内置到应用里**：`src-tauri/src/plugins/guide.md`（编译进二进制）。
> 用户打开「插件」页时，应用把它渲染（填入本机路径与内置插件列表）后写到 `%APPDATA%\com.shiyi0x7f.olibfluent\plugin-dev-guide.md`，本机的 AI Agent 直接读取该文件。
> 清单格式、字段、校验规则、调用契约都以 guide.md 为准，本文只记录应用内部的实现约定，不再重复规范。

## 模块分工（`src-tauri/src/plugins/`）

| 模块                    | 职责                                        |
| ----------------------- | ------------------------------------------- |
| `manifest.rs`           | 清单 schema 与安全校验（信任边界）          |
| `installer.rs`          | 通用下载 / 换源 / sha256 校验 / 解压 / 卸载 |
| `runner.rs`             | 按 `exec` 契约调用插件、解析进度、判定成败  |
| `service.rs`            | 常驻服务型插件（Umi-OCR）的拉起与退出       |
| `resolvers.rs`          | 「取最新版」动态解析器，仅内置清单可用      |
| `location.rs`           | 安装根目录（默认 / 用户自定义）与迁移       |
| `usage.rs`              | 已装插件的磁盘占用统计                      |
| `guide.rs` + `guide.md` | 内置插件开发指南的渲染与导出                |

内置清单：`src-tauri/plugins.builtin.json`。

## 维护约定

- **改了 `manifest.rs` 的校验规则或 `runner.rs` 的成败判定，必须同步 `guide.md`**，否则 Agent 按指南写出的清单会被拒绝加载或装上了用不了。
- guide.md 的内置插件表由 `guide.rs` 从内置清单自动生成，新增内置插件无需改 guide.md。
- 成败判定：`runner.rs` 要求**退出码为 0 且产物文件存在**。成功时也返回非 0 的工具须在参数里纠正（如 qpdf 的 `--warning-exit-0`，有单测钉住）。
- 调用时只有 `{input}` / `{output}` 两个占位符，不设置工作目录。
- `service` 型与 `resolver` 只对内置清单有意义：前者需要应用内实现对应 capability 的处理器，后者无法预知 sha256（第三方被 `manifest.rs` 拒绝）。

## 插件源加载

- 启动时加载内置清单 + `app_data/registries/*.json`；单个源解析失败只跳过该源。
- 「插件」页「刷新」调用 `reload_plugin_registries` 重新扫描，Agent 新放入的清单无需重启。
- 「添加插件源」订阅远程 https 地址：拉取 → 按第三方规则校验 → 落盘到 `registries/` → 重新加载。
- id 冲突时内置优先。

## 插件装在哪

默认：

- Windows：`%ProgramData%\Olib\plugins\<id>\`
- macOS / Linux：`~/.olib/plugins/<id>/`

刻意选了短路径——某些安装器对路径长度有硬限制（Calibre 便携版，见 `format-conversion.md`）。卸载 = 删除该目录，不写注册表、不留残留。

用户可在「插件」页顶部更改安装位置（配置项 `plugins_dir`，空 = 默认），实现见 `location.rs`：

- 改位置时把**已知插件 id** 的子目录迁到新位置（同盘改名、跨盘复制后删除）；中途失败会回滚已迁的。旧目录里的其他内容不动。
- 迁移前停掉应用拉起的常驻服务；有插件在安装或有插件任务在跑时拒绝迁移。
- 新位置已有同名子目录时不覆盖，保留新位置的那份，旧目录原样留下。
- 清单声明了 `max_path_len` 的插件在新位置超长时，页面会提示「将无法在这里安装」（不阻止更改）。
- `plugins_dir` 只能经 `set_plugins_location` 修改，通用的 `set_config` 会忽略前端传来的值。

## 收录到内置清单

收录条件：开源、可离线运行、不上传用户文件、license 明确、锁定版本并带 sha256。新增前按 guide.md 的「实测」步骤在中文路径 + 非工具目录下验证过命令。
