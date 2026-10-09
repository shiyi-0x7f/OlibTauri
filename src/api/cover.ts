import { invoke } from "./core";

export interface CacheStats {
  total_size: number;
  file_count: number;
}

export function getCoverProxyPort(): Promise<number> {
  return invoke("get_cover_proxy_port");
}

export function getCacheStats(): Promise<CacheStats> {
  return invoke("get_cache_stats");
}

export function clearCoverCache(): Promise<void> {
  return invoke("clear_cover_cache");
}
