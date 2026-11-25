import { ArrowDown, ArrowUp } from "lucide-react";
import type { SortKey } from "./useFileFilter";

/** 每列点击后的排序方向是固定的：名称升序，时间与大小降序（新的、大的在前） */
const COLUMNS: { key: SortKey; label: string; className: string; ascending: boolean }[] = [
  { key: "name", label: "名称", className: "bs-head-name", ascending: true },
  { key: "recent", label: "修改时间", className: "bs-cell-time", ascending: false },
  { key: "size", label: "大小", className: "bs-cell-size", ascending: false },
];

interface ListHeaderProps {
  sort: SortKey;
  onSortChange: (key: SortKey) => void;
  /** 当前显示的文件数（筛选后） */
  count: number;
}

/** 列表表头：点列名排序，当前排序列带箭头 */
export default function ListHeader({ sort, onSortChange, count }: ListHeaderProps) {
  return (
    <div className="bs-list-head">
      {COLUMNS.map((c) => (
        <button
          key={c.key}
          className={`bs-head-cell ${c.className} ${sort === c.key ? "is-active" : ""}`}
          onClick={() => onSortChange(c.key)}
          aria-sort={sort === c.key ? (c.ascending ? "ascending" : "descending") : "none"}
        >
          {c.label}
          {c.key === "name" && <span className="bs-head-count">{count}</span>}
          {sort === c.key && (c.ascending ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </button>
      ))}
      <span />
    </div>
  );
}
