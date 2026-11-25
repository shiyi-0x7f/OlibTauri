# 工程优化计划

> 2026-07-20 全面评估（前端 / Rust / 仓库工程三方向）后形成的分阶段优化计划。
> 分支：`chore/eng-optimization`。每项独立原子提交，完成后勾选并注明 commit。

## 背景与结论概览

架构底子良好：Rust 命令按领域拆分（`commands/` 20+ 模块）、community feature 门控干净、
网络全异步、无 `println!` 散落、tsconfig 已 strict、SearchPage/SettingsPage 已有目录化拆分范式。

主要短板集中在三处：

1. **工程门禁缺失**：无 ESLint/Prettier/clippy 配置、无 `.editorconfig`，CI 只在 tag 时构建，
   push/PR 无任何检查 → 前端 62 处 `console.*`、63 处显式 `any` 无兜底。
2. **前端无 API 层**：`invoke()` 散落 105 处 / 28 文件，后端 ~60 个命令返回值在前端全程无类型；
   `get_config` 被 7 个页面重复拉取，无全局状态。
3. **发布产物未调优**：两个 crate 均无 `[profile.release]`（无 lto/strip），体积与性能有明显空间。

其余隐患：全局 `static Mutex` 的 `lock().unwrap()`（~78 处）存在锁中毒级联 panic 面；
约 15 处 async 命令内同步 `std::fs`；前端 14 处 `.catch(() => null)` 静默吞错；
运行时 `@import` Google Fonts 离线阻塞；`package-lock.json` 与 `pnpm-lock.yaml` 双 lockfile 并存；
前端零测试；6 个 400+ 行巨型组件。

## P0 速赢（低风险、立竿见影）

- [x] **P0-1 `[profile.release]` 调优**（`src-tauri/Cargo.toml`）— b453dfc
  - `lto = "thin"`、`strip = true`、`codegen-units = 1`、`opt-level = "s"`。
  - **不加 `panic = "abort"`**：项目大量全局锁依赖 unwind 语义，abort 会把任何 panic 变成无提示闪退，
    与 P0-4 的中毒收敛策略冲突。
  - vendor 作为依赖使用根 crate 的 profile，无需单独配置。
- [x] **P0-2 清理双 lockfile**（471402c）：`git rm package-lock.json`，`.gitignore` 增加 `package-lock.json` 防回归；
      依赖管理统一 pnpm（全局约定）。
- [x] **P0-3 补 `.editorconfig`**（ae32b74）：UTF-8 + LF + 缩进约定，与现有 `.gitattributes` 呼应。
- [x] **P0-4 收敛锁中毒级联 panic**（b03a02b）：新增 `util::lock_ignore_poison` helper
      （`lock().unwrap_or_else(|e| e.into_inner())`），替换 src-tauri 内全局 Mutex 的 `lock().unwrap()`
      （download / config / lan_server / cover_proxy / installer / database 等）。**不动 `vendor/`**（独立仓库）。
- [x] **P0-5 字体本地化**（7291c7b）：`@fontsource/inter` 打包内置（新增 devDependency，理由：消除运行时
      Google Fonts `@import`，桌面应用离线场景字体加载失败/阻塞）。

## P1 质量门禁

- [x] **P1-1 ESLint + Prettier**（b7edf53 + 格式化 c7d13c8；注意 react-hooks v7 的 Compiler 系规则存量 32 处也暂设 warn）（新增 devDependencies：`eslint`、`typescript-eslint`、
      `eslint-plugin-react-hooks`、`prettier`、`eslint-config-prettier`）
  - flat config；`@typescript-eslint/no-explicit-any` 与 `no-console` **先设 warn**
    （存量 63 处 any / 62 处 console，待 P2-1 API 层落地清零后升 error）；`no-empty` 等设 error。
  - `package.json` 脚本：`lint` / `format` / `check`（tsc + eslint + prettier check 串联，作为门禁入口）。
- [x] **P1-2 vite 生产构建 drop console**（bce384f）：`esbuild: { drop: ['console', 'debugger'] }`（仅 build）。
- [x] **P1-3 Rust 门禁**（e8e9c08，clippy 存量 9 处清零，顺带删除死代码 get_platform_info）：`cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` 跑通
      （先修存量 warning），`Cargo.toml` 用 `[lints]` 固化关键 clippy 规则。
