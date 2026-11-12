# 更新清单（强制更新 + 下载渠道）

> 2026-10-09 引入，3.4.1 起生效。实现：`src-tauri/src/update_manifest.rs`（解析，含单测）、
> `config_commands::check_for_updates`（下发）、`src/components/UpdateDialog.tsx`（展示）。

客户端启动时请求公开仓库最新 Release（`api.github.com/repos/shiyi-0x7f/OlibTauri/releases/latest`），
并解析 Release 正文里的一段**隐藏注释**（GitHub 页面上不可见）：

```text
<!-- olib-update
min_version: 3.4.1
百度网盘: https://pan.baidu.com/s/xxxx?pwd=xxxx
夸克网盘: https://pan.quark.cn/s/xxxx?pwd=xxxx
迅雷网盘: https://pan.xunlei.com/s/xxxx?pwd=xxxx
-->
```

| 行                   | 含义                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `min_version: x.y.z` | 当前版本**低于**它 → 弹出不可关闭的更新对话框（强制更新）。省略 = 不强制                           |
| `名称: 链接`         | 对话框里的下载渠道按钮，按书写顺序排列，第一个为主按钮。仅接受 http/https，名称 ≤ 20 字，最多 8 个 |

- 半角 `:` 与全角 `：` 都可以；`min_version` 可带 `v` 前缀。
- 对话框里总会追加「官网下载」（11xy.cn 项目页）和「GitHub」（Release 页）两个兜底渠道。
- 没有清单块：普通更新提示，渠道只有官网 + GitHub。

## 行为

| 情况                                  | 表现                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| 有新版本、未强制                      | 右下角提示条 →「前往更新」打开对话框（可关闭，Esc / 点遮罩 / 稍后再说） |
| 当前版本 < `min_version`              | 启动即弹对话框，无关闭按钮，Esc 与点遮罩无效                            |
| 检测失败（断网、GitHub 不可达、限流） | **一律放行**，不提示也不拦截                                            |

## 发版时怎么写

1. CI 构建完 → 下载安装包 → 在公开仓库建 Release（正文写更新说明）。
2. PanSync 上传网盘拿到分享链接后，用 `gh release edit vX.Y.Z --repo shiyi-0x7f/OlibTauri --notes-file <正文>`
   把清单块追加到正文末尾。
3. **只在必要时提高 `min_version`**（旧版接口失效、安全问题等）；平时不写或保持不变，避免频繁打断用户。

> 注意：强制更新只对 3.4.1 及以后的客户端生效；更早的版本只会弹普通提示条。
