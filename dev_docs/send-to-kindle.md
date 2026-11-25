# Send to Kindle

通过用户自己的邮箱 SMTP，把书架里的本地文件作为附件发到 `@kindle.com` 地址。不依赖 Z-Library 接口。参考 [heartleo/zlib](https://github.com/heartleo/zlib) `internal/zlib/kindle.go`。

## 模块

| 位置                                        | 职责                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `src-tauri/src/kindle/mod.rs`               | 配置类型、加密方式推断、校验                                               |
| `src-tauri/src/kindle/store.rs`             | SQLite 单行表 `kindle_settings`（含授权码）                                |
| `src-tauri/src/kindle/sender.rs`            | 附件格式 / 大小校验，组装邮件，SMTP 发送（`lettre`）                       |
| `src-tauri/src/commands/kindle_commands.rs` | Tauri 命令                                                                 |
| `src/components/KindleConfigDialog.tsx`     | 配置弹窗，「保存并发送」（测试 SMTP 通过后续发）                           |
| `src/hooks/useSendToKindle.ts`              | 书架右键「发送到 Kindle」：未配置或因配置失败时打开配置弹窗，loading toast |

不在设置页常驻：首次发送（未配置）或因 SMTP / 配置问题失败时弹出配置窗口，失败原因显示在窗口内；文件格式、大小等非配置错误仍用 toast。

## 命令

| 命令                   | 参数                         | 返回                     | 说明                                |
| ---------------------- | ---------------------------- | ------------------------ | ----------------------------------- |
| `get_kindle_settings`  | —                            | `KindleSettings \| null` | 不回传授权码，只返回 `has_password` |
| `save_kindle_settings` | `input: KindleSettingsInput` | `KindleSettings`         | `password` 为空沿用已保存的         |
| `test_kindle_smtp`     | —                            | —                        | 用已保存配置登录 SMTP，不发信       |
| `send_to_kindle`       | `path`                       | —                        | 未配置时报错「尚未配置 Kindle…」    |

## 约定

- 加密方式：`tls`（连接即 TLS，465）或 `starttls`（587 等）；前端按端口预选，可手动改。超时 / TLS 错误时报错附带「切换加密方式」提示。
- 格式：epub、pdf、txt、doc、docx、rtf、htm、html；mobi / azw / azw3 亚马逊已不支持，菜单置灰提示先转 EPUB。单文件上限 200 MB。前后端格式列表需保持一致（`sender::SUPPORTED_EXTENSIONS` ↔ `api/kindle.ts KINDLE_EXTENSIONS`）。
- 存储：配置与授权码存 SQLite（与 Z-Lib userkey 一致，逐步淘汰 json 存储），授权码不写日志、不回传前端。
- 不做：自动转换后发送、批量发送、多个 Kindle 地址。
