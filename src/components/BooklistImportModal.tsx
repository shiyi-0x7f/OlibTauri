import { useState } from "react";
import { ClipboardPaste, Loader2 } from "lucide-react";
import { importBooklist } from "../api/booklist";
import toast from "react-hot-toast";
import { tryDecode, type BooklistShareData } from "../utils/booklistCodec";

interface Props {
  onImported: () => void;
  onClose: () => void;
}

/** 收藏页「导入书单」弹窗：粘贴口令 / olib:// URI / JSON，解析预览后写入收藏 */
export default function BooklistImportModal({ onImported, onClose }: Props) {
  const [input, setInput] = useState("");
  const [parsed, setParsed] = useState<BooklistShareData | null>(null);
  const [importing, setImporting] = useState(false);

  const handleChange = async (value: string) => {
    setInput(value);
    setParsed(value.trim() ? await tryDecode(value) : null);
  };

  const handleImport = async () => {
    if (!parsed || !parsed.entries.length) return;
    setImporting(true);
    try {
      const result = await importBooklist(
        parsed.entries.map((e) => ({
          id: e.id,
          title: e.title ?? null,
          author: e.author ?? null,
          hash: e.hash ?? null,
        })),
      );
      toast.success(`已导入 ${result.imported} 本，跳过 ${result.skipped} 本（重复/无效）`, {
        icon: "📚",
      });
      onImported();
      onClose();
    } catch (err) {
      console.error("Booklist import failed:", err);
      toast.error(`导入失败：${err}`);
    } finally {
      setImporting(false);
    }
  };

  const hasInput = input.trim().length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 420, maxWidth: 460 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--radius-md)",
              background:
                "linear-gradient(135deg, rgba(var(--accent-rgb),0.2), rgba(var(--accent-rgb),0.1))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ClipboardPaste size={20} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <div className="modal-title" style={{ margin: 0, fontSize: 17 }}>
              导入书单
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              粘贴手机端分享的书单口令（olib:// 开头）或 JSON 内容
            </div>
          </div>
        </div>

        <textarea
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="olib://booklist?d=…"
          autoFocus
          style={{
            width: "100%",
            minHeight: 110,
            padding: "10px 12px",
            fontSize: 12,
            fontFamily: "monospace",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--text-primary)",
            resize: "vertical",
          }}
        />

        <p
          style={{
            fontSize: 12,
            marginTop: 8,
            minHeight: 18,
            color: hasInput && !parsed ? "#ef4444" : "var(--text-muted)",
          }}
        >
          {!hasInput
            ? " "
            : parsed
              ? `识别到书单${parsed.name ? `「${parsed.name}」` : ""} · ${parsed.entries.length} 本`
              : "无法识别的内容，请检查口令是否完整"}
        </p>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={!parsed || !parsed.entries.length || importing}
          >
            {importing ? <Loader2 size={14} className="spin" /> : <ClipboardPaste size={14} />}
            导入到收藏
          </button>
        </div>
      </div>
    </div>
  );
}
