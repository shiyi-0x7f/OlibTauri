import { useState, useEffect, useRef } from "react";
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import toast from "react-hot-toast";
import {
  Search, Download, BookOpen, Settings, Sparkles, Heart, CheckCircle2, BookMarked, ArrowUpCircle, Wand2, Puzzle,
} from "lucide-react";
import SearchPage from "./pages/SearchPage";
import DownloadPage from "./pages/DownloadPage";
import BookshelfPage from "./pages/BookshelfPage";
import SettingsPage from "./pages/SettingsPage";
import DiscoverPage from "./pages/DiscoverPage";
import PrescriberPage from "./pages/PrescriberPage";
import FavoritesPage from "./pages/FavoritesPage";
import WereadPage from "./pages/WereadPage";
import PluginsPage from "./pages/PluginsPage";
import LoginDialog from "./components/LoginDialog";
import AccountSwitcher from "./components/AccountSwitcher";
import CommandPalette from "./components/CommandPalette";
import { useTheme } from "./hooks/useTheme";

interface User {
  email: string;
  name?: string;
  downloads_today: number;
  downloads_limit: number;
}

function App() {
  // Initialize theme system
  useTheme();

  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const startupNavigated = useRef(false);

  // Navigate to configured startup page on first load
  useEffect(() => {
    if (startupNavigated.current) return;
    startupNavigated.current = true;
    invoke("get_config").then((cfg: any) => {
      const startupPage = cfg?.startup_page;
      if (startupPage && startupPage !== "/") {
        navigate(startupPage, { replace: true });
      }
    }).catch((err: any) => {
      console.warn("Failed to read startup page config:", err);
    });
  }, []);

  // Listen for programmatic navigation requests from child components
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail;
      if (path) navigate(path);
    };
    window.addEventListener("olib:navigate", handler);
    return () => window.removeEventListener("olib:navigate", handler);
  }, [navigate]);

  // Load current user on startup
  useEffect(() => {
    const loadUser = async () => {
      try {
        const user: User | null = await invoke("get_current_user");
        setCurrentUser(user);
        // Refresh download quota from API in background
        if (user) {
          invoke("refresh_user_downloads").then((refreshed: any) => {
            if (refreshed) setCurrentUser(refreshed);
          }).catch((err: any) => {
            console.warn("Failed to refresh download quota:", err);
          });
        }
      } catch (err) {
        console.error("Failed to load current user:", err);
      }
    };
    loadUser();
  }, []);

  // Listen for login dialog requests from child pages (e.g. download limit dialog)
  useEffect(() => {
    const handler = () => setShowLogin(true);
    window.addEventListener("olib:show-login", handler);
    return () => window.removeEventListener("olib:show-login", handler);
  }, []);

  // Check for updates on startup
  useEffect(() => {
    invoke("check_for_updates")
      .then((info: any) => {
        if (info?.has_update) {
          toast.custom(
            (t) => (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "16px 20px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "16px",
                  boxShadow:
                    "0 8px 30px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.05) inset",
                  opacity: t.visible ? 1 : 0,
                  transform: t.visible
                    ? "translateY(0) scale(1)"
                    : "translateY(10px) scale(0.95)",
                  transition:
                    "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                  color: "var(--text-primary)",
                  minWidth: "280px",
                  maxWidth: "400px",
                  backdropFilter: "blur(20px)",
                }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    background: "rgba(99, 102, 241, 0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <ArrowUpCircle color="#6366f1" size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      marginBottom: "2px",
                      color: "var(--text-primary)",
                    }}
                  >
                    发现新版本 v{info.latest_version}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                    }}
                  >
                    当前版本 v{info.current_version}
                  </div>
                </div>
                <button
                  onClick={() => {
                    openUrl(
                      "https://www.11xy.cn/projects/olib-%E7%94%B5%E8%84%91%E7%AB%AF"
                    );
                    toast.dismiss(t.id);
                  }}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "8px",
                    background: "#6366f1",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: 600,
                    border: "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontFamily: "var(--font)",
                  }}
                >
                  前往更新
                </button>
              </div>
            ),
            { duration: 15000 }
          );
        }
      })
      .catch((err: any) => {
        console.warn("Update check failed:", err);
      });
  }, []);

  // Listen for custom in-app download notifications from rust backend
  useEffect(() => {
    const unlisten = listen("download-status", (event: any) => {
      const { status, title, message } = event.payload;
      
      if (status === "success") {
        toast.custom((t) => (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "16px 20px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.05) inset",
              opacity: t.visible ? 1 : 0,
              transform: t.visible ? "translateY(0) scale(1)" : "translateY(10px) scale(0.95)",
              transition: "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
              color: "var(--text-primary)",
              minWidth: "280px",
              maxWidth: "380px",
              backdropFilter: "blur(20px)",
            }}
          >
            <div style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              background: "rgba(34, 197, 94, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0
            }}>
              <CheckCircle2 color="#22c55e" size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "2px", color: "var(--text-primary)" }}>
                下载完成
              </div>
              <div className="truncate" style={{ fontSize: "12px", color: "var(--text-secondary)" }} title={title}>
                《{title}》
              </div>
            </div>
          </div>
        ), { duration: 4000 });
      } else {
        toast.error(message || `下载失败: ${title}`, { duration: 5000 });
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Listen for plugin install results from rust backend
  useEffect(() => {
    const unlisten = listen("plugin-status", (event: any) => {
      const { status, message } = event.payload;
      if (status === "success") {
        toast.success(message || "插件安装完成", { duration: 4000 });
      } else {
        toast.error(message || "插件安装失败", { duration: 6000 });
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Listen for plugin task results (format conversion etc.) from rust backend
  useEffect(() => {
    const unlisten = listen("plugin-task", (event: any) => {
      const { status, title, message } = event.payload;
      if (status === "success") {
        toast.success(message || `《${title}》处理完成`, { duration: 4000 });
      } else {
        toast.error(`《${title}》${message || "处理失败"}`, { duration: 6000 });
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const navItems = [
    { path: "/discover", icon: Sparkles, label: "发现" },
    { path: "/", icon: Search, label: "搜索" },
    { path: "/prescriber", icon: Wand2, label: "AI寻书" },
    { path: "/favorites", icon: Heart, label: "收藏" },
    { path: "/weread", icon: BookMarked, label: "微信读书" },
    { path: "/downloads", icon: Download, label: "下载" },
    { path: "/bookshelf", icon: BookOpen, label: "书架" },
    { path: "/plugins", icon: Puzzle, label: "插件" },
    { path: "/settings", icon: Settings, label: "设置" },
  ];

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">O</div>
          <span className="sidebar-title">Olib·开源图书</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
              end={item.path === "/"}
            >
              <item.icon className="nav-icon" size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <AccountSwitcher
            currentUser={currentUser}
            onUserChanged={(user) => setCurrentUser(user)}
            onShowLogin={() => setShowLogin(true)}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <Routes>
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/prescriber" element={<PrescriberPage />} />
          <Route path="/" element={<SearchPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/weread" element={<WereadPage />} />
          <Route path="/downloads" element={<DownloadPage />} />
          <Route path="/bookshelf" element={<BookshelfPage />} />
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* Login Dialog */}
      {showLogin && (
        <LoginDialog
          onClose={() => setShowLogin(false)}
          onLogin={() => {
            // Reload user from backend to get full user object
            invoke("get_current_user").then((user: any) => {
              setCurrentUser(user);
            });
            setShowLogin(false);
          }}
        />
      )}

      {/* Command Palette (Ctrl+Space) */}
      <CommandPalette />
    </div>
  );
}

export default App;
