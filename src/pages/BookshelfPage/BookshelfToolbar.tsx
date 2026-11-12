import {
  BookOpen,
  FileText,
  Film,
  Folder,
  Image,
  LayoutGrid,
  Package,
  Search,
  X,
} from "lucide-react";
import type { FilterOption } from "./useFileFilter";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  全部: LayoutGrid,
  文件夹: Folder,
  电子书: BookOpen,
  文档: FileText,
  图片: Image,
  音视频: Film,
  其他: Package,
};

/** 搜索框（放在页头，给分类标签腾出整行宽度） */
export function BookshelfSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (q: string) => void;
}) {
  return (
    <div className="bs-search">
      <Search size={14} className="bs-search-icon" />
      <input
        className="bs-search-input"
        placeholder="搜索文件名…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onQueryChange("")}
      />
      {query && (
        <button className="bs-search-clear" onClick={() => onQueryChange("")} title="清空">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

interface BookshelfToolbarProps {
  categoryOptions: FilterOption[];
  activeCategory: string;
  onCategorySelect: (label: string) => void;
  subFormatOptions: FilterOption[] | null;
  activeSubFormat: string | null;
  onSubFormatSelect: (label: string | null) => void;
}

/** 书架工具栏：分类标签（整行），子格式（按需）。搜索在页头，排序在列表表头 */
export default function BookshelfToolbar({
  categoryOptions,
  activeCategory,
  onCategorySelect,
  subFormatOptions,
  activeSubFormat,
  onSubFormatSelect,
}: BookshelfToolbarProps) {
  return (
    <div className="bs-toolbar">
      <div className="bs-toolbar-row">
        <div className="bs-tabs" role="tablist">
          {categoryOptions.map((o) => {
            const Icon = CATEGORY_ICONS[o.label] ?? Package;
            return (
              <button
                key={o.label}
                role="tab"
                aria-selected={activeCategory === o.label}
                className={`bs-tab ${activeCategory === o.label ? "is-active" : ""}`}
                onClick={() => onCategorySelect(o.label)}
              >
                <Icon size={13} />
                {o.label}
                <span className="bs-tab-count">{o.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {subFormatOptions && (
        <div className="bs-subformats">
          <button
            className={`bs-subformat ${activeSubFormat === null ? "is-active" : ""}`}
            onClick={() => onSubFormatSelect(null)}
          >
            全部格式
          </button>
          {subFormatOptions.map((o) => (
            <button
              key={o.label}
              className={`bs-subformat ${activeSubFormat === o.label ? "is-active" : ""}`}
              onClick={() => onSubFormatSelect(o.label)}
            >
              {o.label}
              <span className="bs-tab-count">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
