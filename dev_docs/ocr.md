# OCR 文字识别（扫描版 PDF → 双层可搜索 PDF）

把扫描版 PDF 变成**双层可搜索 PDF**：保留原扫描页面不动，在图片下方叠加一层隐藏文本层。于是 PDF 能搜索、能选中复制，版式与原件完全一致。

引擎是 [Umi-OCR](https://github.com/hiroi-sora/Umi-OCR)（MIT），走插件系统按需下载，**完全离线，文件不出网**。

## 为什么是 Umi-OCR，不是 Tesseract

Tesseract 只吃图片、只吐文本，要做「扫描 PDF → 双层 PDF」得自己拼「PDF 渲染 → 识别 → 合成文本层」的管线，还要单独拖中文语言包和 Ghostscript，Windows 便携化很脏。Umi-OCR 一个便携包覆盖整条管线：解压即用、内置中英日韩等语言库、**原生输出双层可搜索 PDF**。用的是 Rapid 内核（98 MB，ONNX 推理，不吃独显）。

## 与格式转换的分工

扫描版 PDF 里没有文本，直接「转换格式」会转出空白或乱码。OCR 正是补上这一环——**先 OCR 拿到文本层，再转换**才有意义。

## 代码位置

- `src-tauri/src/commands/ocr_commands.rs` —— OCR 特有逻辑（接口流程、输出命名）
- `src-tauri/src/plugins/service.rs` —— 服务型插件的通用生命周期管理（拉起 / 就绪 / 隐藏 / 退出）
- `src-tauri/plugins.builtin.json` —— `umi-ocr` 插件清单

## 调用流程（Umi-OCR HTTP 接口，默认端口 1224）

服务按需启动，之后复用同一进程。

1. `POST /api/doc/upload` —— multipart 上传文件 + `{"doc.extractionMode":"mixed"}`（有文本层的页直接提取、扫描页才走 OCR，又快又准），返回 `data` = 任务 id
2. `POST /api/doc/result` —— 轮询直到 `is_done && state == "success"`；响应里的 `processed_count / pages_count` 直接当进度喂给任务表
3. `POST /api/doc/download` —— `file_types: ["pdfLayered"]`（**这个值就是「双层可搜索 PDF」**）
4. `GET <上一步返回的 URL>` —— 取回文件
5. `GET /api/doc/clear/<id>` —— 清掉服务端临时文件

输出为 `<原名>-OCR.pdf`（同目录，重名自动追加 ` (n)`），不覆盖原扫描件。

### ⚠️ 两个实测踩到的坑

1. **`/api/doc/download` 返回的是绝对 URL，不是文档里写的相对路径。** 直接拼 base 会得到 `http://127.0.0.1:1224http://127.0.0.1:1224/...` 这种废 URL，OCR 会 100% 失败。代码里按 `http://` 前缀判断，别改回去。
2. **Umi-OCR 没有无界面启动参数。** 只能先启动（会闪一下窗口），健康检查通过后立刻用 `--hide` 收进托盘；应用退出时用 `--quit` 优雅关闭，失败则强杀，否则会留下孤儿进程。这些都在清单的 `service` 段声明。

## 前端

- 入口：书架页右键「OCR 识别（可搜索 PDF）」，仅对清单 `inputs` 里的格式显示（pdf/epub/mobi/xps/cbz）
- 未安装插件时点击 → 提示并跳转「插件」页，不是直接报错
- 进度：复用插件任务表，文件行内显示「OCR 识别中 NN%」徽标（按 `plugin_id` 区分于格式转换的「转换为 XXX」）

## 实测结论（2026-07-13，Windows 11）

Rapid 便携包 98.6 MB（sha256 已锁定在清单里，并与 GitHub 直连下载逐字节比对一致）；服务约 4 秒就绪；中文识别置信度 0.92。一页图片型（无文本层）扫描 PDF：30,958 bytes → 43,395 bytes，输出同时含 `/Font` + `ToUnicode`（可搜索可复制）与 `/Image`（原扫描图保留），确认是真正的双层 PDF。
