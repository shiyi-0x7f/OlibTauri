// 类型统一由 src/api 层定义，此处仅 re-export 供本目录各 Section 使用
export type { AppConfig, HostLatency, HostsInfo } from "../../api/config";
export type { CacheStats } from "../../api/cover";
