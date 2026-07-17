import CustomSelect from "./CustomSelect";
import { LANGUAGES, SEARCHMODE, EXTENSIONS } from "./constants";

interface FilterPanelProps {
    selectedLang: string;
    selectedExt: string;
    selectedOrder: string;
    exactMatch: boolean;
    searchLimit: number;
    onLangChange: (v: string) => void;
    onExtChange: (v: string) => void;
    onOrderChange: (v: string) => void;
    onExactMatchChange: (v: boolean) => void;
    onSearchLimitChange: (v: number) => void;
}

export default function FilterPanel({
    selectedLang, selectedExt, selectedOrder, exactMatch, searchLimit,
    onLangChange, onExtChange, onOrderChange, onExactMatchChange, onSearchLimitChange,
}: FilterPanelProps) {
    return (
        <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "10px",
            alignItems: "center",
            padding: "12px 14px",
            marginBottom: "12px",
            background: "var(--bg-secondary)",
            borderRadius: "var(--radius-lg)",
            border: "1px solid var(--border)",
        }}>
            <CustomSelect label="语言" value={selectedLang} options={LANGUAGES} onChange={onLangChange} />
            <CustomSelect label="格式" value={selectedExt} options={EXTENSIONS} onChange={onExtChange} />
            <CustomSelect label="排序" value={selectedOrder} options={SEARCHMODE} onChange={onOrderChange} />
            <label style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12px",
                color: "var(--text-secondary)",
                cursor: "pointer",
                userSelect: "none",
            }}>
                <input
                    type="checkbox"
                    checked={exactMatch}
                    onChange={(e) => onExactMatchChange(e.target.checked)}
                    style={{
                        accentColor: "var(--accent)",
                        width: "14px",
                        height: "14px",
                        cursor: "pointer",
                    }}
                />
                精确匹配
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
                <span className="text-muted" style={{ fontSize: "12px", whiteSpace: "nowrap" }}>每页</span>
                <select
                    className="select"
                    value={searchLimit}
                    onChange={(e) => onSearchLimitChange(Number(e.target.value))}
                    style={{ fontSize: "12px", padding: "4px 8px", minWidth: "60px" }}
                >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                </select>
            </div>
        </div>
    );
}
