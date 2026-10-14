import type { WorkKind } from "@/lib/catalogue/kinds";
import type { WorkEbookDTO } from "./catalogue-dto";

export interface PaletteBookRead {
  readonly id: string;
  readonly kind: WorkKind;
  readonly ebook: WorkEbookDTO | null;
}

export interface PaletteEbook {
  readonly ebook: WorkEbookDTO;
  readonly matchState: "pending" | "linked" | "standalone" | "excluded";
  /** A linked eBook's book: it is titled after it, and left out when the book is already a result (SLN-683) */
  readonly workId?: string | null;
}

export interface PaletteEbookItem {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly readerPath: string | null;
}

/** Pure grouping of query results: no matching, eligibility checks or extra fetches. */
export function ebookPaletteGroup(input: {
  readonly works: readonly PaletteBookRead[];
  readonly ebooks: readonly PaletteEbook[];
  readonly recent: WorkEbookDTO | null;
  readonly emptyQuery: boolean;
}): {
  bookReaderPaths: ReadonlyMap<string, string>;
  ebooks: readonly PaletteEbookItem[];
  continueReading: PaletteEbookItem | null;
} {
  const bookReaderPaths = new Map<string, string>();
  for (const work of input.works) {
    if (work.kind === "book" && work.ebook?.readable && work.ebook.readerPath)
      bookReaderPaths.set(work.id, work.ebook.readerPath);
  }
  const seen = new Set<string>();
  const books = new Set(input.works.map((work) => work.id));
  const ebooks: PaletteEbookItem[] = [];
  for (const row of input.ebooks) {
    if (row.matchState === "excluded") continue;
    // A linked eBook stays with its book in Books; it is listed here only when its book is not a result
    if (row.matchState === "linked" && (!row.workId || books.has(row.workId))) continue;
    const ebook = row.ebook;
    if (seen.has(ebook.id)) continue;
    seen.add(ebook.id);
    ebooks.push({
      id: ebook.id,
      title: ebook.title,
      href: `/ebooks/${ebook.id}`,
      readerPath: ebook.readable ? ebook.readerPath : null,
    });
    if (ebooks.length === 5) break;
  }
  const recent = input.recent;
  const continueReading =
    input.emptyQuery && recent?.readable && recent.readerPath
      ? {
          id: recent.id,
          title: `Continue reading ${recent.title}`,
          href: recent.readerPath,
          readerPath: recent.readerPath,
        }
      : null;
  return { bookReaderPaths, ebooks, continueReading };
}