- [x] **P1-4 CI 质量工作流**（02b5034，连带修复 build.yml 仍用 npm ci 的问题——package-lock 已删，不改必挂） `.github/workflows/ci.yml`：push/PR 触发；
      前端 job：pnpm install → `check`；Rust job：fmt + clippy（复用 build.yml 的 vendor clone 步骤与
      `OLIB_API_REPO_TOKEN`）。

## P2 结构优化

- [x] **P2-1 前端类型化 API 层**（8a6b997 建层 + e3ccff4 迁移 + f67e143 any/console 清零升 error）：
      20 个模块覆盖全部 68 个命令；105+ 处裸 `invoke` 全部迁移；`no-explicit-any`/`no-console`
      已升 error（Book.id 分裂桥接点 3 处定点豁免，随 P3 拆分统一后删除）。
- [x] **P2-2 config 缓存收敛**：实际方案改为 **api/config 模块级 Promise 缓存**（非 Context——
      调用方无需任何改动，churn 更小）：`getConfig` 按 Promise 去重；`setConfig` 写透缓存；
      后端在 set_config 之外还有 7 处写 config（login/logout/switch_user 写 user_email，
      节点四操作写 host_index/subscription_url），对应 api 函数均调用 `invalidateConfigCache()`。
      **新增后端 config 写路径时必须同步在 api 层失效缓存**。
- [x] **P2-3 静默吞错补日志**（ddb2ac1，实际 16 处，`src/utils/log.ts` 的 `warnIgnored`）。
- [x] **P2-4 async 命令同步 fs 改造**（dc84993；bookshelf 目录遍历/递归删除走 `spawn_blocking`，
      其余改 `tokio::fs`；同步辅助函数内的 fs 调用不属阻塞面，未动）。

## P3 长尾（本轮不执行，留待后续）

- [ ] **巨型组件拆分**：BookshelfPage(680) / BookDetailModal(582) /
      FavoritesPage(424) / WereadBookDetailModal(400) / PluginsPage(396)，按 SearchPage 既有
      「index + 子视图 + hooks/utils/types」范式。
- [ ] **Rust 大文件拆分**：`lan_server.rs`(878) 按路由/上传/二维码拆、`download.rs`(728)。
- [ ] **tokio feature 裁剪**：主 app 从 `full` 收敛到实际子集（vendor 侧在其自己仓库处理）。
- [ ] **framer-motion 评估**：AI 寻书已改为 CSS 动画（2026-10-08），目前仅 BookShelf3D 使用，评估替代后可移除依赖。
- [ ] **前端测试**：vitest + 对 `src/api/`、utils（booklistCodec / searchInLibrary / wereadExport）单测。
- [ ] **启动期 `.expect()` 友好化**：`lib.rs:170-190` 四处启动失败改为日志 + 原生错误弹窗。
- [ ] **日志落盘**：`env_logger` → 文件滚动输出（或迁移 `tracing`），便于用户侧排障。

## API 层盘点时发现的存量问题（未在本轮修复，需另行决策）

1. **【安全】`get_all_users` / `get_current_user` / `refresh_user_downloads` 把完整 DB User
   回传前端，含明文 `password` 与 `remix_user_id`/`remix_user_key`**（auth_commands.rs）。
   前端只用到 4 个字段。建议后端加不含敏感字段的 DTO。
2. **疑似字段名 bug**：`MyReview.abstract_`（WereadBookDetailModal / wereadExport）——微信读书
   API 字段应为 `abstract`，现写法大概率永远取不到值，导出笔记会缺「原文摘录」。
3. `Book.id` 类型跨页分裂（SearchPage=number、DiscoverPage=string），api 层暂定 `number | string`，
   待巨型组件拆分时统一。
4. 标准版每次启动会对不存在的 `community_status` 命令发起一次注定失败的 invoke（已被降级日志
   吞掉，行为正确但可加编译期常量 `VITE_COMMUNITY` 判断跳过）。

## 验证方式

- 每项完成后：前端 `pnpm build`（含 tsc）；Rust `cargo check` / `cargo clippy` / `cargo test`
  （在 `src-tauri/` 下执行）。
- P0-4 / P2-4 涉及运行时行为，合并前需人工冒烟：启动、搜索、下载、书架文件操作、LAN 传书。
