# 电子书格式转换

书架页对已下载文件提供本地格式转换。转换引擎（Calibre）不随安装包分发，而是**插件系统**里一个 `capability: "convert"` 的插件——按需下载，不用的用户零负担。

插件系统本身（清单 schema、下载/校验/解压引擎、安全模型、第三方接入）见 **[plugin-development.md](./plugin-development.md)**。本文只讲转换这一层。

## 代码位置

- `src-tauri/src/commands/convert_commands.rs` —— 转换特有逻辑的薄壳（引擎发现顺序、格式白名单、输出路径）
- `src-tauri/plugins.builtin.json` —— Calibre 插件的清单声明
- 通用能力在 `src-tauri/src/plugins/`（installer / runner / manifest / resolvers）

Calibre 的所有「特殊性」现在都是清单里的**声明**，不是 Rust 里的硬编码：路径长度上限、解压后多一层 `Calibre Portable`、stdout 的 `NN%` 进度格式、支持的输入输出格式。

## 引擎发现顺序

1. 设置项 `calibre_path`（用户手动指定，可指向自行安装的 Calibre）
2. **已安装的 convert 插件**（默认 `%ProgramData%\Olib\plugins\calibre\`，安装位置可在插件页更改）
3. 系统里自行安装的 Calibre（常见安装位置 + `PATH`）

即用户自己装了完整版 Calibre 会被自动识别，不必再下插件。

> `detect_convert_engine` **即使引擎未安装也返回清单声明的格式列表**——它描述的是「这个能力支持什么」，与是否已安装无关。否则书架右键菜单会因格式列表为空而根本不显示转换入口，用户就无从发现功能、也无从触发安装。

## Tauri commands

| command                                   | 说明                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `detect_convert_engine`                   | 返回 `{ available, path, version, inputs, outputs }`                 |
| `convert_book(input_path, target_format)` | 校验路径在下载目录内 + 目标格式在清单白名单内，提交任务，返回任务 id |
| `get_plugin_tasks`                        | 全部插件任务快照（含已完成/失败），前端轮询用                        |

- 输出文件与输入同目录、同名换后缀，重名自动追加 ` (n)`
- 任务表为内存态（与 `download.rs` 的 `DOWNLOADS` 同模式），重启即清空
- 进度由 `runner` 按清单里的 `progress_regex` 从 stdout 逐行解析
- 传给外部工具的路径会去掉 canonicalize 产生的 `\\?\` 前缀（Calibre 不认），但任务表里的 `input_path` 保留规范化形式（与 `list_files` 一致，前端按它匹配显示进度）
- 结束时 `emit("plugin-task", ...)`，与 `download-status` 同套路

## 前端

- 入口：书架页文件右键「转换格式」（仅对清单声明的 `inputs` 格式显示）
- 弹窗 `src/components/ConvertDialog.tsx`：引擎可用则选目标格式（来自清单 `outputs`）；不可用则引导跳转插件页安装
- 进度：有运行中任务时每秒轮询 `get_plugin_tasks`，文件行内显示「转换为 XXX NN%」徽标
- 插件的安装/卸载/进度统一在「插件」页（`src/pages/PluginsPage.tsx`）

## 实测结论（2026-07-13，Windows 11）

Calibre 便携安装器 192.5 MB，静默解压约 45 秒，产出 `ebook-convert.exe (calibre 9.11.0)`；`txt → epub`、`epub → mobi` 均转换成功，stdout 进度行（`34% 正在对电子书进行转换...`）与 `progress_regex` 解析逻辑吻合。

### ⚠️ Calibre 便携版的两个坑（已在清单/引擎里处理，改动时勿破坏）

1. **安装路径必须少于 59 个字符**（含安装器自建的 `Calibre Portable` 子目录），否则解压失败。这是插件装在 `%ProgramData%\Olib\plugins\`（短路径）而非 app_data 的原因。清单里用 `max_path_len` 声明，`installer` 会前置拦截；`plugins/mod.rs` 里有单测把这个约束钉死。
2. **失败时安装器退出码仍为 0**。所以通用安装器**不以退出码判定成败**，一律检查清单里的 `entry` 是否真实存在。
