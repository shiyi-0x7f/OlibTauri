import { useEffect, useState } from "react";

export interface Loaded<T> {
  data: T | null;
  error: string;
  loading: boolean;
}

/**
 * 页面各区块独立加载：一块失败不拖垮其他块，各自三态（加载 / 错误 / 数据）。
 * `version` 变化即重新加载（页面「刷新」或区块「重试」）。
 */
export function useLoad<T>(loader: (() => Promise<T>) | null, version: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: "", loading: !!loader });

  useEffect(() => {
    if (!loader) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    loader()
      .then((data) => alive && setState({ data, error: "", loading: false }))
      .catch(
        (err) =>
          alive && setState((s) => ({ ...s, error: String(err ?? "加载失败"), loading: false })),
      );
    return () => {
      alive = false;
    };
    // loader 由调用方以稳定引用传入，刷新只看 version
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, !!loader]);

  return state;
}
