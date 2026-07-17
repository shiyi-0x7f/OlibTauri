# 架构调整：API 实现拆分为独立私有 crate

## 背景

原先 API 客户端、数据模型与内置域名直接放在 `src-tauri/src/` 内（`api.rs`、`hosts.rs`）以及 `data/sites.json`、`dev_docs/zlibrary-api-reference.md`。本仓库公开后，这些接口实现细节会随源码与 git 历史一并暴露。

## 调整方案

把接口实现剥离为一个独立的私有 Cargo crate `olib_api`，通过 `path` 依赖引用；公开仓库只保留对接口的**调用**，不含实现。

### 公开仓库（本仓库）变化

| 动作 | 文件 |
|---|---|
| 删除（移出） | `src-tauri/src/api.rs`、`src-tauri/src/hosts.rs`、`data/sites.json`、`dev_docs/zlibrary-api-reference.md` |
| 新增依赖 | `src-tauri/Cargo.toml`：`olib_api = { path = "../vendor/olib-api-plugin-rs" }` |
| re-export 薄壳 | `src-tauri/src/lib.rs`：`pub mod api { pub use olib_api::{...}; }`、`pub mod hosts { pub use olib_api::hosts::*; }` |
| 忽略目录 | `.gitignore`：新增 `vendor/` |
| CI | `.github/workflows/build.yml`：构建前 clone 私有 crate 到 `vendor/` |

### 关键设计：零调用方改动

通过在 `lib.rs` 用 re-export 薄壳把 `crate::api::*`、`crate::hosts::*` 重新映射到 `olib_api`，所有命令层文件（`commands/*.rs`、`download.rs`）的 `use crate::api::ZLibrary` 等引用**完全无需改动**。符合开闭原则与最小改动。

### 私有 crate

源码与对接细节见 `dev_docs/refs/olib-api-plugin-rs.md`。仓库：`shiyi-0x7f/olib-api-plugin-rs`（私有）。

## 本地开发须知

clone 公开仓库后 `vendor/` 为空，需手动拉取私有 crate 才能编译：

```bash
git clone git@github.com:shiyi-0x7f/olib-api-plugin-rs.git vendor/olib-api-plugin-rs
```

## CI 须知

需在仓库配置 secret `OLIB_API_REPO_TOKEN`（对私有 crate 仓库 read 权限）。详见 `build.yml` 头部。
