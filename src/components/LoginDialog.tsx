import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogIn, Loader2, X, Mail, Lock, ArrowRight } from "lucide-react";

interface Props {
    onClose: () => void;
    onLogin: (name: string) => void;
}

// Errors that indicate a server/network issue (user should try switching nodes)
const isNetworkError = (error: string) => {
    const networkKeywords = [
        "网络连接失败", "网络错误", "服务器响应异常", "稍后重试",
        "节点均不可用", "timeout", "Request failed", "Parse failed",
        "所有节点",
    ];
    return networkKeywords.some(k => error.includes(k));
};

export default function LoginDialog({ onClose, onLogin }: Props) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [loginAttempts, setLoginAttempts] = useState(0);

    const handleLogin = async () => {
        if (!email.trim() || !password.trim()) {
            setError("请输入邮箱和密码");
            return;
        }

        setLoading(true);
        setError("");

        try {
            const result: any = await invoke("login", {
                email: email.trim(),
                password: password.trim(),
            });

            if (result.success) {
                onLogin(result.user_name || "User");
            } else {
                // Translate common API error messages to Chinese
                const errorMap: Record<string, string> = {
                    "Incorrect email or password": "邮箱或密码错误，请检查后重试",
                    "Unknown error": "未知错误，请稍后重试",
                    "Too many attempts": "登录尝试次数过多，请稍后再试",
                    "Account is banned": "该账号已被禁用",
                };
                const msg = result.message || "登录失败";
                setError(errorMap[msg] || msg);
                setLoginAttempts(prev => prev + 1);
            }
        } catch (err: any) {
            console.error("Login error:", err);
            const errStr = typeof err === "string" ? err : "";
            if (errStr.includes("Request failed") || errStr.includes("timeout")) {
                setError("网络连接失败，请检查网络或尝试切换节点");
            } else if (errStr.includes("Parse failed")) {
                setError("服务器响应异常，请稍后重试");
            } else {
                setError(errStr || "网络错误，请稍后重试");
            }
            setLoginAttempts(prev => prev + 1);
        }

        setLoading(false);
    };

    const handleGoToSettings = () => {
        onClose();
        // Navigate to settings page
        window.dispatchEvent(new CustomEvent("olib:navigate", { detail: "/settings" }));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleLogin();
    };

    // Show the switch-node tip when: network error, or failed 2+ times
    const showSwitchNodeTip = error && (isNetworkError(error) || loginAttempts >= 2);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
                    <h2 className="modal-title" style={{ margin: 0 }}>登录</h2>
                    <button className="btn btn-ghost btn-icon" onClick={onClose}>
                        <X size={18} />
                    </button>
                </div>

                <div style={{
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    marginBottom: 16,
                    padding: "8px 12px",
                    borderRadius: "var(--radius-md)",
                    background: "var(--bg-tertiary)",
                    border: "1px solid var(--border)",
                    lineHeight: 1.6,
                }}>
                    💡 请使用你的 <strong style={{ color: "var(--text-secondary)" }}>Z-Library</strong> 账号登录。如果没有账号，请先前往 Z-Library 官网注册。
                </div>
                <div className="flex flex-col gap-4">
                    <div className="input-group">
                        <label className="input-label">邮箱</label>
                        <div style={{ position: "relative" }}>
                            <Mail
                                size={16}
                                style={{
                                    position: "absolute",
                                    left: 12,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    color: "var(--text-muted)",
                                }}
                            />
                            <input
                                className="input w-full"
                                style={{ paddingLeft: 36 }}
                                type="email"
                                placeholder="your@email.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                        </div>
                    </div>

                    <div className="input-group">
                        <label className="input-label">密码</label>
                        <div style={{ position: "relative" }}>
                            <Lock
                                size={16}
                                style={{
                                    position: "absolute",
                                    left: 12,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    color: "var(--text-muted)",
                                }}
                            />
                            <input
                                className="input w-full"
                                style={{ paddingLeft: 36 }}
                                type="password"
                                placeholder="请输入密码"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                        </div>
                    </div>

                    {error && (
                        <div
                            style={{
                                padding: "8px 12px",
                                background: "rgba(239, 68, 68, 0.1)",
                                border: "1px solid rgba(239, 68, 68, 0.2)",
                                borderRadius: "var(--radius-md)",
                                color: "var(--error)",
                                fontSize: 13,
                            }}
                        >
                            {error}
                        </div>
                    )}

                    {/* Tip: switch server nodes */}
                    {showSwitchNodeTip && (
                        <div
                            style={{
                                padding: "10px 14px",
                                background: "rgba(251, 191, 36, 0.08)",
                                border: "1px solid rgba(251, 191, 36, 0.25)",
                                borderRadius: "var(--radius-md)",
                                fontSize: 12,
                                lineHeight: 1.6,
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "8px",
                            }}
                        >
                            <span style={{ fontSize: "14px", lineHeight: "18px", flexShrink: 0 }}>⚡</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
                                    登录不稳定？试试切换线路
                                </div>
                                <div style={{ color: "var(--text-muted)", marginTop: 2 }}>
                                    前往 <strong>设置 → 服务器节点</strong>，点击「自动选最快」或手动选择其他节点。
                                </div>
                                <button
                                    onClick={handleGoToSettings}
                                    style={{
                                        marginTop: 6,
                                        padding: "4px 10px",
                                        fontSize: "11px",
                                        fontWeight: 600,
                                        color: "var(--accent)",
                                        background: "rgba(var(--accent-rgb, 99, 102, 241), 0.1)",
                                        border: "1px solid rgba(var(--accent-rgb, 99, 102, 241), 0.2)",
                                        borderRadius: "6px",
                                        cursor: "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "4px",
                                        transition: "all 0.15s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = "rgba(var(--accent-rgb, 99, 102, 241), 0.18)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = "rgba(var(--accent-rgb, 99, 102, 241), 0.1)";
                                    }}
                                >
                                    前往设置 <ArrowRight size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>
                        取消
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleLogin}
                        disabled={loading}
                    >
                        {loading ? (
                            <Loader2 size={16} className="spinner" />
                        ) : (
                            <LogIn size={16} />
                        )}
                        {loading ? "登录中..." : "登录"}
                    </button>
                </div>
            </div>
        </div>
    );
}
