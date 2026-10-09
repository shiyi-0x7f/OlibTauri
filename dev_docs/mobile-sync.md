# OlibTauri × olib-mobile 联动方案

> 状态：**阶段 1/2/3 桌面侧全部完成**（LAN 服务端 2026-07-16；书单导出/导入 UI 2026-07-17）。
> 阶段 1/2 已于 2026-07-16 真机联调通过（联调中决定取消 LAN token）；阶段 3 双向待真机验收。
> 移动端见 olib-mobile `feat/lan-transfer` 分支；桌面端 LAN 实现细节见 `lan-server.md`。
> 配套文档：olib-mobile 侧需求见 `olib-mobile/dev_docs/req_OlibTauri.md`

桌面端与移动端联动，覆盖三个场景：**移动端从电脑取书、移动端推书到电脑、书单/收藏互通**。路线为「局域网直连为主、复用双方已有资产、云同步放远期」。

阅读进度**不在本方案范围内**：两端均使用 Z-Library 在线阅读器，登录同一账号时进度天然在 Z-Library 云端同步；只有将来做本地/离线阅读器时才需要进度同步。

## 现状资产

| 能力         | OlibTauri（桌面）                                                                 | olib-mobile（移动）                                                                                |
| ------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| LAN 文件服务 | ✅ axum，:8765，`/api/files`、`/download/{file}`、OPDS 1.2（见 `lan-server.md`）  | ❌ 无                                                                                              |
| 二维码       | ✅ 生成 LAN URL 二维码                                                            | ✅ 生成（qr_flutter）+ 扫描（mobile_scanner）                                                      |
| 书单分享协议 | ✅ `src/utils/booklistCodec.ts`（2026-07-17，对齐移动端格式）+ 收藏页导出/导入 UI | ✅ `olib://booklist` 编解码器（`lib/services/booklist_share_codec.dart`），支持 URI/口令/JSON 文件 |
| LAN 认证     | ❌ 无（裸奔，需补）                                                               | —                                                                                                  |
| 服务发现     | ❌ 无 mDNS                                                                        | ❌ 无                                                                                              |
| 收藏         | SQLite `favorites` 表，元数据完整                                                 | Z-Library 云端（`/eapi/user/book/saved`）                                                          |
| 共同后端     | scc.11xy.cn + olibai.11xy.cn                                                      | scc.11xy.cn + olibai.11xy.cn（鉴权已从 wxauth.11xy.cn 迁移，见 olib-mobile `feat/scc-auth`）       |

关键判断：移动端缺的不是接收能力（导入/落盘/扫码均现成），而是「LAN 客户端」这一小段；桌面端缺的是 booklist 协议实现和写入端点。两边各补半套即打通。

## 阶段 1：移动端从电脑取书（最小可用）

移动端扫描桌面「无线传书」弹窗二维码 → 得到 `http://IP:8765` → 拉文件列表 → 勾选下载。

**桌面改动**（`src-tauri/src/lan_server.rs`）：

新增身份端点，供移动端确认对端是 Olib 桌面端而非普通网页：

```
GET /api/info
→ 200 { "app": "olib-desktop", "version": "<app version>", "device_name": "<hostname>", "capabilities": ["files", "opds"] }
```

二维码内容保持纯 HTTP URL 不变，不破坏浏览器 / KOReader 现有用法。

**移动端改动**：见 `req_OlibTauri.md` 阶段 1。

## 阶段 2：反向传书 + 补认证

**上传端点**（桌面）：

```
POST /api/upload          multipart/form-data，字段 file
→ 201 { "name": "...", "size": 123 }
→ 400 文件名非法 / 扩展名不在白名单
→ 413 超过大小上限
```

