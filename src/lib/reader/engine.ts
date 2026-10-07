/**
 * The reader's engine interface (eBooks sub-issue 3, the epic's contract).
 * Everything in the reader talks to a ReaderEngine; only the foliate adapter
 * (src/lib/reader/engines/foliate/) knows the engine behind it, and ESLint
 * keeps it that way. Positions are stored as DurtalLocators, never as bare
 * CFIs, so a file's place survives a new engine or a replaced file.
 *
 * Later sub-issues extend the interface with what they build
 * (setDecorations in 11, search in 14, speech in 19); no method exists
 * before something uses it.
 */

/** The formats the engine opens (READABLE_FORMATS in src/lib/ebooks/formats.ts) */
export type ReaderFormat = "epub" | "kepub" | "pdf" | "mobi" | "azw" | "azw3" | "fb2" | "fbz" | "cbz";

/** Bytes the page started fetching before the engine loaded: one explicit range */
export interface Prefetched {
  start: number;
  bytes: ArrayBuffer;
}

/** One stored file of an e-book, and where its bytes are */
export interface BookSource {
  ebookId: string;
  fileId: string;
  format: ReaderFormat;
  /** Bytes, from the catalogue: every range is explicit */
  size: number;
  /** The file's sha256: a locator made in this file carries it */
  sha256: string;
  /** Where the bytes are: a signed CloudFront URL, or the app route */
  url: string;
  /** The app route, for when the CDN cannot be reached */
  fallbackUrl: string;
  /** A fresh signed URL, when the one in `url` has expired (403) */
  refreshUrl?: () => Promise<string>;
  /** The zip's central directory, from the manifest sub-issue 5 writes */
  cdOffset?: number | null;
  /** The first range, requested by the page as the HTML arrived */
  prefetch?: Promise<Prefetched | null>;
}

/** A place in a file (the epic's contract). Persisted everywhere a position is stored. */
export interface DurtalLocator {
  v: 1;
  /** sha256 of the file the locator was made in */
  fileHash: string;
  href: string;
  sectionIndex: number;
  /** Within the section, 0 to 1 */
  progression: number;
  /** Within the book, size-weighted, 0 to 1 */
  totalProgression: number;
  /** The engine's size-based location */
  position?: number;
  cfi?: string;
  pdf?: { page: number; rects?: [number, number, number, number][] };
  /** A text quote with 32 to 64 characters of context on each side */
  text?: { before?: string; highlight?: string; after?: string };
  tocLabel?: string;
  pageLabel?: string;
}

export interface BookInfo {
  title: string;
  authors: string[];
  language: string | null;
  dir: "ltr" | "rtl";
  layout: "reflowable" | "pre-paginated";
  /** What later sub-issues may offer for this format */
  capabilities: { search: boolean; tts: boolean; spreads: boolean; scrolled: boolean };
}

export interface TocItem {
  label: string;
  href: string;
  subitems: TocItem[];
}

/** How the book looks: typography and the theme's literal colours */
export interface Presentation {
  /** A CSS font-family list, or null for the publisher's own fonts */
  fontFamily: string | null;
  /** px */
  fontSize: number;
  lineHeight: number;
  /** Side margins, percent of the page width */
  margin: number;
  textAlign: "left" | "justify";
  /** Resolved colours: the book's frames cannot see the app's CSS variables */
  colors: { background: string; text: string; link: string; selection: string; muted: string };
  /** @font-face rules for the reading fonts, with absolute URLs */
  fontFaces: string;
}

/** Re-anchoring a stored locator: by CFI, by its text quote, else by its fraction */
export interface ResolveResult {
  status: "exact" | "healed" | "approximate" | "failed";
  /** Where the engine went; with a new hash when healed */
  locator: DurtalLocator | null;
}

export type OpenErrorKind = "damaged" | "unsupported" | "network" | "expired";

export interface EngineEvents {
  ready: BookInfo & { toc: TocItem[] };
  relocate: { locator: DurtalLocator; chapter: string | null; reason: "turn" | "jump" };
  selection: { text: string; locator: DurtalLocator } | null;
  link: { href: string; external: boolean };
  error: { kind: OpenErrorKind; message: string };
  /** A section's document loaded: the input layer listens there too */
  document: { doc: Document };
}

export type GoToTarget = DurtalLocator | { href: string } | { fraction: number };

export interface OpenOptions {
  /** The element the book renders into */
  container: HTMLElement;
  presentation: Presentation;
  /** Where to start: this device's saved place */
  at?: DurtalLocator | null;
}

export interface ReaderEngine {
  /** Opens the book and goes to `at` (resolved) or to the start */
  open(source: BookSource, options: OpenOptions): Promise<{ resolved: ResolveResult | null }>;
  destroy(): void;
  goTo(target: GoToTarget): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Left and right follow the book's direction: right-to-left books turn the other way */
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  currentLocator(): DurtalLocator | null;
  setPresentation(presentation: Presentation): void;
  /** A locator for the current selection inside the book, or null */
  locatorFromSelection(): DurtalLocator | null;
  resolve(locator: DurtalLocator): Promise<ResolveResult>;
  on<K extends keyof EngineEvents>(name: K, handler: (detail: EngineEvents[K]) => void): () => void;
}
