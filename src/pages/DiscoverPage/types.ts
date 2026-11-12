export interface Book {
  id: string;
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
}
