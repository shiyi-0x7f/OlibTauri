//! 插件占用的磁盘空间统计：逐个已安装插件累加其安装目录下所有文件的大小。

use serde::Serialize;
use std::path::Path;

use super::installer;

#[derive(Debug, Serialize)]
pub struct PluginUsage {
    pub id: String,
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct PluginsUsage {
    pub total_bytes: u64,
    /// 只含磁盘上存在安装目录的插件，按占用从大到小
    pub plugins: Vec<PluginUsage>,
}

/// 遍历目录较慢（Calibre 有上千个文件），调用方应放到阻塞线程池里跑
pub fn compute() -> PluginsUsage {
    let mut plugins: Vec<PluginUsage> = super::all()
        .into_iter()
        .filter_map(|p| {
            let dir = installer::plugin_dir(&p.id);
            dir.is_dir().then(|| PluginUsage {
                bytes: dir_size(&dir),
                id: p.id,
                name: p.name,
            })
        })
        .collect();
    plugins.sort_by_key(|p| std::cmp::Reverse(p.bytes));
    PluginsUsage {
        total_bytes: plugins.iter().map(|p| p.bytes).sum(),
        plugins,
    }
}

/// 目录下所有文件大小之和；读不到的条目跳过（统计不该因单个文件出错而整体失败）。
/// 不跟随符号链接，避免重复计算或绕出插件目录。
fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => dir_size(&entry.path()),
            Ok(t) if t.is_file() => entry.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dir_size_sums_nested_files() {
        let dir = std::env::temp_dir().join(format!("olib-usage-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::write(dir.join("top.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("a/b/deep.bin"), vec![0u8; 23]).unwrap();

        assert_eq!(dir_size(&dir), 123);
        assert_eq!(dir_size(&dir.join("missing")), 0);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
