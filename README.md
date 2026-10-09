<div align="center">

# 📚 Olib · 开源图书桌面客户端

![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-GPLv3-green?style=for-the-badge)
![Free](https://img.shields.io/badge/永久免费-❤️-red?style=for-the-badge)

**一个跨平台、永久免费、无广告的开源图书桌面客户端**

**第三方客户端 · 仅提供前端界面 · 数据来自外部源**

[报告问题](../../issues) · [功能建议](../../issues) · [Bilibili](https://space.bilibili.com/19276680)

</div>

---

## 💛 写在前面 · 初心

我始终相信：**知识不应该被高墙阻隔，每个人都该有平等、免费获取书籍的权利。**

很多人想读一本书，却被价格、地区、平台层层挡在门外。Olib 就是为此而生——它不为盈利，**永远免费、没有广告、没有套路、不接受任何商业合作**。我只希望，让"想读书"这件最朴素的事，能简单一点。

它也是开源的。因为我相信一个人能做的有限，而把代码交给社区，这件事才能走得更远、更久。如果它曾帮到你，愿你也把这份善意传下去。

> 愿每一个热爱阅读的人，都不再为获取知识而为难。

— 拾壹0x7f

---

## ⚠️ 关于接口（请务必阅读）

**为防止项目被滥用，本仓库隐藏了特定数据接口的实现。** 公开仓库只包含应用框架与前端界面，不含对接外部数据源的接口实现（该部分为独立私有模块）。

因此，**直接克隆本仓库无法开箱即用地构建运行**。如需自行构建，请**自行查找相关接口并实现**对应模块（参见下文「开发」一节中的依赖说明）。请理解此举是为了让项目健康、长久地存在。

## 📌 免责声明

- Olib 是一个**独立的开源第三方客户端**，**非**官方应用，与任何官方服务无关
- 本项目仅提供前端界面，所有书籍数据均来自**外部源**
- 用户须自行确保使用符合所在地区的相关法律法规
- 使用本软件即表示您已了解并接受以上条款

## ✨ 功能特点

| 功能              | 说明                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| 📖 **图书搜索**   | 支持书名、作者、关键词等多种检索                                                    |
| 💾 **下载管理**   | 内置 aria2 多线程下载，断点续传                                                     |
| 🔗 **多线路**     | 多个服务器线路可选，支持订阅/手动导入与一键测速                                     |
| 🔐 **多账号**     | 多账号切换，轻松管理                                                                |
| 📚 **书架与收藏** | 本地书架、收藏夹与下载记录                                                          |
| 🌙 **精致界面**   | 基于 Fluent 风格，支持 Win11 云母（Mica）特效                                       |
| 📡 **局域网共享** | 可将本地藏书通过局域网分享到其他设备,支持 OPDS 目录(KOReader、静读天下等可直接订阅) |
| 🆓 **完全免费**   | 无广告、无订阅、无隐藏费用                                                          |

## 🛠️ 技术栈

- **应用框架**：[Tauri 2](https://tauri.app/)（Rust 后端 + 系统 WebView）
- **后端**：Rust（`reqwest` / `rusqlite` / `tokio` / `axum`）
- **前端**：React + TypeScript + Vite
- **UI**：framer-motion、lucide-react、react-router-dom、react-hot-toast
- **下载器**：aria2（随包内置）

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18+（推荐 22）
- [Rust](https://www.rust-lang.org/tools/install) 稳定版工具链
- 各平台 Tauri 系统依赖：见 [Tauri 官方前置条件](https://tauri.app/start/prerequisites/)

### 开发

```bash
# 安装前端依赖
npm install

# 启动开发环境（前端 + Tauri 桌面壳）
npm run tauri dev
```

> ⚠️ 如前文「关于接口」所述，对接外部数据源的接口为独立私有模块，未包含在本仓库内。构建前需先自行实现该模块并以本地依赖方式接入（详见 `dev_docs/refs/`）。

### 构建

```bash
# 构建当前平台安装包
npm run tauri build
```

多平台安装包由 GitHub Actions 自动构建并发布到 [Releases](../../releases)。

## 🧪 测试 / 检查

```bash
# 前端类型检查
npm run build        # tsc + vite build

# Rust 端编译与静态检查
cd src-tauri
cargo build
cargo clippy

# Rust 集成测试（LAN/OPDS 等）
cargo test
```

## 🤝 贡献

欢迎一起把它做得更好：

1. Fork 本项目
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 提交更改：`git commit -m 'feat: 你的改动'`
4. 推送分支：`git push origin feat/your-feature`
5. 发起 Pull Request

## 🔗 联系作者

- **Bilibili**：[拾壹0x7f](https://space.bilibili.com/19276680)
- **GitHub**：[@shiyi-0x7f](https://github.com/shiyi-0x7f)
- **微信公众号**：拾壹0x7f

## 📄 许可证

本项目采用 [GNU GPLv3](LICENSE) 许可证开源。

---

<div align="center">

**开源 · 非盈利 · 永久免费**

如果它帮到了你，欢迎点一个 ⭐ Star —— 这是对作者最大的鼓励。

</div>
