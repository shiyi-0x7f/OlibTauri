import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../../hooks/useTheme";

export default function AboutSection() {
    const { primaryColor } = useTheme();
    const [showQrModal, setShowQrModal] = useState(false);
    const [hoveredCard, setHoveredCard] = useState<string | null>(null);
    const [currentVersion, setCurrentVersion] = useState("...");

    useEffect(() => {
        invoke("get_app_version").then((v: any) => setCurrentVersion(v)).catch(() => {});
    }, []);

    const contactItems = [
        {
            id: "bilibili",
            icon: "/bilibili.svg",
            label: "Bilibili",
            subtitle: "关注频道",
            url: "https://space.bilibili.com/19276680",
            gradient: "linear-gradient(135deg, #fb7299, #e8456c)",
            shadowColor: "rgba(251, 114, 153, 0.3)",
        },
        {
            id: "github",
            icon: "/github.svg",
            label: "GitHub",
            subtitle: "查看源码",
            url: "https://github.com/shiyi-0x7f",
            gradient: "linear-gradient(135deg, #a78bfa, #7c3aed)",
            shadowColor: "rgba(124, 58, 237, 0.3)",
        },
        {
            id: "wechat",
            icon: "/wechat.svg",
            label: "公众号",
            subtitle: "扫码关注",
            url: null,
            gradient: "linear-gradient(135deg, #22c55e, #16a34a)",
            shadowColor: "rgba(34, 197, 94, 0.3)",
        },
    ];

    const handleOpen = async (url: string | null) => {
        if (url) {
            try {
                await openUrl(url);
            } catch (e) {
                console.error("Failed to open URL:", e);
            }
        } else {
            setShowQrModal(true);
        }
    };

    return (
        <>
            <div className="card settings-grid-full">
                <div className="settings-group">
                    <div className="settings-group-title">关于</div>

                    {/* App Identity - Hero */}
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "14px",
                        padding: "16px",
                        borderRadius: "var(--radius-md)",
                        background: `linear-gradient(135deg, ${primaryColor}08, ${primaryColor}03)`,
                        border: `1px solid ${primaryColor}15`,
                        marginBottom: "20px",
                    }}>
                        <img
                            src="/icon.png"
                            alt="Olib·开源图书"
                            style={{
                                width: "52px",
                                height: "52px",
                                borderRadius: "14px",
                                boxShadow: `0 4px 16px ${primaryColor}25`,
                            }}
                        />
                        <div style={{ flex: 1 }}>
                            <div style={{
                                fontSize: "20px",
                                fontWeight: 700,
                                color: "var(--text-primary)",
                                letterSpacing: "-0.3px",
                                lineHeight: 1.2,
                            }}>
                                Olib·开源图书
                            </div>
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                marginTop: "6px",
                            }}>
                                <span style={{
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    color: primaryColor,
                                    background: `${primaryColor}15`,
                                    padding: "2px 10px",
                                    borderRadius: "20px",
                                    border: `1px solid ${primaryColor}30`,
                                }}>
                                    v{currentVersion}
                                </span>
                                <span style={{
                                    fontSize: "11px",
                                    color: "var(--text-muted)",
                                }}>
                                    免费开源 · 第三方客户端
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Contact Section - Compact */}
                    <div style={{ marginBottom: "20px" }}>
                        <div style={{
                            fontSize: "13px",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                            marginBottom: "10px",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                        }}>
                            📬 联系作者
                        </div>
                        <div style={{
                            display: "flex",
                            gap: "8px",
                        }}>
                            {contactItems.map((item) => {
                                const isHovered = hoveredCard === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => handleOpen(item.url)}
                                        onMouseEnter={() => setHoveredCard(item.id)}
                                        onMouseLeave={() => setHoveredCard(null)}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            padding: "8px 14px",
                                            borderRadius: "var(--radius-md)",
                                            background: isHovered
                                                ? "var(--bg-secondary)"
                                                : "var(--bg-tertiary)",
                                            border: `1px solid ${isHovered ? `${primaryColor}40` : "var(--border)"}`,
                                            transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                                            cursor: "pointer",
                                            transform: isHovered ? "translateY(-2px)" : "translateY(0)",
                                            boxShadow: isHovered
                                                ? `0 4px 14px ${item.shadowColor}`
                                                : "none",
                                            fontFamily: "var(--font)",
                                            position: "relative",
                                            overflow: "hidden",
                                        }}
                                    >
                                        {/* Gradient accent bar at left */}
                                        <div style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            bottom: 0,
                                            width: isHovered ? "3px" : "0px",
                                            background: item.gradient,
                                            transition: "width 0.25s ease",
                                            borderRadius: "var(--radius-md) 0 0 var(--radius-md)",
                                        }} />
                                        <div style={{
                                            width: "28px",
                                            height: "28px",
                                            borderRadius: "8px",
                                            background: isHovered ? item.gradient : "var(--bg-secondary)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            transition: "all 0.25s ease",
                                            flexShrink: 0,
                                        }}>
                                            <img
                                                src={item.icon}
                                                alt={item.label}
                                                style={{
                                                    width: "16px",
                                                    height: "16px",
                                                    filter: isHovered ? "brightness(0) invert(1)" : "none",
                                                    transition: "filter 0.25s ease",
                                                }}
                                            />
                                        </div>
                                        <span style={{
                                            fontSize: "12px",
                                            fontWeight: 500,
                                            color: "var(--text-secondary)",
                                            whiteSpace: "nowrap",
                                        }}>
                                            {item.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Notices - Eye-catching */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "10px 14px",
                            borderRadius: "var(--radius-md)",
                            background: "rgba(234, 179, 8, 0.06)",
                            borderLeft: "3px solid #eab308",
                        }}>
                            <span style={{ fontSize: "16px", flexShrink: 0 }}>⚠️</span>
                            <span style={{
                                fontSize: "12px",
                                fontWeight: 600,
                                color: "#eab308",
                                lineHeight: 1.5,
                            }}>
                                本软件为第三方客户端，与 Z-Library 官方无任何关联
                            </span>
                        </div>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "10px 14px",
                            borderRadius: "var(--radius-md)",
                            background: "rgba(59, 130, 246, 0.06)",
                            borderLeft: "3px solid #3b82f6",
                        }}>
                            <span style={{ fontSize: "16px", flexShrink: 0 }}>🚫</span>
                            <span style={{
                                fontSize: "12px",
                                fontWeight: 600,
                                color: "#60a5fa",
                                lineHeight: 1.5,
                            }}>
                                本软件完全免费、非盈利，不接受任何广告与商业合作
                            </span>
                        </div>
                    </div>

                    {/* Copyright footer */}
                    <div style={{
                        textAlign: "center",
                        padding: "12px 0 4px",
                        borderTop: "1px solid var(--border)",
                    }}>
                        <div style={{
                            fontSize: "11px",
                            color: "var(--text-muted)",
                        }}>
                            Copyright © 2026 shiyi0x7f. All rights reserved.
                        </div>
                    </div>
                </div>
            </div>

            {/* WeChat QR Code Modal */}
            {showQrModal && (
                <div
                    className="modal-overlay"
                    onClick={() => setShowQrModal(false)}
                    style={{ zIndex: 1000 }}
                >
                    <div
                        className="modal"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "16px",
                            padding: "32px",
                            minWidth: "auto",
                            maxWidth: "320px",
                        }}
                    >
                        <div style={{
                            fontSize: "16px",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                        }}>
                            关注公众号
                        </div>
                        <div style={{
                            padding: "12px",
                            background: "#fff",
                            borderRadius: "var(--radius-md)",
                            boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
                        }}>
                            <img
                                src="/wechat_qr.jpg"
                                alt="公众号二维码"
                                style={{
                                    width: "180px",
                                    height: "180px",
                                    display: "block",
                                }}
                            />
                        </div>
                        <div style={{
                            fontSize: "14px",
                            fontWeight: 500,
                            color: "var(--text-secondary)",
                        }}>
                            拾壹0x7f
                        </div>
                        <div style={{
                            fontSize: "12px",
                            color: "var(--text-muted)",
                        }}>
                            微信扫码关注
                        </div>
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setShowQrModal(false)}
                            style={{ marginTop: 4 }}
                        >
                            关闭
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
