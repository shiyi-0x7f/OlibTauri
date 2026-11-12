# LAN 无线传书服务

`src-tauri/src/lan_server.rs`,基于 axum,由 `lan_commands.rs` 暴露的 Tauri 命令控制启停(默认端口 8765,监听 `0.0.0.0`)。共享目录始终实时读取配置中的 `download_folder`。与 olib-mobile 的联动契约见 `mobile-sync.md`。

## 自动开启

配置项(`config.json`,均由启停命令记录,设置页整份回写配置时不覆盖):

| 键               | 默认    | 说明                                                                                 |
| ---------------- | ------- | ------------------------------------------------------------------------------------ |
| `lan_auto_start` | `false` | 用户手动开启记 `true`、手动关闭记 `false`,即「上次开着,下次启动就自动开」            |
| `lan_port`       | `8765`  | 上次成功开启的端口;`start_lan_server` 不传端口时沿用它,保证手机记住的 `IP:端口` 不变 |

应用启动时(`lan_commands::auto_start_if_enabled`)若 `lan_auto_start == true` 则按 `lan_port` 后台开启;失败(端口被占用、无局域网 IP 等)只记日志、保持关闭、不弹窗,且不改写 `lan_auto_start`(下次启动仍会重试)。书架页「传书中」按钮每 3 秒轮询 `get_lan_status`,自动开启后同样生效。

## 前端事件

`lan_server::set_event_sink` 在应用启动时注册 AppHandle;未注册(集成测试直接调 `start`)时不发事件。

| 事件                      | 时机                          | payload                 |
| ------------------------- | ----------------------------- | ----------------------- |
| `lan://file-received`     | `POST /api/upload` 落盘成功   | `{ name, size }`        |
| `lan://booklist-received` | `POST /api/booklist` 导入完成 | `{ imported, skipped }` |

前端 `LanReceiveNotifier`(App 根部全局挂载)负责提示:1.5 s 内连续到达的文件合并成一条「收到 N 本书」(带「打开文件夹」+ 下载提示音),书单单独提示;随后派发窗口事件 `olib:lan-received`(detail `"files"` / `"booklist"`),书架页 / 收藏页据此刷新。书架直接扫描 `download_folder`,上传的文件无需入库即可显示。

## 认证

**无认证**(2026-07-16 真机联调时决策:局域网传书场景 token 无实际意义,取消)。防护仅保留:下载/上传的文件名路径穿越校验(上传不限格式与大小,2026-11-11 取消扩展名白名单与 500 MB 上限)。开启时弹窗提示「仅在可信网络使用」。olib-mobile 的 `lan_client.dart` 把 token 设计为可选(二维码 URL 无 `?token=` 时自动不带),故双端无需同步改动;若日后要恢复,恢复桌面端即可。

## HTTP 端点

| 端点                       | 说明                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                    | 内嵌移动端网页(搜索/分类/下载)                                                                                                                                 |
| `GET /api/info`            | 身份端点:`{ app: "olib-desktop", version, device_name, capabilities }`,供 olib-mobile 扫码后确认对端                                                           |
| `GET /api/files`           | 文件列表 JSON:`[{ name, size, extension }]`                                                                                                                    |
| `GET /download/{filename}` | 下载单个文件;拒绝含 `..` `/` `\` 的文件名                                                                                                                      |
| `GET /opds`                | OPDS 1.2 acquisition feed(Atom XML)                                                                                                                            |
| `POST /api/upload`         | 接收移动端上传(multipart 字段 `file`):不限格式与大小(docx、图片、压缩包等均可)、流式落盘、同名追加 ` (n)` 去重;成功 201 `{ name, size }`,拒绝 400 `{ detail }` |
| `POST /api/booklist`       | 接收移动端书单(booklist codec v1,条目短键 `t/a/h`),按 `(book_id, user_email)` 去重写入收藏;返回 `{ imported, skipped }`;桌面未登录时 400                       |

## OPDS 目录

- 供 KOReader、静读天下、Marvin 等阅读 App 添加为目录源,直接浏览并下载书库
- 仅收录电子书扩展名(`OPDS_EXTENSIONS`:pdf/epub/mobi/azw/azw3/fb2/djvu/cbz/cbr/txt),其余文件不出现在 feed 中
- 条目标题取文件名(去扩展名),按修改时间倒序(最新下载在最前)
- 获取链接复用 `/download/{filename}`,文件名做 RFC 3986 路径段 percent-encoding;MIME 由 `mime_for_extension` 统一映射
- feed 地址随 `LanStatus.opds_url` 返回给前端,在无线传书弹窗中展示并可复制

## 测试

```bash
cd src-tauri
cargo test --test opds_test   # 端到端:起服务 → 身份端点 → OPDS/下载 → 上传 → 书单导入
```

> 测试依赖本机有可用局域网 IP(服务启动时探测网卡)。
