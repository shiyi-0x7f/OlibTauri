import { useState, useEffect, useCallback, useRef } from "react";

interface ShortcutRecorderProps {
    value: string; // e.g. "CommandOrControl+Space"
    onRecord: (shortcut: string) => void;
    defaultValue?: string;
}

// Map browser KeyboardEvent keys to Tauri-compatible names
const KEY_MAP: Record<string, string> = {
    " ": "Space",
    "ArrowUp": "Up",
    "ArrowDown": "Down",
    "ArrowLeft": "Left",
    "ArrowRight": "Right",
};

// Keys that should not be used as standalone main keys
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/**
 * Convert a Tauri shortcut string like "CommandOrControl+Shift+K"
 * to a human-readable display like "Ctrl + Shift + K"
 */
export function formatShortcutDisplay(shortcut: string): string {
    return shortcut
        .replace(/CommandOrControl/gi, "Ctrl")
        .replace(/\+/g, " + ");
}

/**
 * Parse display parts for rendering individual key badges.
 * Returns an array of key labels, e.g. ["Ctrl", "Shift", "K"]
 */
export function parseShortcutParts(shortcut: string): string[] {
    return shortcut
        .replace(/CommandOrControl/gi, "Ctrl")
        .split("+")
        .map((s) => s.trim())
        .filter(Boolean);
}

export default function ShortcutRecorder({
    value,
    onRecord,
    defaultValue = "CommandOrControl+Space",
}: ShortcutRecorderProps) {
    const [recording, setRecording] = useState(false);
    const [pendingKeys, setPendingKeys] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const buildShortcutString = useCallback((e: KeyboardEvent): string | null => {
        if (MODIFIER_KEYS.has(e.key)) return null; // modifier-only press, wait for main key

        const parts: string[] = [];
        if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
        if (e.shiftKey) parts.push("Shift");
        if (e.altKey) parts.push("Alt");

        // Require at least one modifier
        if (parts.length === 0) return null;

        let mainKey = e.key;
        if (KEY_MAP[mainKey]) mainKey = KEY_MAP[mainKey];
        else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
        else if (mainKey.startsWith("F") && /^F\d{1,2}$/.test(mainKey)) {
            /* F1-F12 keep as-is */
        } else {
            // Capitalize first letter for other keys
            mainKey = mainKey.charAt(0).toUpperCase() + mainKey.slice(1);
        }

        parts.push(mainKey);
        return parts.join("+");
    }, []);

    useEffect(() => {
        if (!recording) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === "Escape") {
                setRecording(false);
                setPendingKeys(null);
                return;
            }

            const shortcut = buildShortcutString(e);
            if (shortcut) {
                setPendingKeys(null);
                setRecording(false);
                onRecord(shortcut);
            } else {
                // Show modifier-only preview
                const mods: string[] = [];
                if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
                if (e.shiftKey) mods.push("Shift");
                if (e.altKey) mods.push("Alt");
                setPendingKeys(mods.join(" + ") + " + ...");
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [recording, buildShortcutString, onRecord]);

    // Close recording on outside click
    useEffect(() => {
        if (!recording) return;
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setRecording(false);
                setPendingKeys(null);
            }
        };
        window.addEventListener("mousedown", handleClick);
        return () => window.removeEventListener("mousedown", handleClick);
    }, [recording]);

    const parts = parseShortcutParts(value);
    const isDefault = value === defaultValue;

    return (
        <div className="shortcut-recorder-row" ref={containerRef}>
            {recording ? (
                <div className="shortcut-recorder recording" onClick={() => setRecording(false)}>
                    <span className="shortcut-recorder-hint">
                        {pendingKeys || "请按下快捷键组合..."}
                    </span>
                </div>
            ) : (
                <div className="shortcut-recorder" onClick={() => setRecording(true)}>
                    {parts.map((key, i) => (
                        <span key={i}>
                            {i > 0 && <span className="shortcut-plus">+</span>}
                            <kbd className="shortcut-key-badge">{key}</kbd>
                        </span>
                    ))}
                </div>
            )}
            {!isDefault && !recording && (
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => onRecord(defaultValue)}
                    title="恢复默认"
                    style={{ flexShrink: 0, marginLeft: 8 }}
                >
                    恢复默认
                </button>
            )}
        </div>
    );
}
