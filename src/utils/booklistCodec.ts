// 书单分享编解码（olib://booklist 协议 v1）。
// 格式基准为 olib-mobile 的 lib/services/booklist_share_codec.dart，两端须严格对齐：
// - 紧凑 URI:  olib://booklist?ids=123,456          （超长二维码降级用）
// - 完整 URI:  olib://booklist?d=<base64url(gzip(json))>  （二维码/口令首选，含元数据）
// - JSON 文件: {"v":1,"name":...,"books":[{id,title,author,hash}]}
// 兼容旧格式 olib_share:123,456。

export interface BooklistEntry {
  id: string;
  title?: string;
  author?: string;
  hash?: string;
}

export interface BooklistShareData {
  entries: BooklistEntry[];
  name?: string;
  exportedAt?: string;
}

const SCHEME_HOST = "olib://booklist";
const FORMAT_VERSION = 1;

/** 二维码可承载的近似字符上限（与移动端一致：QR v40 + 中等纠错留余量） */
export const QR_SAFE_CHARS = 1800;

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 把书单编成紧凑 URI（仅 ID） */
export function encodeIdsUri(ids: string[]): string {
  const cleaned = ids.filter((i) => i.trim()).join(",");
  return `${SCHEME_HOST}?ids=${cleaned}`;
}

/** 把书单编成完整 URI（含元数据，gzip + base64url） */
export async function encodeFullUri(data: BooklistShareData): Promise<string> {
  const payload: Record<string, unknown> = {
    v: FORMAT_VERSION,
    ...(data.name ? { n: data.name } : {}),
    ...(data.exportedAt ? { e: data.exportedAt } : {}),
    b: data.entries.map((e) => ({
      id: e.id,
      ...(e.title ? { t: e.title } : {}),
      ...(e.author ? { a: e.author } : {}),
      ...(e.hash ? { h: e.hash } : {}),
    })),
  };
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  return `${SCHEME_HOST}?d=${base64UrlEncode(await gzip(raw))}`;
}

/** 为二维码挑选合适的编码：先试完整版，超长则降级到纯 ID */
export async function encodeForQr(data: BooklistShareData): Promise<string> {
  const full = await encodeFullUri(data);
  if (full.length <= QR_SAFE_CHARS) return full;
  return encodeIdsUri(data.entries.map((e) => e.id));
}

interface RawEntry {
  id?: unknown;
  t?: unknown;
  title?: unknown;
  a?: unknown;
  author?: unknown;
  h?: unknown;
  hash?: unknown;
}

function fromJsonMap(m: Record<string, unknown>): BooklistShareData {
  const rawBooks = (m.b ?? m.books) as RawEntry[] | undefined;
  const entries: BooklistEntry[] = (Array.isArray(rawBooks) ? rawBooks : [])
    .filter((e): e is RawEntry => !!e && typeof e === "object")
    .map((e) => ({
      id: String(e.id ?? ""),
      title: (e.t ?? e.title) as string | undefined,
      author: (e.a ?? e.author) as string | undefined,
      hash: (e.h ?? e.hash) as string | undefined,
    }))
    .filter((e) => e.id);
  return {
    entries,
    name: (m.n ?? m.name) as string | undefined,
    exportedAt: (m.e ?? m.exportedAt) as string | undefined,
  };
}

/** 万能解析：URI / 旧 olib_share / JSON 文本都能塞进来，解析失败返回 null */
export async function tryDecode(input: string): Promise<BooklistShareData | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1) JSON 文件内容
  if (trimmed.startsWith("{")) {
    try {
      return fromJsonMap(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  // 2) 旧协议 olib_share:id1,id2
  if (trimmed.startsWith("olib_share:")) {
    const ids = trimmed
      .slice("olib_share:".length)
      .split(",")
      .map((e) => e.split(":")[0].trim())
      .filter(Boolean);
    return ids.length ? { entries: ids.map((id) => ({ id })) } : null;
  }

  // 3) olib://booklist URI（手动解析，避免非标准 scheme 的 URL 兼容性问题）
  if (!trimmed.startsWith(`${SCHEME_HOST}?`)) return null;
  const params = new URLSearchParams(trimmed.slice(SCHEME_HOST.length + 1));

  const d = params.get("d");
  if (d) {
    try {
      const json = new TextDecoder().decode(await gunzip(base64UrlDecode(d)));
      return fromJsonMap(JSON.parse(json));
    } catch {
      return null;
    }
  }

  const idsParam = params.get("ids");
  if (idsParam) {
    const ids = idsParam
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (!ids.length) return null;
    return {
      entries: ids.map((id) => ({ id })),
      name: params.get("n") ?? undefined,
    };
  }

  return null;
}
