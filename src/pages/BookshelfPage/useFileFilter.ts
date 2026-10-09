import { useState, useMemo } from "react";
import type { FileInfo } from "../../api/bookshelf";
import { ALL, CATEGORIES, FOLDERS, OTHER, categoryOf } from "./fileKinds";

export type SortKey = "recent" | "name" | "size";

const SORT_STORAGE_KEY = "olib-bookshelf-sort";

function loadSort(): SortKey {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved === "recent" || saved === "name" || saved === "size") return saved;
  } catch {
    // 存储不可用（隐私模式等）时用默认排序
  }
  return "recent";
}

export interface FilterOption {
  label: string;
  count: number;
}

/** 书架的搜索 / 分类 / 子格式 / 排序。文件夹始终排在最前 */
export function useFileFilter(files: FileInfo[]) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  const [subFormat, setSubFormat] = useState<string | null>(null);
  const [sort, setSortState] = useState<SortKey>(loadSort);

  const setSort = (key: SortKey) => {
    setSortState(key);
    try {
      localStorage.setItem(SORT_STORAGE_KEY, key);
    } catch {
      // 记不住排序不影响使用
    }
  };

  const categoryOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const f of files) {
      const c = categoryOf(f);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const order = [FOLDERS, ...Object.keys(CATEGORIES), OTHER];
    return [
      { label: ALL, count: files.length },
      ...order.filter((c) => counts.has(c)).map((c) => ({ label: c, count: counts.get(c)! })),
    ];
  }, [files]);

  // 分类被删空（文件被删 / 刷新后没了）时回到「全部」
  const activeCategory = categoryOptions.some((o) => o.label === category) ? category : ALL;

  /** 当前分类下有 2 种以上格式时，提供按具体格式的二级筛选 */
  const subFormatOptions = useMemo<FilterOption[] | null>(() => {
    if (activeCategory === ALL || activeCategory === FOLDERS) return null;
    const counts = new Map<string, number>();
    for (const f of files) {
      if (categoryOf(f) !== activeCategory || !f.extension) continue;
      const ext = f.extension.toUpperCase();
      counts.set(ext, (counts.get(ext) ?? 0) + 1);
    }
    if (counts.size < 2) return null;
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  }, [files, activeCategory]);

  const activeSubFormat =
    subFormat && subFormatOptions?.some((o) => o.label === subFormat) ? subFormat : null;

  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = files.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q)) return false;
      if (activeCategory !== ALL && categoryOf(f) !== activeCategory) return false;
      if (activeSubFormat && f.extension.toUpperCase() !== activeSubFormat) return false;
      return true;
    });
    const byKey: Record<SortKey, (a: FileInfo, b: FileInfo) => number> = {
      // modified 是本地时间 "YYYY-MM-DD HH:MM:SS"，字符串序即时间序
      recent: (a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""),
      name: (a, b) => a.name.localeCompare(b.name, "zh-CN"),
      size: (a, b) => b.size - a.size,
    };
    return list.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || byKey[sort](a, b));
  }, [files, query, activeCategory, activeSubFormat, sort]);

  /** 点已选中的分类 = 回到「全部」 */
  const selectCategory = (label: string) => {
    setCategory(label === activeCategory ? ALL : label);
    setSubFormat(null);
  };

  return {
    query,
    setQuery,
    sort,
    setSort,
    categoryOptions,
    activeCategory,
    selectCategory,
    subFormatOptions,
    activeSubFormat,
    setSubFormat,
    visibleFiles,
  };
}
