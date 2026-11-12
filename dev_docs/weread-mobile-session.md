# 微信读书：扫码会话与功能移植（桌面端）

> 2026-10-03 立项。来源：olib-mobile v1.4.0 已把微信读书从 API Key 网关切到「扫码会话 + 移动端接口直连」，桌面端跟进移植。
> 接口来源与逆向依据见 `refs/weread-omni.md`；推荐模块的问题分析与设计见 `weread-recommend.md`。

## 定位与边界

Olib 是找书、管理本地书、利用阅读数据的入口，阅读行为留在微信读书。**不做**：正文阅读器、付费内容 / `paidContent`、正文抓取、公众号与文章（搜索 / 订阅 / Feed 均不做）、书架维护型操作（置顶 / 私密 / 标记读完 / 划线增删改 / 点评发表）。

## 已定决策（2026-10-03）

| 事项              | 结论                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 会话存储          | **明文落盘**，不加密、不新增依赖。存 `app_data_dir/weread_session.json`，**不进 `config.json`**（`get_config` 会把整个配置下发前端，令牌不应出现在前端）                                |
| 旧 API Key 网关   | **直接移除**：删 `OpenWeRead` 网关客户端、`weread_api_key` 配置字段与设置页输入框。旧 `config.json` 中残留字段被 serde 忽略，下次保存配置时自然消失；未连接态文案提示「已改为扫码连接」 |
| 海报导出（P5）    | ~~新增前端依赖 `html-to-image`~~ —— P5 已放弃（2026-10-07），未引入                                                                                                                     |
| 导入签名（P4）    | 新增后端依赖 `sha1` + `hmac`（RustCrypto，与 `sha2` 同属 digest 0.10），用于 COS 请求签名（2026-10-07 同意）                                                                            |
| 移动端推荐缺陷    | 本仓库不改移动端代码，需求写入 `olib-mobile/dev_docs/req_OlibTauri.md`                                                                                                                  |
| AI 回答渲染（P3） | 新增前端依赖 `react-markdown` + `remark-gfm`，默认不渲染原始 HTML；样式集中在 `src/styles/weread-ai.css`                                                                                |

## 分阶段实施

每阶段独立 feature 分支、独立合入。

| 阶段 | 分支                         | 内容                                                                                                                                   | 状态                           |
| ---- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| P0   | —                            | 验证 `/book/recommend` 是否真支持 `count`/`maxIdx`（方法见 `weread-recommend.md`）                                                     | 完成：接口弃用，见推荐文档     |
| P1   | `feat/weread-qr-login`       | 扫码会话、令牌刷新、既有 8 个命令迁移到移动端接口、删网关；扫码倒计时                                                                  | 完成（2026-10-03 实测）        |
| P2   | `feat/weread-recommend`      | 推荐池（仅种子相似）、微信读书页「为你推荐 / 换一批」、详情弹窗相似书                                                                  | 完成（2026-10-03 实测）        |
| P3   | `feat/weread-ask-book`       | 详情弹窗 AI 问书：工具栏快捷提问、建议问题、自由提问、划线「问 AI」、逐帧回显、思考过程、可取消、可复制                                | 完成（已合入）                 |
| P4   | `feat/weread-import`         | 书架右键「导入到微信读书」+ 微信读书页「导入本机书」；EPUB/PDF/MOBI/TXT/AZW3，≤200 MiB；COS 直传 + `/cos/notify`；结果不确定不自动重试 | 已实现，EPUB/PDF/MOBI 实测通过 |
| P5   | `feat/weread-reading-report` | 周 / 月 / 年 3:4 海报，两套主题，导出 PNG；缺失字段隐藏模块，默认不展示书名与账号                                                      | **放弃**（2026-10-07 定）      |
| P6   | `feat/search-history`        | 搜索页最近搜索记录（独立小功能）                                                                                                       | 待开始                         |

多源统一搜索（Z 站 + 微信读书）涉及搜索页展示模型重构，P1–P5 稳定后再单独评估。

## 会话与客户端设计（P1）

### 模块结构

`src-tauri/src/weread/`（替换原单文件 `weread.rs`）：

