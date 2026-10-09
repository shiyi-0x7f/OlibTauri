# 引用说明：weread-omni

## 被引用项目

- **名称**：weread-omni（第三方开源，微信读书 Eink 客户端逆向 SDK / CLI，TypeScript）
- **本地路径**：`D:\SoftwareData\third-party\weread-omni`
- **关系**：**非代码依赖**。仅参考其接口路径、参数与扫码登录流程，在 Rust 中独立实现；不引入其代码或包。

## 参考的内容

| 内容                                               | 位置                                                  |
| -------------------------------------------------- | ----------------------------------------------------- |
| 扫码登录（wxticket → qrconnect → 长轮询 → /login） | `src/auth/qrlogin.ts`                                 |
| 各资源接口路径与参数                               | `src/api/resources/*.ts`、`src/api/operation-spec.ts` |
| APK 反编译接口全目录（判断接口真实归属与参数）     | `docs/endpoints.md`                                   |

## 同源实现

olib-mobile 已基于同一来源实现 Dart 版：`olib-mobile/lib/services/weread/weread_mobile_client.dart`（会话 / 刷新 / AI / 导入）与 `weread_api.dart`（资源接口）。桌面端行为与其对齐，差异记录在 `../weread-mobile-session.md`。

## 注意

- `docs/endpoints.md` 显示 `/book/recommend` 在官方客户端属于 `ExchangeService`、参数仅 `balance`，与 weread-omni 封装的 `count`/`maxIdx` 不一致，详见 `../weread-recommend.md`。
- 上游接口随微信读书版本变化，出现大面积失败时先比对 weread-omni 最新提交。
