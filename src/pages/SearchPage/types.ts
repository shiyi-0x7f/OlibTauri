export interface Book {
    id: number;
    title: string;
    author: string;
    publisher?: string;
    year?: number;
    language?: string;
    extension?: string;
    filesize?: number;
    filesizeString?: string;
    hash?: string;
    cover?: string;
    description?: string;
    pages?: number;
    readOnlineUrl?: string;
    [key: string]: any;
}

export type ViewMode = "grid" | "list";
