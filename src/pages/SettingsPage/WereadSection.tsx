import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { BookOpen, QrCode, LogOut, HelpCircle } from "lucide-react";
import WereadQrLoginDialog from "../../components/WereadQrLoginDialog";
import { wereadDisconnect, wereadStatus, type WereadStatus } from "../../api/weread";

export default function WereadSection() {
  const [status, setStatus] = useState<WereadStatus | null>(null);
  const [showQr, setShowQr] = useState(false);

  const load = useCallback(() => {
    wereadStatus()
      .then(setStatus)
      .catch((err) => toast.error(`读取微信读书连接状态失败：${String(err)}`));
  }, []);

  useEffect(load, [load]);

  const handleDisconnect = async () => {
    if (!confirm("确定要断开微信读书连接吗？本机保存的登录凭据将被删除。")) return;
    try {
      await wereadDisconnect();
      load();
    } catch (err) {
      toast.error(`断开失败：${String(err)}`);
    }
  };

  const connected = status?.connected === true;

  return (
    <div className="card settings-grid-full">
      <div className="settings-group">
        <div className="settings-group-title">
          <BookOpen size={16} style={{ marginRight: "6px", verticalAlign: "-2px" }} />
          微信读书
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <div className="settings-item-title">连接状态</div>
            <div className="settings-item-desc">
              {status === null ? (
                "读取中…"
              ) : connected ? (
                <span style={{ color: "#22c55e" }}>已连接</span>
              ) : (
                "未连接"
              )}
            </div>
          </div>
          {connected ? (
            <button className="btn btn-secondary btn-sm" onClick={handleDisconnect}>
              <LogOut size={14} /> 断开连接
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowQr(true)}
              disabled={status === null}
            >
              <QrCode size={14} /> 扫码连接
            </button>
          )}
        </div>

        <div className="settings-item">
          <div className="settings-item-info">
            <div
              className="settings-item-title"
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              <HelpCircle size={14} />
              如何连接？
            </div>
            <div className="settings-item-desc">
              点击「扫码连接」，用手机微信「扫一扫」扫描电脑上的二维码并同意授权。原 API Key
              方式已停用。登录凭据仅保存在本机。
            </div>
          </div>
        </div>
      </div>

      {showQr && (
        <WereadQrLoginDialog
          onClose={() => setShowQr(false)}
          onConnected={() => {
            setShowQr(false);
            toast.success("微信读书已连接");
            load();
          }}
        />
      )}
    </div>
  );
}
