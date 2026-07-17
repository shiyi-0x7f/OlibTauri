import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Global proxy port - shared across all hook instances */
let _proxyPort: number | null = null;
let _portPromise: Promise<number> | null = null;

/** Fetch the proxy port once and cache it globally */
function fetchPort(): Promise<number> {
    if (_proxyPort !== null) return Promise.resolve(_proxyPort);
    if (_portPromise) return _portPromise;
    _portPromise = invoke<number>("get_cover_proxy_port")
        .then((port) => {
            _proxyPort = port;
            return port;
        })
        .catch(() => {
            _portPromise = null;
            return 0;
        });
    return _portPromise;
}

interface UseCoverCacheReturn {
    /** Get the proxy URL for a book cover. Falls back to remote URL if proxy not ready. */
    getCoverUrl: (bookId: string, fallbackUrl?: string) => string | undefined;
    /** No-op kept for API compatibility (proxy handles errors via HTTP) */
    handleCoverError: (bookId: string) => void;
    /** No-op kept for API compatibility (proxy downloads on demand) */
    cacheCovers: (items: { id: string; url: string }[]) => void;
}

/**
 * Simplified cover cache hook backed by a local HTTP image proxy.
 *
 * The proxy server runs on 127.0.0.1:{port} and handles:
 * - Disk caching (automatic download on first request)
 * - LRU eviction when cache exceeds size limit
 * - Browser-level caching via Cache-Control headers
 *
 * Usage:
 * ```ts
 * const { getCoverUrl } = useCoverCache();
 * <img src={getCoverUrl(bookId, book.cover)} />
 * ```
 */
export function useCoverCache(): UseCoverCacheReturn {
    const [port, setPort] = useState<number>(_proxyPort ?? 0);

    useEffect(() => {
        if (_proxyPort !== null) {
            setPort(_proxyPort);
            return;
        }
        // Retry up to 3 times with delay (proxy starts async)
        let attempt = 0;
        const tryFetch = () => {
            fetchPort().then((p) => {
                if (p > 0) {
                    setPort(p);
                } else if (attempt < 3) {
                    attempt++;
                    setTimeout(tryFetch, 500 * attempt);
                }
            });
        };
        tryFetch();
    }, []);

    const getCoverUrl = useCallback(
        (bookId: string, fallbackUrl?: string): string | undefined => {
            if (!fallbackUrl) return undefined;
            if (port > 0) {
                return `http://127.0.0.1:${port}/cover/${encodeURIComponent(bookId)}?url=${encodeURIComponent(fallbackUrl)}`;
            }
            // Proxy not ready yet, use remote URL directly
            return fallbackUrl;
        },
        [port],
    );

    // No-op: proxy handles everything server-side
    const handleCoverError = useCallback((_bookId: string) => {}, []);

    // No-op: proxy downloads on demand, no need to pre-cache
    const cacheCovers = useCallback((_items: { id: string; url: string }[]) => {}, []);

    return { getCoverUrl, handleCoverError, cacheCovers };
}
