import React from "react";
import { AlertTriangle, UserPlus, Clock } from "lucide-react";

interface DownloadLimitDialogProps {
    message: string; // raw error string from backend
    onSwitchAccount: () => void;
    onClose: () => void;
}

/**
 * Parse the disallowDownloadMessage from the raw error to extract
 * the daily limit number and the remaining wait time.
 */
function parseErrorInfo(raw: string): { limit: string; waitTime: string } {
    let limit = "10";
    let waitTime = "";

    // Extract limit: e.g. "10&nbsp;downloads" or "10 downloads"
    const limitMatch = raw.match(/(\d+)\s*(?:&nbsp;|\s)*downloads/i);
    if (limitMatch) limit = limitMatch[1];

    // Extract wait time: e.g. "5&nbsp;hours&nbsp;31&nbsp;minutes"
    const waitMatch = raw.match(/wait\s+.*?(\d+\s*(?:&nbsp;|\s)*hours?\s*(?:&nbsp;|\s)*\d+\s*(?:&nbsp;|\s)*minutes?)/i);
    if (waitMatch) {
        waitTime = waitMatch[1].replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    } else {
        // Try just hours or just minutes
        const simpleWait = raw.match(/wait\s+.*?(\d+\s*(?:&nbsp;|\s)*(?:hours?|minutes?))/i);
        if (simpleWait) {
            waitTime = simpleWait[1].replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
        }
    }

    return { limit, waitTime };
}

const DownloadLimitDialog: React.FC<DownloadLimitDialogProps> = ({
    message, onSwitchAccount, onClose,
}) => {
    const { limit, waitTime } = parseErrorInfo(message);

    const handleBackdrop = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    return (
        <div className="modal-overlay" onClick={handleBackdrop}>
            <div className="modal" style={{
                maxWidth: "420px",
                width: "90vw",
                padding: "32px",
                textAlign: "center",
            }}>
                {/* Warning icon */}
                <div style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "50%",
                    background: "rgba(234, 179, 8, 0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 20px",
                }}>
                    <AlertTriangle size={28} style={{ color: "var(--warning)" }} />
                </div>

                <h3 style={{
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: "8px",
                }}>
                    今日下载额度已用完
                </h3>

                <p style={{
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6,
                    marginBottom: "20px",
                }}>
                    当前账号今日的 <span style={{ color: "var(--accent-light)", fontWeight: 600 }}>{limit} 次</span> 下载额度已全部使用。
                </p>

                {/* Wait time card */}
                {waitTime && (
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "12px 16px",
                        background: "var(--bg-tertiary)",
                        borderRadius: "var(--radius-md)",
                        marginBottom: "20px",
                        justifyContent: "center",
                    }}>
                        <Clock size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                            额度将在 <span style={{ color: "var(--accent-light)", fontWeight: 600 }}>{waitTime}</span> 后重置
                        </span>
                    </div>
                )}

                {/* Divider */}
                <div style={{ height: "1px", background: "var(--border)", marginBottom: "20px" }} />

                {/* Actions */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <button
                        className="btn btn-primary w-full"
                        onClick={() => { onSwitchAccount(); onClose(); }}
                        style={{ padding: "12px", fontSize: "14px", fontWeight: 600 }}
                    >
                        <UserPlus size={16} />
                        切换账号
                    </button>
                    <button
                        className="btn btn-ghost w-full"
                        onClick={onClose}
                        style={{ padding: "10px", fontSize: "13px" }}
                    >
                        稍后再试
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * Check if an error string indicates a download limit reached scenario.
 */
export function isDownloadLimitError(errStr: string): boolean {
    return errStr.includes("allowDownload") && errStr.includes("false");
}

export default DownloadLimitDialog;
