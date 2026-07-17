import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
    Users, LogOut, Plus, Trash2, ChevronDown, X,
} from "lucide-react";

interface User {
    email: string;
    name?: string;
    downloads_today: number;
    downloads_limit: number;
}

interface Props {
    currentUser: User | null;
    onUserChanged: (user: User | null) => void;
    onShowLogin: () => void;
}

export default function AccountSwitcher({ currentUser, onUserChanged, onShowLogin }: Props) {
    const [open, setOpen] = useState(false);
    const [users, setUsers] = useState<User[]>([]);

    const loadUsers = async () => {
        try {
            const result: User[] = await invoke("get_all_users");
            setUsers(result);
        } catch (err) {
            console.error("Failed to load users:", err);
        }
    };

    useEffect(() => {
        if (open) loadUsers();
    }, [open]);

    const handleSwitch = async (email: string) => {
        try {
            const result: any = await invoke("switch_user", { email });
            if (result.success) {
                const user = users.find((u) => u.email === email);
                onUserChanged(user || null);
                setOpen(false);
            }
        } catch (err) {
            console.error("Failed to switch user:", err);
        }
    };

    const handleLogout = async () => {
        try {
            await invoke("logout");
            onUserChanged(null);
            setOpen(false);
        } catch (err) {
            console.error("Failed to logout:", err);
        }
    };

    const handleDelete = async (email: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const confirmed = await confirm(`确定要删除账号 ${email} 吗？`, {
            title: "删除确认",
            kind: "warning",
            okLabel: "删除",
            cancelLabel: "取消",
        });
        if (!confirmed) return;
        try {
            await invoke("delete_user", { email });
            await loadUsers();
            if (currentUser?.email === email) {
                await handleLogout();
            }
        } catch (err) {
            console.error("Failed to delete user:", err);
        }
    };

    return (
        <div style={{ position: "relative" }}>
            {/* Trigger */}
            {currentUser ? (
                <div
                    className="user-card"
                    onClick={() => setOpen(!open)}
                    style={{ cursor: "pointer" }}
                >
                    <div className="user-avatar">
                        {(currentUser.name || currentUser.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="user-info">
                        <div className="user-name">{currentUser.name || currentUser.email}</div>
                        <div className="user-email">
                            {currentUser.downloads_today}/{currentUser.downloads_limit} 下载
                        </div>
                    </div>
                    <ChevronDown
                        size={14}
                        style={{
                            color: "var(--text-muted)",
                            transition: "transform 150ms",
                            transform: open ? "rotate(180deg)" : "rotate(0deg)",
                        }}
                    />
                </div>
            ) : (
                <div
                    className="nav-item"
                    onClick={onShowLogin}
                    style={{ cursor: "pointer" }}
                >
                    <Users className="nav-icon" size={20} />
                    <span>登录</span>
                </div>
            )}

            {/* Dropdown */}
            {open && (
                <>
                    {/* Backdrop */}
                    <div
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 49,
                        }}
                        onClick={() => setOpen(false)}
                    />

                    {/* Panel */}
                    <div
                        style={{
                            position: "absolute",
                            bottom: "100%",
                            left: 0,
                            right: 0,
                            marginBottom: 8,
                            background: "var(--bg-secondary)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-lg)",
                            boxShadow: "var(--shadow-lg)",
                            zIndex: 50,
                            overflow: "hidden",
                            animation: "slideUp 150ms ease-out",
                        }}
                    >
                        {/* Header */}
                        <div
                            style={{
                                padding: "12px 14px 8px",
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                            }}
                        >
                            <span>账号列表</span>
                            <button
                                className="btn btn-ghost"
                                style={{ padding: 4 }}
                                onClick={() => setOpen(false)}
                            >
                                <X size={14} />
                            </button>
                        </div>

                        {/* User List */}
                        <div style={{ maxHeight: 200, overflowY: "auto", padding: "0 4px" }}>
                            {users.map((user) => (
                                <div
                                    key={user.email}
                                    onClick={() => handleSwitch(user.email)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "8px 10px",
                                        borderRadius: "var(--radius-md)",
                                        cursor: "pointer",
                                        transition: "background 150ms",
                                        background:
                                            user.email === currentUser?.email
                                                ? "var(--bg-active)"
                                                : "transparent",
                                    }}
                                    onMouseEnter={(e) => {
                                        if (user.email !== currentUser?.email)
                                            e.currentTarget.style.background = "var(--bg-hover)";
                                    }}
                                    onMouseLeave={(e) => {
                                        if (user.email !== currentUser?.email)
                                            e.currentTarget.style.background = "transparent";
                                    }}
                                >
                                    <div
                                        className="user-avatar"
                                        style={{ width: 28, height: 28, fontSize: 11 }}
                                    >
                                        {(user.name || user.email).charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontSize: 13,
                                                fontWeight: 450,
                                                color: "var(--text-primary)",
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {user.name || user.email}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 11,
                                                color: "var(--text-muted)",
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            {user.email}
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn-ghost"
                                        style={{ padding: 4, opacity: 0.5 }}
                                        onClick={(e) => handleDelete(user.email, e)}
                                        title="删除账号"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Actions */}
                        <div
                            style={{
                                borderTop: "1px solid var(--border)",
                                padding: "6px 4px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                            }}
                        >
                            <div
                                className="nav-item"
                                onClick={() => {
                                    setOpen(false);
                                    onShowLogin();
                                }}
                                style={{ padding: "8px 10px", fontSize: 13 }}
                            >
                                <Plus size={16} />
                                <span>添加账号</span>
                            </div>
                            {currentUser && (
                                <div
                                    className="nav-item"
                                    onClick={handleLogout}
                                    style={{
                                        padding: "8px 10px",
                                        fontSize: 13,
                                        color: "var(--error)",
                                    }}
                                >
                                    <LogOut size={16} />
                                    <span>退出登录</span>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
