export interface AppConfig {
    download_folder: string;
    cache_folder: string;
    download_with_browser: boolean;
    skip_duplicate_files: boolean;
    host_index: number;
    search_limit: number;
    language_index: number;
    extension_index: number;
    exact_search: boolean;
    user_email: string;
    window_width: number;
    window_height: number;
    theme: string;
    primary_color: string;
    notify_on_download: boolean;
    close_to_tray: boolean;
    shortcut_search: string;
    subscription_url: string;
    download_method: string;
    startup_page: string;
    weread_api_key: string;
    calibre_path: string;
}

export interface CacheStats {
    total_size: number;
    file_count: number;
}

export interface HostLatency {
    index: number;
    domain: string;
    latency_ms: number;
}

export interface HostsInfo {
    hosts: string[];
    source: string;
    updated_at: string | null;
}
