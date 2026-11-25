import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { ShieldAlert, X } from "lucide-react";
import {
  LAN_WEREAD_QR_CLOSE,
  LAN_WEREAD_QR_SHOW,
  type LanWereadQrClose,
  type LanWereadQrShow,
} from "../api/lan";
import { warnIgnored } from "../utils/log";

/**
 * 微信读书扫码中转：手机发起登录后把二维码推到电脑显示，用户用手机微信扫这块屏幕。
 * 局域网服务不鉴权，弹窗醒目显示手机生成的识别码，提醒用户核对一致再扫，防同网络的人推来假码。
 * 全局挂载一次（App 根部）。
 */
export default function WereadQrRelay() {
  const [qr, setQr] = useState<LanWereadQrShow | null>(null);

  useEffect(() => {
    const unShow = listen<LanWereadQrShow>(LAN_WEREAD_QR_SHOW, (e) => setQr(e.payload));
    const unClose = listen<LanWereadQrClose>(LAN_WEREAD_QR_CLOSE, (e) =>
      setQr((cur) => (cur?.code === e.payload.code ? null : cur)),
    );
    return () => {
      unShow.then((f) => f()).catch(warnIgnored("unlisten weread qr show"));
      unClose.then((f) => f()).catch(warnIgnored("unlisten weread qr close"));
    };
  }, []);

  useEffect(() => {
    if (!qr) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQr(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qr]);

  if (!qr) return null;

  return createPortal(
    <div
      className="prescriber-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) setQr(null);
      }}
    >
      <div className="prescriber-modal weread-relay-modal" role="dialog" aria-label="微信读书扫码">
        <button
          className="btn btn-ghost btn-icon btn-sm weread-relay-close"
          onClick={() => setQr(null)}
          aria-label="关闭"
        >
          <X size={16} />
        </button>
        <div className="prescriber-modal-title">手机请求登录微信读书</div>
        <div className="prescriber-modal-sub">用手机微信「扫一扫」扫描下方二维码</div>
        <div className="weread-relay-code">
          <span>识别码</span>
          <strong>{qr.code}</strong>
        </div>
        <div className="prescriber-qr">
          <img src={qr.qr_base64} alt="微信读书登录二维码" width={200} height={200} />
        </div>
        <div className="weread-relay-warn">
          <ShieldAlert size={13} />
          请确认识别码与你手机上显示的一致；不一致或不是你发起的，请直接关闭，不要扫码
        </div>
      </div>
    </div>,
    document.getElementById("root") ?? document.body,
  );
}
