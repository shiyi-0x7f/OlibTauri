# 微信读书推荐：问题分析与推荐池设计

> 2026-10-03。分析对象为 olib-mobile v1.4.0 的推荐实现；桌面端 P2（`feat/weread-recommend`）按本文设计实现，移动端修复需求见 `olib-mobile/dev_docs/req_OlibTauri.md`。

## 一、olib-mobile 现状问题

### 1. `/book/recommend` 语义存疑（推断，待 P0 验证）

移动端沿用 weread-omni，把 `GET /book/recommend?count&maxIdx` 当「个性化推荐 + 分页」（`lib/services/weread/weread_api.dart:383`）。但 weread-omni 自己的 APK 反编译目录（`docs/endpoints.md:170`）记录：

```
GET /book/recommend | BaseExchangeService, ExchangeService | balance
```

即官方客户端里它属于**兑换服务**，唯一参数是 `balance`，**不带 `count`/`maxIdx`**。推测：内容可能是兑换 / 福利向而非阅读偏好推荐；分页参数大概率被忽略、每次返回同一批。

### 2. 不分页时首页无限请求（代码缺陷，确定）

- `lib/providers/weread_provider.dart:187-208` `loadMore`：服务端返回同批书时，去重后无新书但 `resp.books` 非空 → `_hasMore` 仍为 `true`、`_nextOffset` 继续累加，且 `state` 被赋为新 List 实例 → 通知重建。
- `lib/screens/home/home_screen.dart:545-575` 在 `itemBuilder` 里调用 `loadMore()`：重建 → 末尾卡片重建 → 再次 `loadMore` → 循环。底部卡片可见时请求不断、转圈不消失。
- 反之若服务端忽略 `count` 只回 12 条，`_hasMore = 12 >= 20` 为 `false`，退化为完全不分页。

### 3. 其他缺陷

| 位置                          | 问题                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `weread_provider.dart:203`    | `loadMore` 的 `catch (_)` 静默吞错，用户无感知，滚动时反复重试                                                                                        |
| `weread_home_screen.dart:653` | 「换一批」只在已加载的约 20 本内本地轮转，从不请求新数据，5 次后重复；`refresh()` 不重置 `_recommendPage`                                             |
| `books_provider.dart:241-264` | 首页混合推荐把 Z 站与微信读书直接拼接、非交错；某一源错误被 `valueOrNull` 吞掉；「Z 站加载中 + 微信读书出错」时返回 `data([])`，闪现 "No books found" |
| `home_screen.dart:545`        | `ref.read(...notifier).hasMore` 读普通 getter，非响应式                                                                                               |
| 全局                          | 未排除书架已有书，推荐里会出现正在读的书                                                                                                              |

## 二、P0 验证方法

桌面 P1 完成后用扫码会话直接请求（或本机 weread-omni 已登录时用 CLI）：

```
GET /book/recommend?count=5&maxIdx=0    # A
GET /book/recommend?count=5&maxIdx=5    # B：bookId 与 A 是否重复？
GET /book/recommend?count=20&maxIdx=0   # C：是否真返回 20 条？
GET /book/recommend                     # D：不带参数返回什么？连续两次是否不同？
```

同时记录顶层字段（`hasMore` / `sessionId` / 兑换相关字段）与 `reason` 内容。结论回填到本文第四节。

## 三、推荐池设计（桌面端 P2 实现，移动端可照搬）

### 来源

**唯一来源：种子相似**（P0 实测后定，见第四节）。`/shelf/sync` 排除私密书，按 `readUpdateTime` 从近到远选最多 20 本为候选种子；近期导入的私人书没有相似书时，继续尝试较早的书。`GET /book/detailinfo?bookId&listtypes=2&synckey=0&count&maxIdx[&sessionId]` 拉相似书；续页时 `maxIdx` 传上一页最后一条的 `idx`，并带回 `booksimilar.sessionId`。推荐理由「因为你在读《X》」。

~~`/book/recommend`~~：不使用（实测非推荐接口）。

### 规则

- **合并**：按 bookId 去重；排除书架已有书；多来源轮流交错。
- **终止**：某来源一页无任何新 bookId 或返回空，即标记该来源耗尽；所有来源耗尽 = 无更多。
- **错误**：错误可见并带重试；加载更多只由滚动 / 按钮触发，绝不在渲染过程中发请求。
- **换一批**：从池中取下 4 本未展示过的；池内不足时拉取；全部耗尽时提示「已看完」并从头轮转。
- **实现位置**：池逻辑放后端 `src-tauri/src/weread/recommend.rs`（纯函数可单测），前端只渲染 `{ books, exhausted }`。

### 桌面端实现（P2）

| 位置                                              | 说明                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/weread/recommend.rs`               | 推荐池（`Pool`：种子选取、去重、排除书架、交错、耗尽、轮转，纯逻辑有单测）；池按 vid 缓存在进程内，换账号自动重建                                                    |
| `weread_recommend_next(count, refresh)`           | 返回 `{ books, exhausted, wrapped, hasSeeds }`；进入微信读书页时 `refresh=true` 重读书架，「换一批」为 `false`；单个种子失败只跳过该种子，全部失败且无书可给时才报错 |
| `weread_similar_books(bookId, maxIdx, sessionId)` | 详情弹窗「相似书」分页，返回 `{ books, sessionId, nextIdx, hasMore }`                                                                                                |
| `src/pages/WereadPage/WereadRecommendSection.tsx` | 「为你推荐」每批 6 本、换一批、错误可重试、轮转提示                                                                                                                  |
| `src/components/WereadSimilarBooks.tsx`           | 详情弹窗「相似书」标签，「加载更多」续页；点卡片在弹窗内切到该书                                                                                                     |

## 四、P0 验证结论（2026-10-03，桌面端扫码会话实测）

**`/book/recommend` 不是推荐接口，弃用。**

- A/B/C/D 四组（含不带参数、`balance=0/1`）返回完全相同：顶层只有 `books` 与 `recentBooks`，**`books` 恒为空数组**，`recentBooks` 只有 1 本（字段含 `readingTime`，像是兑换场景下的「最近在读」）。`count`/`maxIdx` 完全无效。
- 这直接解释了移动端微信读书「为你推荐」为什么总是空的或只能显示很少内容：数据源本身就是空的，第一节列的分页缺陷只在接口有数据时才会触发。

**种子相似 `/book/detailinfo?listtypes=2` 可用，且是真分页。**

- 以书架最近在读《无声告白》为种子，`count=6&maxIdx=0` 返回 idx 1–6 共 6 本同类书（如《小小小小的火》《岛上书店》等，相关性好）；带 `sessionId` 与 `maxIdx=6` 续页返回 idx 7–12，无重复。
