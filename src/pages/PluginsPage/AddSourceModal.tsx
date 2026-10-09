import { useState } from "react";
import { AlertTriangle, Globe, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { subscribePluginRegistry } from "../../api/plugin";

interface AddSourceModalProps {
  onAdded: () => void;
  onClose: () => void;
}

/** 添加第三方插件源。WebView2 不实现 window.prompt()，输入框只能自己做 */
export default function AddSourceModal({ onAdded, onClose }: AddSourceModalProps) {
  const [url, setUrl] = useState("");
  const [subscribing, setSubscribing] = useState(false);

  const handleSubscribe = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setSubscribing(true);
    try {
      const count = await subscribePluginRegistry(trimmed);
      toast.success(`已添加插件源，发现 ${count} 个插件`);
      onAdded();
      onClose();
    } catch (err) {
      toast.error(String(err), { duration: 8000 });
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 440, maxWidth: 500 }}
      >
        <div className="modal-title" style={{ fontSize: 17, marginBottom: 6 }}>
          添加插件源
        </div>
        <div className="pl-modal-desc">
          填入第三方插件源的 registry JSON 地址（必须是 https）。源里的每个插件都必须提供 sha256
          校验和，否则整个源会被拒绝。
        </div>
        <input
          className="input"
          autoFocus
          placeholder="https://example.com/olib-plugins.json"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubscribe()}
          style={{ width: "100%", marginBottom: 16 }}
        />
        <div className="pl-warning" style={{ marginBottom: 16 }}>
          <AlertTriangle size={14} />
          <span>第三方插件会在你的电脑上运行外部程序，请只添加你信任的来源。</span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSubscribe}
            disabled={!url.trim() || subscribing}
          >
            {subscribing ? <Loader2 size={14} className="spinner" /> : <Globe size={14} />}
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
