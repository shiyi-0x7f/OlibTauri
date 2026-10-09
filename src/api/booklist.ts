import { invoke } from "./core";

export interface BooklistImportEntry {
  id: string;
  title?: string | null;
  author?: string | null;
  hash?: string | null;
}

export interface BooklistImportResult {
  imported: number;
  skipped: number;
}

/** 把书单 URI 渲染为二维码，返回 SVG data URI */
export function booklistQr(text: string): Promise<string> {
  return invoke("booklist_qr", { text });
}

export function importBooklist(entries: BooklistImportEntry[]): Promise<BooklistImportResult> {
  return invoke("import_booklist", { entries });
}