| 文件          | 职责                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `mod.rs`      | 对外导出、`init(app_data_dir)`                                                                                       |
| `session.rs`  | 会话结构、`weread_session.json` 读写、进程内缓存                                                                     |
| `client.rs`   | 统一请求：版本头 + `vid`/`accessToken`、错误码解析、401 / `-2012` 时刷新令牌（并发只刷一次）后重放 GET 与可重放 POST |
| `qr_login.rs` | `/wxticket` → 微信 `qrconnect` 取 uuid → 本地生成二维码 → 长轮询 → `/login` 换令牌                                   |
| `api.rs`      | 书架、统计、笔记本、书籍信息、章节、划线、我的想法、热门划线                                                         |

### 请求约定

- 基址 `https://i.weread.qq.com`，伪装 Eink 2.1.2 客户端（`appver`/`basever` `2.1.2.10245900`、`baseapi 30`、`channelId 900`、Onyx UA），与移动端一致。
- 登录 / 刷新签名：`sha256_hex("{timestamp_ms}{deviceId}{random}")`；`deviceId = "eink334691225" + 19 位随机数字`，`installId = "eink31" + 26 位随机数字`，`deviceName = BOOX`，`deviceType = 3`。
- 业务错误：响应体 `errCode`/`errcode` 非 0 即失败；`-2012` 或 HTTP 401 视为令牌过期。刷新失败提示「微信读书会话已失效，请重新扫码连接」。
- 日志不输出令牌与 `vid`。

### 扫码流程

二维码内容是 `https://open.weixin.qq.com/connect/confirm?uuid=…`，微信要求**用另一块屏幕展示、手机微信「扫一扫」识别**——桌面端正好满足（移动端的最大痛点在桌面不存在）。

**只能用手机摄像头实时扫码**（2026-10-03 实测）：电脑微信「识别图中二维码」、手机相册识别、同机打开确认链接均无法完成授权。因此不做「唤起电脑微信确认」（本机虽已注册 `weixin://` 协议，可唤起但无法授权）。

| 轮询 `wx_errcode` | 含义                                         | 前端状态            |
| ----------------- | -------------------------------------------- | ------------------- |
| 408               | 等待扫码                                     | `waiting`           |
| 404               | 已扫码，待手机确认                           | `scanned`           |
| 405               | 已确认（带 `wx_code`，后端立即换令牌并落盘） | `confirmed`         |
| 402               | 二维码过期                                   | `expired`（可刷新） |
| 403               | 手机端拒绝                                   | `declined`          |

前端循环调用 `weread_qr_poll`（单次长轮询，后端超时 70s），对话框关闭即停止。

### 命令

| 命令                                                                                                                                              | 说明                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `weread_status`                                                                                                                                   | `{ connected, vid }`                                  |
| `weread_qr_start`                                                                                                                                 | `{ uuid, qr_image }`（`data:image/svg+xml;base64,…`） |
| `weread_qr_poll(uuid, last?)`                                                                                                                     | `{ status, last }`；`confirmed` 时已完成登录          |
| `weread_disconnect`                                                                                                                               | 删除本地会话                                          |
| `weread_get_stats` / `get_shelf` / `get_notebooks` / `get_book_info` / `get_chapters` / `get_bookmarks` / `get_my_reviews` / `get_best_bookmarks` | 名称不变，底层换为移动端接口，前端零改动              |

接口映射（网关 → 移动端）：

| 命令           | 移动端接口                                                                 | 备注                                                                             |
| -------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| stats          | `GET /readdata/detail?mode=overall`                                        | 不传 mode 会 499                                                                 |
| shelf          | `GET /shelf/sync`                                                          |                                                                                  |
| notebooks      | `GET /user/notebooks?count=100[&lastSort]`                                 | 服务端可能忽略游标返回全量快照：按 bookId 去重，**某页无新书即终止**，上限 50 页 |
| book_info      | `GET /book/info?bookId`                                                    |                                                                                  |
| chapters       | `POST /book/chapterInfos`                                                  | 后端归一为 `{ bookId, chapters }`（取 `data[0].updated`）                        |
| bookmarks      | `GET /book/bookmarklist?bookId&synckey=0`                                  |                                                                                  |
| my_reviews     | `GET /review/list?bookId&listType=1&listMode=0&mine=1&synckey=0&count=100` | 条目为 `{ review }` 包装，前端已兼容                                             |
| best_bookmarks | `GET /book/bestbookmarks?bookId&chapterUid=0&count=21&maxIdx=0&synckey=0`  |                                                                                  |

