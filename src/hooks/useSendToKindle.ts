import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import { getKindleSettings, sendToKindle } from "../api/kindle";

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** 后端错误是否源于 SMTP / 配置（需打开配置弹窗修改），而非格式、大小等文件问题 */
function isConfigError(msg: string): boolean {
  return ["SMTP", "尚未配置", "格式不正确", "请填写", "端口无效", "授权码"].some((k) =>
    msg.includes(k),
  );
}

/** 配置弹窗的打开状态：为哪个文件打开、附带的错误原因 */
export interface KindleConfigRequest {
  path: string;
  error?: string;
}

/**
 * 发送本地书籍到 Kindle：loading toast 展示（toast id = 路径），同一文件进行中时忽略重复触发。
 * 未配置或因配置问题失败时给出 `configRequest`，由页面渲染 KindleConfigDialog；保存后自动续发。
 */
export function useSendToKindle() {
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [configRequest, setConfigRequest] = useState<KindleConfigRequest | null>(null);
  const inFlight = useRef(new Set<string>());

  const send = useCallback(async (path: string) => {
    if (inFlight.current.has(path)) return;
    const settings = await getKindleSettings().catch(() => null);
    if (!settings) {
      setConfigRequest({ path });
      return;
    }
    inFlight.current.add(path);
    setSending(new Set(inFlight.current));
    toast.loading(`正在发送《${fileName(path)}》到 Kindle…`, { id: path });
    try {
      await sendToKindle(path);
      toast.success(`《${fileName(path)}》已发送，稍后会出现在 Kindle 上`, {
        id: path,
        duration: 6000,
      });
    } catch (err) {
      const msg = String(err);
      if (isConfigError(msg)) {
        toast.dismiss(path);
        setConfigRequest({ path, error: msg });
      } else {
        toast.error(`发送失败：${msg}`, { id: path, duration: 10000 });
      }
    } finally {
      inFlight.current.delete(path);
      setSending(new Set(inFlight.current));
    }
  }, []);

  return {
    send,
    sending,
    configRequest,
    closeConfig: () => setConfigRequest(null),
    /** 配置保存并测试通过：关闭弹窗并继续发送原文件 */
    onConfigSaved: () => {
      const path = configRequest?.path;
      setConfigRequest(null);
      if (path) send(path);
    },
  };
}
