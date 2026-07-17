import React from "react";
import { X, Loader2 } from "lucide-react";

interface ReaderModalProps {
    url: string;
    title: string;
    onClose: () => void;
}

const ReaderModal: React.FC<ReaderModalProps> = ({ url, title, onClose }) => {
    const [loading, setLoading] = React.useState(true);

    // Close on Escape
    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                display: "flex",
                flexDirection: "column",
                background: "var(--bg-primary)",
            }}
        >
            {/* Top Bar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                    flexShrink: 0,
                }}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="btn btn-ghost btn-icon btn-sm"
                    title="关闭预览"
                    style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        flexShrink: 0,
                    }}
                >
                    <X size={16} />
                </button>

                {/* Title */}
                <div
                    className="truncate"
                    style={{
                        flex: 1,
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                    }}
                    title={title}
                >
                    {title}
                </div>

            </div>

            {/* Loading indicator */}
            {loading && (
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "12px",
                        zIndex: 1,
                    }}
                >
                    <Loader2 size={32} className="spinner" style={{ color: "var(--accent)" }} />
                    <span
                        style={{
                            fontSize: "13px",
                            color: "var(--text-muted)",
                        }}
                    >
                        正在加载预览...
                    </span>
                </div>
            )}

            {/* Reader iframe */}
            <iframe
                src={url}
                title={title}
                onLoad={() => setLoading(false)}
                style={{
                    flex: 1,
                    border: "none",
                    width: "100%",
                    background: "white",
                    position: "relative",
                    zIndex: loading ? 0 : 2,
                }}
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
        </div>
    );
};

export default ReaderModal;
