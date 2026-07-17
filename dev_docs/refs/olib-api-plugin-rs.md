# 引用说明：olib-api-plugin-rs

本项目（olib-fluent / src-tauri）通过 **Cargo path 依赖**引用一个独立的私有 crate，承载 API 客户端、数据模型与内置域名。该 crate 源码**不入本公开仓库**。

## 基本信息

| 项 | 值 |
|---|---|
| 被引用项目 | `olib_api`（仓库名 `olib-api-plugin-rs`） |
| 远程仓库 | `git@github.com:shiyi-0x7f/olib-api-plugin-rs.git`（**私有**） |
| 本地路径 | `vendor/olib-api-plugin-rs/`（已在 `.gitignore` 排除） |
| 引用方式 | Cargo `path` 依赖：`olib_api = { path = "../vendor/olib-api-plugin-rs" }`（见 `src-tauri/Cargo.toml`） |
| 版本 | crate `1.0.0` |

## 用途

把对外 API 的实现细节（客户端、反检测逻辑、数据模型、内置域名列表）从公开仓库中剥离，集中到一个私有 crate。公开仓库只保留对接口的调用，不含任何接口实现。

## 对接的接口

主 app 通过 `crate::api` / `crate::hosts` 两个 re-export 薄壳访问（见 `src-tauri/src/lib.rs`），调用路径与拆分前一致：

- `crate::api::ZLibrary` — API 客户端（登录、搜索、下载链接、书籍信息等）
- `crate::api::{Book, ApiResponse, SearchResult, Pagination}` — 数据模型
- `crate::hosts::*` — `init_hosts` / `get_host` / `get_hosts` / `get_hosts_info` / `update_from_subscription` / `import_from_text` / `reset_to_default` / `HostsCache`

crate 公开导出定义见其 `src/lib.rs`。

## 本地开发：拉取依赖

公开仓库 clone 下来后 `vendor/` 是空的，需手动 clone 私有 crate：

```bash
git clone git@github.com:shiyi-0x7f/olib-api-plugin-rs.git vendor/olib-api-plugin-rs
cd src-tauri && cargo build   # path 依赖自动生效
```

## CI 集成

`.github/workflows/build.yml` 在构建前用 secret `OLIB_API_REPO_TOKEN`（对私有 crate 仓库有 read 权限的 token）HTTPS clone 到 `vendor/olib-api-plugin-rs/`：

```bash
git clone --depth 1 \
  "https://x-access-token:${OLIB_API_REPO_TOKEN}@github.com/shiyi-0x7f/olib-api-plugin-rs.git" \
  vendor/olib-api-plugin-rs
```

token 配置方式见 `build.yml` 头部注释。

## 升级私有 crate 后

1. 在 `vendor/olib-api-plugin-rs/` 改代码并 `cargo build` 验证
2. 在该私有 repo 提交并 push
3. 主 app 重新 `cargo build` 即拉到新版（path 依赖无需改动）