- 落盘到 `download_folder`，沿用现有路径穿越校验（拒绝 `..` `/` `\`）
- 扩展名白名单复用 `OPDS_EXTENSIONS`；大小上限默认 500 MB（配置项）
- 同名文件加 ` (n)` 后缀，不覆盖

**认证：不做**（决策变更史：方案原定会话 token 门禁 → 桌面端实现并测试通过 → 2026-07-16 真机联调时**取消**——局域网传书场景 token 无实际意义，徒增复杂度）。保留的防护：文件名路径穿越校验、上传扩展名白名单 + 500 MB 上限。移动端 `lan_client.dart` 的 token 逻辑按可选设计（URL 无 `?token=` 即不带），无需改动，桌面端若日后恢复 token 移动端自动兼容。

`capabilities` 为 `["files", "opds", "upload", "booklist"]`。

## 阶段 3：书单/收藏互通

桌面端实现 `olib://booklist` 协议（移动端已有完整实现，格式为协议基准）：

- 载体：紧凑 URI `olib://booklist?ids=...`；完整 URI `olib://booklist?d=<base64url(gzip(json))>`；JSON 文件 `{"v":1,"name":...,"books":[{id,title,author,hash}]}`
- **桌面 → 移动**：收藏页导出二维码/口令，移动端现有扫码/粘贴导入零改动可用；`favorites` 表字段完整覆盖 `BooklistEntry`
- **移动 → 桌面**：桌面无摄像头，走口令粘贴导入，或 LAN 推送：

```
POST /api/booklist        无 token（LAN 认证已取消，见阶段 2）；要求桌面端已登录（收藏按 user_email 归属）
body: { "v": 1, "name": "...", "books": [{ "id", "title", "author", "hash" }] }
→ 200 { "imported": n, "skipped": m }    // 按 (book_id, user_email) 去重写入 favorites
```

**已实现（2026-07-17）**：

- 编解码 `src/utils/booklistCodec.ts`（浏览器原生 `CompressionStream`，与移动端 Dart 实现严格对齐，含旧 `olib_share:` 格式兼容）
- 收藏页「分享书单」= 二维码 + 口令（`BooklistShareModal`，二维码超 1800 字符自动降级为仅 ID）；「导入书单」= 口令/JSON 粘贴 + 预览（`BooklistImportModal`）
- Rust 命令 `booklist_qr`（复用 LAN 的二维码渲染）、`import_booklist`（与 `/api/booklist` 共用 `database::import_booklist` 落库去重）

## 阶段 4（远期）：olibai 云同步 + mDNS 自动发现

- **云同步**：olibai 增加 `/sync/favorites` 等端点做跨设备同步。前置的移动端鉴权迁移 scc **已完成**（2026-07-15，olib-mobile `feat/scc-auth`，存量 wxauth JWT 启动时判无效清除），双端同为 scc 账号池，随时可排期。
- **mDNS**：桌面 `mdns-sd` crate 广播 `_olib._tcp.local`，移动端 `bonsoir` 发现，免扫码；体验增强，不阻塞前三阶段。

## 落地顺序与验收

推荐 **1 → 3 → 2 → 4**：阶段 1 打通主场景且几乎不写新逻辑；阶段 3 桌面单方面实现协议即获双向书单；阶段 2 认证设计稍重；阶段 4 等账号体系统一。

| 阶段 | 验收标准                                                                           |
| ---- | ---------------------------------------------------------------------------------- |
| 1    | 手机扫码后列出桌面书库并成功下载，出现在移动端下载历史                             |
| 3    | 桌面收藏导出二维码 → 手机扫码导入；手机推送书单 → 桌面收藏新增                     |
| 2    | 手机端书籍上传后出现在桌面书架；白名单外扩展名被 400 拒绝；OPDS 在 KOReader 仍可用 |
| 4    | 同一微信账号双端收藏一致                                                           |

## 风险与待确认

- 加认证后 KOReader/静读天下 OPDS 回归验证（`cargo test --test opds_test`）
- iOS 需 `NSLocalNetworkUsageDescription`；Android 13+ 存储权限引导
