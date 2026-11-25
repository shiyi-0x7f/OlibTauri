//! 通用工具：全局锁的中毒收敛。
//!
//! 项目内大量 `static Mutex` 若用 `lock().unwrap()`，一旦某线程持锁时 panic，
//! 其余线程会级联 panic 崩掉整个 app。统一改用 `lock_ignore_poison()`：
//! 忽略中毒标记、以最后写入的状态继续运行（这些全局态都是简单值，不存在
//! 半更新的不变量被破坏的问题）。

use std::sync::{Mutex, MutexGuard};

pub trait LockExt<T> {
    /// 获取锁并忽略中毒标记，替代 `lock().unwrap()`。
    fn lock_ignore_poison(&self) -> MutexGuard<'_, T>;
}

impl<T> LockExt<T> for Mutex<T> {
    fn lock_ignore_poison(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