## AI 问书（P3）

### 接口实测（2026-10-03，《理想国：新译与导读》）

| 项                                          | 结论                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /ai/chat/suggest`（默认）             | 返回 3 个 `questions`；`questionHints[].hints` 是内部埋点串（`book_id=…&task_type=14`），**不展示**                                                             |
| `POST /ai/chat/suggest`（`cmd: "toolbar"`） | 返回 `prompts`：全书总结 / 书籍亮点 / 背景解读，`intent` 均为 `weread-toolbar-book-scale`，发问时原样带上                                                       |
| 按章节出题（`chapterUid` + `range`）        | 可用，但题目针对整章而非该段划线                                                                                                                                |
| 划线提问                                    | `weread_opt.query_context` 传原文**无效**（答非所问）；**把原文写进问题**（「……」这句话是什么意思？）答得准确 → 采用后者                                        |
| 多轮追问                                    | **不支持**：带上一轮 `session_id` 追问会原样重放上一轮答案。每次提问独立，界面注明「不记得上文」                                                                |
| 回答格式                                    | `result.text` 为累计快照，Markdown（标题 / 加粗 / 列表）；夹带 `<citation idx='n'></citation>`、开头有空行；`thinking_result.text` 含 `<think>` 标签 → 后端清洗 |
| 轮询                                        | 一般 3 次左右完成；首帧不可重放（无 chatid），续帧可重放                                                                                                        |

### 实现

| 位置                                                             | 说明                                                                                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/weread/ask.rs`                                    | 建议问题与工具栏并发拉取（单边失败不影响另一边）；`start` 立即返回 `askId`，后台轮询并经 `weread-ask` 事件推送 `{ askId, text, thinking, done, error }`；`cancel` 后循环下一轮退出  |
| 命令                                                             | `weread_ai_suggestions(bookId, chapterUid?)`、`weread_ai_ask(bookId, query, intent?)`、`weread_ai_cancel(askId)`                                                                    |
| `src/components/WereadAskPanel.tsx`                              | 详情弹窗「AI 问书」标签：快捷提问、建议问题、输入框（Enter 发送 / Shift+Enter 换行）、停止生成、复制回答、重试；首次打开后保持挂载，切标签不丢对话；关弹窗 / 换书时取消进行中的提问 |
| `src/components/WereadMarkdown.tsx` + `src/styles/weread-ai.css` | Markdown 渲染：荧光笔式加粗、主题色列表标记、引用色条、斑马纹表格、生成中闪烁光标；链接交系统浏览器，不加载远程图片                                                                 |
| 划线「问 AI」                                                    | 详情弹窗「划线」每条右下角按钮，切到 AI 标签并以「解读划线」发问                                                                                                                    |

## 微信读书页（2026-10-03 改版）

布局参考 olib-mobile 首页，按桌面宽屏改为双栏：

| 区块                                   | 组件（`src/pages/WereadPage/`）                           | 数据                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 继续阅读（渐变 Hero + 「也在读」）     | `ContinueReadingCard`                                     | `/shelf/sync` 的 `books`（未读完、非私密、按 `readUpdateTime`）+ `bookProgress`；「去微信读书继续读」用书的 `deepLink` 交系统浏览器  |
| 阅读节奏（今日目标 + 本周 7 天柱状图） | `ReadingRhythmCard`                                       | `weread_read_data("weekly")` 的 `baseTime`（本周一 0 点）与 `readTimes`（日起点 → 秒）；每日目标 10/20/30/60 分钟存本机 localStorage |
| 累计数据（6 格）                       | `StatsStrip`                                              | overall：`totalReadTime`、`readDays`、`readStat`（读过 / 读完 / 笔记）、补齐的 `dayAverageReadTime`                                  |
| 重温划线                               | `HighlightCard`                                           | 最近 3 本有笔记的书的划线（≥8 字），随机展示、换一条                                                                                 |
| 阅读偏好                               | `PreferenceCard`                                          | overall：`preferCategory`（前 5，按时长）、`preferTime`（24 小时分布）、`preferCategoryWord` / `preferTimeWord`；缺字段隐藏          |
| 为你推荐 / 我的书架 / 笔记             | `WereadRecommendSection` / `ShelfRow` / `NotebookSection` | 推荐池；书架按最近阅读横排带进度；笔记卡片网格 + 书名作者筛选 + 导出全部                                                             |

