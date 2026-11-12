import { warnIgnored } from "./log";

/** localStorage 键：下载提示音文件名，"none" 表示关闭 */
export const DOWNLOAD_SOUND_KEY = "olib-download-sound";
export const DEFAULT_DOWNLOAD_SOUND = "notification_message-notify-8-313753.mp3";

// 必须经 Vite 导入才会被打包并得到正确 URL；写死 "/src/assets/..." 只在 dev server 下能访问，
// 生产包里是 404，导致提示音不响。
const SOUND_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../assets/sounds/*.mp3", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [path.split("/").pop() ?? path, url]),
);

export function getDownloadSound(): string {
  return localStorage.getItem(DOWNLOAD_SOUND_KEY) || DEFAULT_DOWNLOAD_SOUND;
}

export function setDownloadSound(file: string): void {
  localStorage.setItem(DOWNLOAD_SOUND_KEY, file);
}

/** 播放指定提示音；file 缺省时读用户设置 */
export function playDownloadSound(file: string = getDownloadSound()): void {
  if (file === "none") return;
  const url = SOUND_URLS[file] ?? SOUND_URLS[DEFAULT_DOWNLOAD_SOUND];
  if (!url) return;
  const audio = new Audio(url);
  audio.volume = 0.5;
  audio.play().catch(warnIgnored("下载提示音"));
}
