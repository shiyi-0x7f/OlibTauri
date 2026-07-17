# LAN 无线传书服务

`src-tauri/src/lan_server.rs`,基于 axum,由 `lan_commands.rs` 暴露的 Tauri 命令控制启停(默认端口 8765,监听 `0.0.0.0`)。共享目录始终实时读取配置中的 `download_folder`。与 olib-mobile 的联动契约见 `mobile-sync.md`。

## 认证

**无认证**(2026-07-16 真机联调时决策:局域网传书场景 token 无实际意义,取消)。防护仅保留:下载/上传的文件名路径穿越校验、上传扩展名白名单与大小上限。olib-mobile 的 `lan_client.dart` 把 token 设计为可选(二维码 URL 无 `?token=` 时自动不带),故双端无需同步改动;若日后要恢复,恢复桌面端即可。

## HTTP 端点

| 端点 | 说明 |
|------|------|
| `GET /` | 内嵌移动端网页(搜索/分类/下载) |
| `GET /api/info` | 身份端点:`{ app: "olib-desktop", version, device_name, capabilities }`,供 olib-mobile 扫码后确认对端 |
| `GET /api/files` | 文件列表 JSON:`[{ name, size, extension }]` |
| `GET /download/{filename}` | 下载单个文件;拒绝含 `..` `/` `\` 的文件名 |
| `GET /opds` | OPDS 1.2 acquisition feed(Atom XML) |
| `POST /api/upload` | 接收移动端上传(multipart 字段 `file`):扩展名限 `OPDS_EXTENSIONS` 白名单、上限 500 MB(超限 413)、流式落盘、同名追加 ` (n)` 去重;成功 201 `{ name, size }`,拒绝 400 `{ detail }` |
| `POST /api/booklist` | 接收移动端书单(booklist codec v1,条目短键 `t/a/h`),按 `(book_id, user_email)` 去重写入收藏;返回 `{ imported, skipped }`;桌面未登录时 400 |

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
