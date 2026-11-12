//! 微信读书：扫码会话 + 移动端接口直连（替代原 API Key 网关）。
//! 设计与接口映射见 `dev_docs/weread-mobile-session.md`。

pub mod api;
pub mod ask;
pub mod client;
pub mod import;
pub mod qr_login;
pub mod recommend;
pub mod session;

pub use session::init;
