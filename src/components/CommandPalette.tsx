import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseShortcutParts } from "./ShortcutRecorder";
import { Search, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();
    const [shortcutDisplay, setShortcutDisplay] = useState("Ctrl + Space");
    const shortcutRef = useRef<{ ctrl: boolean; shift: boolean; alt: boolean; code: string }>({
        ctrl: true, shift: false, alt: false, code: "Space"
    });

    // Load configured shortcut from backend
    useEffect(() => {
        (async () => {
            try {
                const cfg: any = await invoke("get_config");
                const raw: string = cfg.shortcut_search || "CommandOrControl+Space";
                const parts = parseShortcutParts(raw);
                setShortcutDisplay(parts.join(" + "));

                const lower = raw.toLowerCase();
                shortcutRef.current = {
                    ctrl: lower.includes("commandorcontrol") || lower.includes("control") || lower.includes("meta"),
                    shift: lower.includes("shift"),
                    alt: lower.includes("alt"),
                    code: parts[parts.length - 1] || "Space",
                };
            } catch (err) {
                console.error("Failed to load shortcut config:", err);
            }
        })();
    }, []);

    // Listen for the backend event (fired from global shortcut)
    useEffect(() => {
        const unlisten = listen<boolean>("toggle-search-palette", () => {
            setOpen((prev) => !prev);
        });
        return () => {
            unlisten.then((fn) => fn());
        };
    }, []);

    // Also listen for local keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const sc = shortcutRef.current;
            const modMatch =
                (e.ctrlKey || e.metaKey) === sc.ctrl &&
                e.shiftKey === sc.shift &&
                e.altKey === sc.alt;
            const mainKey = sc.code;
            const keyMatch =
                e.key.toUpperCase() === mainKey.toUpperCase() ||
                e.code.toUpperCase() === mainKey.toUpperCase() ||
                (mainKey === "Space" && e.code === "Space");
            if (modMatch && keyMatch) {
                e.preventDefault();
                setOpen((prev) => !prev);
            }
            if (e.key === "Escape" && open) {
                setOpen(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open]);

    // Auto focus input when opened
    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 50);
            setQuery("");
        }
    }, [open]);

    // Navigate to search page with the query
    const handleGo = () => {
        const q = query.trim();
        if (!q) return;
        setOpen(false);

        // Write query into the shared search state in localStorage
        // so SearchPage picks it up immediately
        try {
            const STORAGE_KEY = "olib_search_state";
            const saved = localStorage.getItem(STORAGE_KEY);
            const state = saved ? JSON.parse(saved) : {};
            state.query = q;
            state.searched = false; // mark as not yet searched so SearchPage triggers search
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (e) {
            console.error("Failed to update search state:", e);
        }

        // Navigate to search page
        navigate("/");

        // Notify SearchPage to pick up the new query
        // Use a delay to ensure SearchPage has mounted and registered its listener
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("olib:palette-search", { detail: q }));
        }, 150);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleGo();
        }
    };

    if (!open) return null;

    return (
        <div className="command-palette-overlay" onClick={() => setOpen(false)}>
            <div className="command-palette" onClick={(e) => e.stopPropagation()}>
                <div className="command-palette-input-wrapper">
                    <Search size={18} className="command-palette-search-icon" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="command-palette-input"
                        placeholder="输入书名，按 Enter 搜索..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <div className="command-palette-shortcut-badge">{shortcutDisplay}</div>
                </div>

                {/* Hint */}
                <div className="command-palette-hint" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    {query.trim() ? (
                        <span
                            style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "var(--accent)" }}
                            onClick={handleGo}
                        >
                            按 Enter 搜索「{query.trim()}」
                            <ArrowRight size={14} />
                        </span>
                    ) : (
                        "输入关键词，按 Enter 跳转到搜索页面"
                    )}
                </div>
            </div>
        </div>
    );
}
