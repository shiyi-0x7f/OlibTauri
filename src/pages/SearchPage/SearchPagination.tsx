import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface Props {
  currentPage: number;
  totalPages: number;
  loading: boolean;
  onGo: (page: number) => void;
}

export default function SearchPagination({ currentPage, totalPages, loading, onGo }: Props) {
  if (totalPages <= 1) return null;
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "12px 0 24px",
      }}
    >
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => onGo(1)}
        disabled={!hasPrev || loading}
        title="第一页"
      >
        <ChevronsLeft size={16} />
      </button>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => onGo(currentPage - 1)}
        disabled={!hasPrev || loading}
      >
        <ChevronLeft size={16} />
        上一页
      </button>

      <div
        style={{
          padding: "6px 18px",
          background: "var(--bg-tertiary)",
          borderRadius: "var(--radius-md)",
          fontSize: "13px",
          fontWeight: 500,
          color: "var(--text-primary)",
          minWidth: "120px",
          textAlign: "center",
          border: "1px solid var(--border)",
        }}
      >
        <span style={{ color: "var(--accent-light)", fontWeight: 700 }}>{currentPage}</span>
        <span className="text-muted"> / {totalPages}</span>
      </div>

      <button
        className="btn btn-secondary btn-sm"
        onClick={() => onGo(currentPage + 1)}
        disabled={!hasNext || loading}
      >
        下一页
        <ChevronRight size={16} />
      </button>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => onGo(totalPages)}
        disabled={!hasNext || loading}
        title="最后一页"
      >
        <ChevronsRight size={16} />
      </button>
    </div>
  );
}
