import type { EbookCoverImage } from "./library-cover";
import {
  availableFormats,
  ebookReadHref,
  type LibraryEbook,
} from "./library-queries";
export interface EbookCardData {
  id: string;
  title: string;
  authors: string[];
  formats: string[];
  language: string | null;
  linked: boolean;
  state: LibraryEbook["matchState"];
  sizeBytes: number;
  added: string;
  cover: EbookCoverImage | null;
  readHref: string | null;
  /** How far the newest place has read, 0 to 1 (SLN-683) */
  progress: number | null;
}
export function ebookCardData(
  ebook: LibraryEbook,
  cover: EbookCoverImage | null,
): EbookCardData {
  return {
    id: ebook.id,
    // A linked e-book goes by its book's title and authors (SLN-683)
    title: ebook.bookTitle ?? ebook.title,
    authors: ebook.bookAuthors ?? ebook.authors,
    formats: availableFormats(ebook),
    language: ebook.language,
    linked: ebook.matchState === "linked",
    state: ebook.matchState,
    sizeBytes: ebook.files.reduce((total, file) => total + file.sizeBytes, 0),
    added: ebook.createdAt,
    cover,
    readHref: ebookReadHref(ebook),
    progress: ebook.progress ?? null,
  };
}
