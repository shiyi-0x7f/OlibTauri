import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  WEREAD_IMPORT_EXTENSIONS,
  onWereadImport,
  wereadImportBook,
  type WereadImportResult,
} from "../api/weread";

const MAX_SIZE = 200 * 1024 * 1024;

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** 文件是否可导入微信读书（格式 + 大小；size 未知时只看格式） */
export function canImportToWeread(extension: string, size?: number): boolean {
  if (!WEREAD_IMPORT_EXTENSIONS.includes(extension.toLowerCase())) return false;
  return size === undefined || (size > 0 && size <= MAX_SIZE);
}

/**
 * 导入本机书籍到微信读书：进度以 loading toast 展示（toast id = 路径），
 * 同一文件进行中时忽略重复触发。结果不确定时不自动重试，交由用户查书架。
 */
export function useWereadImport(onImported?: (result: WereadImportResult) => void) {
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    const unlisten = onWereadImport(({ path, sent, total }) => {
      if (!inFlight.current.has(path)) return;
      const pct = Math.floor((sent / Math.max(total, 1)) * 100);
      toast.loading(`正在上传《${fileName(path)}》… ${pct}%`, { id: path });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const importBook = useCallback(
    async (path: string) => {
      if (inFlight.current.has(path)) return;
      inFlight.current.add(path);
      setImporting(new Set(inFlight.current));
      toast.loading(`正在准备导入《${fileName(path)}》…`, { id: path });
      try {
        const result = await wereadImportBook(path);
        toast.success(`《${fileName(path)}》已提交微信读书解析，请稍后到官方书架查看`, {
          id: path,
          duration: 6000,
        });
        onImported?.(result);
      } catch (err) {
        console.error("weread_import_book failed:", err);
        toast.error(`导入失败：${String(err)}`, { id: path, duration: 8000 });
      } finally {
        inFlight.current.delete(path);
        setImporting(new Set(inFlight.current));
      }
    },
    [onImported],
  );

  return { importBook, importing };
}
