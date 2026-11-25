# AI 寻书（BYOK）

AI 寻书（阅读锦囊）由用户自带 API Key，本机直连 OpenAI 兼容接口，不再经过 olibai 服务端，也不再需要微信登录、不受服务端配额限制。微信登录仍用于意见反馈与社群专线（`prescriber_commands`）。

## 模块

| 位置                                      | 职责                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `src-tauri/src/ai_finder/mod.rs`          | 配置类型、地址规范化、校验                                                 |
| `src-tauri/src/ai_finder/store.rs`        | SQLite 单行表 `ai_settings`（含 Key）                                      |
| `src-tauri/src/ai_finder/prompt.rs`       | prompt、JSON 提取（兼容代码块 / `<think>`）、结果校验，移植自 olibai       |
| `src-tauri/src/ai_finder/client.rs`       | `POST /chat/completions`、`GET /models`、错误翻译、解析失败重试 2 次       |
| `src-tauri/src/commands/ai_commands.rs`   | Tauri 命令                                                                 |
| `src/api/aiProviders.ts`                  | 内置服务商预设（地址 + 注册链接）                                          |
| `src/pages/SearchPage/AiConfigDialog.tsx` | AI 模式齿轮按钮打开的配置弹窗（服务商 / Key / 模型 + 推荐数量 / 补充要求） |
| `src/pages/SearchPage/usePrescriber.ts`   | 寻书请求；未配置时弹出配置弹窗，保存后自动继续该次寻书                     |

## 命令

| 命令               | 参数                     | 返回                 | 说明                                |
| ------------------ | ------------------------ | -------------------- | ----------------------------------- |
| `get_ai_settings`  | —                        | `AiSettings \| null` | 不回传 Key，只返回 `has_key`        |
| `save_ai_settings` | `input: AiSettingsInput` | `AiSettings`         | `api_key` 为空沿用已保存的          |
| `test_ai_settings` | —                        | —                    | 发一条极短请求验证地址 / Key / 模型 |
| `list_ai_models`   | `baseUrl`, `apiKey?`     | `string[]`           | `apiKey` 为空用已保存的 Key         |
| `ai_find_books`    | `input`, `inputType?`    | `ReadingBag`         | 未配置 reject `NEED_AI_CONFIG`      |

## 服务商预设

地址见 `src/api/aiProviders.ts`（2026-11 对照官方文档核实）：硅基流动、阿里百炼、智谱（均为推广链接；智谱用按量计费接口，GLM Coding Plan 条款禁止在第三方应用中调用其额度），以及官方入口 DeepSeek、OpenAI；其余服务商（火山方舟、腾讯 Token Plan、本地 Ollama 等）走「自定义」。顺序即展示顺序，首项默认选中。

- **模型名不写死**：各家模型迭代快（如 DeepSeek 的 `deepseek-chat` 已于 2026-07 弃用），设置页通过 `/models` 拉取；腾讯 Token Plan、火山方舟可能不提供 `/models`，需手填。
- **推广链接**：只替换各预设的 `signupUrl` 字段。

## 寻书偏好

- **推荐数量** `tip_count`：前端档位 3 / 5 / 8，后端夹在 1–10（过多易使回复超长被截断）。
- **补充要求** `extra_prompt`：≤ 300 字，以「用户的补充要求（在不违反以上格式的前提下遵守）」追加在内置 prompt 的格式要求之后；不开放整段 prompt 覆写，避免破坏 JSON 输出约定。
- 两项与连接配置同存 `ai_settings`；早期开发版建的表缺这两列，`store::migrate` 启动时按需 `ALTER TABLE` 补齐。

## 约定

- 调用参数：temperature 0.8（沿用原服务端）、输出上限 4096 token（最多 10 本 + 推理模型思考开销）、只用中文 prompt。推理模型（如 OpenAI o 系列）返回 400 指出 `max_tokens` / `temperature` 不支持时，自动改用 `max_completion_tokens`、不传 temperature 重试一次。
- 「测试」只看请求是否成功，不要求返回内容（推理模型在极小额度下可能返回空内容）。
- Key 存 SQLite，不写日志、不回传前端；请求从本机直连服务商。
- olibai 的 `POST /api/prescribe` 及 AI 配额逻辑客户端已不再调用（服务端是否下线由 olib-server 决定）。
