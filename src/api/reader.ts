import { invoke } from "./core";

/** 由书目的 readOnlineUrl 拼出带凭证的在线阅读 URL */
export function getReaderUrl(readOnlineUrl: string): Promise<string> {
  return invoke("get_reader_url", { readOnlineUrl });
}
