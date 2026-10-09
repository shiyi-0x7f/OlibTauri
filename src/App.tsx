import { useState, useEffect, useRef } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import toast from "react-hot-toast";
import {
  Search,
  BookOpen,
  Settings,
  Sparkles,
  Heart,
  CheckCircle2,
  BookMarked,
  ArrowUpCircle,
  Puzzle,
} from "lucide-react";
import SearchPage from "./pages/SearchPage";
import BookshelfPage from "./pages/BookshelfPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import DiscoverPage from "./pages/DiscoverPage";
import FavoritesPage from "./pages/FavoritesPage";
import WereadPage from "./pages/WereadPage";
import PluginsPage from "./pages/PluginsPage";
import LoginDialog from "./components/LoginDialog";
import AccountSwitcher from "./components/AccountSwitcher";
import CommandPalette from "./components/CommandPalette";
import NavDownloadIndicator from "./components/NavDownloadIndicator";
import { useTheme } from "./hooks/useTheme";
import { getCurrentUser, refreshUserDownloads, type User } from "./api/auth";
import { getConfig, checkForUpdates } from "./api/config";

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
    getConfig()
      .then((cfg) => {
        const startupPage = cfg.startup_page;
        if (startupPage && startupPage !== "/") {
          navigate(startupPage, { replace: true });
        }
      })
      .catch((err) => {
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
        const user = await getCurrentUser();
        setCurrentUser(user);
        // Refresh download quota from API in background
        if (user) {
          refreshUserDownloads()
            .then((refreshed) => {
              if (refreshed) setCurrentUser(refreshed);
            })
            .catch((err) => {
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
    checkForUpdates()
      .then((info) => {
        if (info.has_update) {
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
                  boxShadow: "0 8px 30px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.05) inset",
                  opacity: t.visible ? 1 : 0,
                  transform: t.visible ? "translateY(0) scale(1)" : "translateY(10px) scale(0.95)",
                  transition: "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
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
                    openUrl("https://www.11xy.cn/projects/olib-%E7%94%B5%E8%84%91%E7%AB%AF");
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
            { duration: 15000 },
          );
        }
      })
      .catch((err) => {
        console.warn("Update check failed:", err);
      });
  }, []);

  // Listen for custom in-app download notifications from rust backend
  useEffect(() => {
    type DownloadStatusPayload = { status: string; title?: string; message?: string };
    const unlisten = listen<DownloadStatusPayload>("download-status", (event) => {
      const { status, title } = event.payload;

      // 后端只发「下载完成」；失败与转交外部工具由发起下载的页面自行提示
      if (status === "success") {
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
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  background: "rgba(34, 197, 94, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <CheckCircle2 color="#22c55e" size={20} />
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
                  下载完成
                </div>
                <div
                  className="truncate"
                  style={{ fontSize: "12px", color: "var(--text-secondary)" }}
                  title={title}
                >
                  《{title}》
                </div>
              </div>
            </div>
          ),
          { duration: 4000 },
        );
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Listen for plugin install results from rust backend
  useEffect(() => {
    const unlisten = listen<{ status: string; message?: string }>("plugin-status", (event) => {
      const { status, message } = event.payload;
      if (status === "success") {
        toast.success(message || "插件安装完成", { duration: 4000 });
      } else {
        toast.error(message || "插件安装失败", { duration: 6000 });
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Listen for plugin task results (format conversion etc.) from rust backend
  useEffect(() => {
    const unlisten = listen<{ status: string; title?: string; message?: string }>(
      "plugin-task",
      (event) => {
        const { status, title, message } = event.payload;
        if (status === "success") {
          toast.success(message || `《${title}》处理完成`, { duration: 4000 });
        } else {
          toast.error(`《${title}》${message || "处理失败"}`, { duration: 6000 });
        }
      },
    );

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const navItems = [
    { path: "/discover", icon: Sparkles, label: "发现" },
    { path: "/", icon: Search, label: "搜索" },
    { path: "/favorites", icon: Heart, label: "收藏" },
    { path: "/weread", icon: BookMarked, label: "微信读书" },
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
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              end={item.path === "/"}
              id={item.path === "/bookshelf" ? "sidebar-bookshelf-link" : undefined}
            >
              <item.icon className="nav-icon" size={20} />
              <span>{item.label}</span>
              {item.path === "/bookshelf" && <NavDownloadIndicator />}
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
          <Route path="/" element={<SearchPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/weread" element={<WereadPage />} />
          {/* 下载页已并入书架；兼容旧的启动页配置 */}
          <Route path="/downloads" element={<Navigate to="/bookshelf" replace />} />
          <Route path="/bookshelf" element={<BookshelfPage />} />
          <Route path="/history" element={<HistoryPage />} />
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
            getCurrentUser().then((user) => {
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
