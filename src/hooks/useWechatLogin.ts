import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  prescriberPollLogin,
  prescriberStartLogin,
  ACCOUNT_CHANGED_EVENT,
} from "../api/prescriber";

export interface WechatLogin {
  open: boolean;
  qrUrl: string | null;
  expired: boolean;
  refresh: () => void;
  close: () => void;
}

const stripError = (e: unknown) => String(e).replace(/^Error:\s*/, "");

/** scc 公众号扫码登录：建码 → 每 2s 轮询 → 成功回调 onAuthorized */
export function useWechatLogin(onAuthorized: () => void) {
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const sceneId = useRef<string | null>(null);
  const onAuthorizedRef = useRef(onAuthorized);

  // 轮询回调在 start 时创建，经 ref 拿到最新的 onAuthorized
  useEffect(() => {
    onAuthorizedRef.current = onAuthorized;
  });

  const stopPolling = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => () => stopPolling(), []);

  const poll = async () => {
    if (!sceneId.current) return;
    try {
      const status = await prescriberPollLogin(sceneId.current);
      if (status === "authorized") {
        stopPolling();
        setOpen(false);
        toast.success("登录成功");
        // 账号是全局的（AI 寻书 / 意见反馈 / 社群专线共用），任一处登录都通知各处刷新
        window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED_EVENT));
        onAuthorizedRef.current();
      } else if (status === "expired") {
        stopPolling();
        setExpired(true);
      }
    } catch (e) {
      stopPolling();
      toast.error("登录状态查询失败：" + stripError(e));
    }
  };

  const start = async () => {
    setOpen(true);
    setExpired(false);
    setQrUrl(null);
    sceneId.current = null;
    stopPolling();
    try {
      const qr = await prescriberStartLogin();
      setQrUrl(qr.qr_url);
      sceneId.current = qr.scene_id;
      pollTimer.current = window.setInterval(poll, 2000);
    } catch (e) {
      toast.error("获取二维码失败：" + stripError(e));
    }
  };

  const login: WechatLogin = {
    open,
    qrUrl,
    expired,
    refresh: start,
    close: () => {
      stopPolling();
      setOpen(false);
    },
  };

  return { login, start };
}