各区块用 `useLoad` 独立加载、独立失败与重试；样式集中在 `src/styles/weread-page.css`，封面统一用 `components/WereadCover`。新增命令 `weread_read_data(mode, baseTime?)`（weekly / monthly / annually / overall）。

## 导入本机书籍（P4）

与 olib-mobile `importBook` 对齐（`weread_mobile_client.dart`）。下载页入口不做：下载的书都在书架页，书架右键已覆盖。

| 步骤     | 接口 / 行为                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 校验     | 扩展名 epub / pdf / mobi / txt / azw3（不区分大小写）；大小 1 B – 200 MiB                                                                                                                                 |
| 取凭据   | `GET /cos/getcredential?name=<不含扩展名的书名>&from=`；校验 `bucket` 仅字母数字与 `-`、`ObjectName` 非空且不以 `//` 开头、不含 `..`、`Response.Credentials` 三项齐全、`Response.ExpiredTime` 未过期      |
| 直传 COS | `PUT https://<bucket>.cos.accelerate.myqcloud.com/<逐段 encodeURIComponent 的 ObjectName>`；头 `Authorization`（COS v5 sha1 签名，仅签 host，有效期 min(1h, 凭据过期)）、`x-cos-security-token`；流式上传 |
| 提交解析 | `POST /cos/notify?name=<完整文件名>&path=<ObjectName>&cancel=0`，体 `{}`，**不可重放**；`status == 1` 且有 `bookId` 仅代表已提交，入架由微信读书异步完成                                                  |

- 上传失败 → 「导入未开始」，可直接重试；上传成功但确认失败 / 未确认 → 提示「先到书架查看，勿直接重试」（可能已入架，重试会重复导入）。
- 正式上传先 PUT 零字节初始化对象并核对 CRC 为 0，再流式上传文件；核对响应 `x-cos-hash-crc64ecma` 与请求流计算值，不一致或缺失时不发送 `/cos/notify`。
- 2026-10-07 实测：同一 EPUB 在真实书名凭据上首次直接 PUT 可返回 HTTP 200，但远端 CRC/ETag 与本地不符，随后 `/cos/notify` 虽返回成功却无法入架；零字节 PUT 后覆盖为 EPUB，CRC 一致，提交后约 10 秒出现在 `/shelf/sync`。因此成功提示只称「已提交解析」，不把 `/cos/notify` 回执视为最终入架。
- 同日追加实测：另一 EPUB（802 KB）、PDF（81 KB）、MOBI（3 MB）均通过上传 CRC 校验并出现在官方 `/shelf/sync`，耗时约 10、20、10 秒。TXT/AZW3 尚未做真实入架验证。
- 进度：`weread-import` 事件 `{ path, sent, total }`，按百分比节流；上传客户端独立（总超时 15 分钟），不沿用请求层 70s。
- 实现：`src-tauri/src/weread/import.rs`（含签名 / 路径编码 / 凭据校验单测）、命令 `weread_import_book(path) → { bookId }`；前端 `src/hooks/useWereadImport.ts`（loading toast 显示进度，同一文件进行中忽略重复触发），入口 `BookshelfPage` 右键菜单（超 200 MB 置灰）与 `WereadPage` 标题栏「导入本机书」（可多选，成功后刷新书架）。

## 风险

- 移动端接口为逆向所得（weread-omni），上游变更即可能失效；伪装版本号是关键假设。
- 项目无真实账号自动化验证，P1 验收以人工扫码为准：扫码登录、重启保持、令牌过期自动刷新、断开、原有统计 / 笔记 / 导出正常。
