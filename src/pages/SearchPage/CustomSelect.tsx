import { useState, useRef } from "react";
import { ChevronDown } from "lucide-react";

interface CustomSelectProps {
    label: string;
    value: string;
    options: Record<string, string | null>;
    onChange: (key: string) => void;
}

export default function CustomSelect({ label, value, options, onChange }: CustomSelectProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    return (
        <div ref={ref} style={{ position: "relative", minWidth: "120px" }}>
            <button
                className="btn btn-ghost btn-sm"
                onClick={() => setOpen(!open)}
                style={{
                    width: "100%",
                    justifyContent: "space-between",
                    fontSize: "12px",
                    padding: "6px 10px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    gap: "6px",
                    whiteSpace: "nowrap",
                }}
            >
                <span className="text-muted" style={{ marginRight: "4px" }}>{label}:</span>
                {value}
                <ChevronDown size={12} style={{
                    transition: "transform 0.2s",
                    transform: open ? "rotate(180deg)" : "none",
                }} />
            </button>
            {open && (
                <>
                    <div
                        style={{ position: "fixed", inset: 0, zIndex: 99 }}
                        onClick={() => setOpen(false)}
                    />
                    <div className="search-scroll-container" style={{
                        position: "absolute",
                        top: "calc(100% + 4px)",
                        left: 0,
                        minWidth: "140px",
                        maxHeight: "240px",
                        overflowY: "auto",
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        boxShadow: "var(--shadow-lg)",
                        zIndex: 100,
                        padding: "4px",
                    }}>
                        {Object.keys(options).map((key) => (
                            <button
                                key={key}
                                onClick={() => { onChange(key); setOpen(false); }}
                                style={{
                                    display: "block",
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "6px 10px",
                                    fontSize: "12px",
                                    border: "none",
                                    borderRadius: "var(--radius-sm)",
                                    background: key === value ? "var(--accent)" : "transparent",
                                    color: key === value ? "#fff" : "var(--text-primary)",
                                    cursor: "pointer",
                                    transition: "background 0.15s",
                                    whiteSpace: "nowrap",
                                }}
                                onMouseEnter={(e) => {
                                    if (key !== value) e.currentTarget.style.background = "var(--bg-tertiary)";
                                }}
                                onMouseLeave={(e) => {
                                    if (key !== value) e.currentTarget.style.background = "transparent";
                                }}
                            >
                                {key}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
