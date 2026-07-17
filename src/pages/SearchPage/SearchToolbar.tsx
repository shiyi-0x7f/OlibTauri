import { Grid, List } from "lucide-react";
import type { ViewMode } from "./types";

interface SearchToolbarProps {
    totalItems: number;
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
}

export default function SearchToolbar({ totalItems, viewMode, onViewModeChange }: SearchToolbarProps) {
    return (
        <div className="flex items-center justify-between" style={{ marginBottom: "12px" }}>
            <div className="text-sm text-muted">
                共找到 {totalItems} 本书籍
            </div>
            <div style={{
                display: "flex",
                gap: "2px",
                background: "var(--bg-tertiary)",
                borderRadius: "var(--radius-md)",
                padding: "3px",
            }}>
                <button
                    className="btn"
                    onClick={() => onViewModeChange("grid")}
                    title="网格视图"
                    style={{
                        padding: "6px 10px",
                        borderRadius: "var(--radius-sm)",
                        border: "none",
                        background: viewMode === "grid" ? "var(--bg-surface)" : "transparent",
                        color: viewMode === "grid" ? "var(--text-primary)" : "var(--text-muted)",
                        boxShadow: viewMode === "grid" ? "var(--shadow-sm)" : "none",
                        cursor: "pointer",
                        transition: "all var(--transition-fast)",
                    }}
                >
                    <Grid size={15} />
                </button>
                <button
                    className="btn"
                    onClick={() => onViewModeChange("list")}
                    title="列表视图"
                    style={{
                        padding: "6px 10px",
                        borderRadius: "var(--radius-sm)",
                        border: "none",
                        background: viewMode === "list" ? "var(--bg-surface)" : "transparent",
                        color: viewMode === "list" ? "var(--text-primary)" : "var(--text-muted)",
                        boxShadow: viewMode === "list" ? "var(--shadow-sm)" : "none",
                        cursor: "pointer",
                        transition: "all var(--transition-fast)",
                    }}
                >
                    <List size={15} />
                </button>
            </div>
        </div>
    );
}
