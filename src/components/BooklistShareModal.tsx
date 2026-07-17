import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { QrCode, Copy, Check, Loader2 } from "lucide-react";
import { encodeForQr, encodeFullUri, type BooklistShareData } from "../utils/booklistCodec";

interface Props {
    data: BooklistShareData;
    onClose: () => void;
}

/** 收藏页「分享书单」弹窗：二维码（手机端 Olib 扫码导入）+ 口令（复制后粘贴导入） */
export default function BooklistShareModal({ data, onClose }: Props) {
    const [qrSrc, setQrSrc] = useState<string | null>(null);
    const [passphrase, setPassphrase] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const [qrUri, fullUri] = await Promise.all([encodeForQr(data), encodeFullUri(data)]);
                setPassphrase(fullUri);
                setQrSrc(await invoke<string>("booklist_qr", { text: qrUri }));
            } catch (err) {
                console.error("Booklist share encode failed:", err);
                setError(String(err));
            }
        })();
    }, [data]);

    const handleCopy = () => {
        navigator.clipboard.writeText(passphrase);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{ minWidth: 420, maxWidth: 460 }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                    <div style={{
                        width: 40, height: 40, borderRadius: "var(--radius-md)",
                        background: "linear-gradient(135deg, rgba(var(--accent-rgb),0.2), rgba(var(--accent-rgb),0.1))",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <QrCode size={20} style={{ color: "var(--accent)" }} />
                    </div>
                    <div>
                        <div className="modal-title" style={{ margin: 0, fontSize: 17 }}>分享书单</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                            共 {data.entries.length} 本 · 手机端 Olib 扫码或粘贴口令即可导入
                        </div>
                    </div>
                </div>

                <div style={{ textAlign: "center", marginBottom: 20 }}>
                    {error ? (
                        <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "40px 0" }}>
                            生成失败：{error}
                        </p>
                    ) : qrSrc ? (
                        <div style={{
                            background: "white",
                            borderRadius: "var(--radius-lg)",
                            padding: 16,
                            display: "inline-block",
                            marginBottom: 14,
                        }}>
                            <img src={qrSrc} alt="书单二维码" style={{ width: 200, height: 200, display: "block" }} />
                        </div>
                    ) : (
                        <div style={{ padding: "80px 0" }}>
                            <Loader2 size={28} className="spin" style={{ color: "var(--text-muted)" }} />
                        </div>
                    )}

                    {passphrase && (
                        <>
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "10px 16px",
                                background: "var(--bg-tertiary)",
                                borderRadius: "var(--radius-md)",
                                border: "1px solid var(--border)",
                            }}>
                                <span style={{
                                    fontSize: 12,
                                    color: "var(--text-secondary)",
                                    fontFamily: "monospace",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    flex: 1,
                                    textAlign: "left",
                                }}>
                                    {passphrase}
                                </span>
                                <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={handleCopy}
                                    style={{ padding: "4px 8px", flexShrink: 0 }}
                                    title="复制口令"
                                >
                                    {copied ? <Check size={14} color="#22c55e" /> : <Copy size={14} />}
                                </button>
                            </div>
                            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
                                口令含完整书目元数据；二维码超长时自动降级为仅书目 ID
                            </p>
                        </>
                    )}
                </div>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>关闭</button>
                </div>
            </div>
        </div>
    );
}
