import type { ReaderMedia } from "./media/content";
import type { SearchRequest, SearchUpdate } from "./search/types";
import type { SpeechPreparation, SpeechSegment } from "./speech/player";
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
export type ReaderFormat =
  | "epub"
  | "kepub"
  | "pdf"
  | "mobi"
  | "azw"
  | "azw3"
  | "fb2"
  | "fbz"
  | "cbz";

/** Bytes the page started fetching before the engine loaded: one explicit range each */
export interface Prefetched {
  start: number;
  bytes: ArrayBuffer;
}

/** Exact UTF-16 offsets in one opened PDF, before search folding or segmentation. */
export interface PdfTextPageRequest {
  fileHash: string;
  pageIndex: number;
  signal: AbortSignal;
}
export interface PdfPageText {
  fileHash: string;
  pageIndex: number;
  pageLabel: string;
  text: string;
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
  prefetch?: Promise<Prefetched[]>;
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
  /** Linear reading progress, 0 to 1. Non-linear excursions retain the last linear value. */
  totalProgression: number;
  /** Fresh locators use one-based locations. Legacy numbers are never used as navigation anchors. */
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
  toc: TocItem[];
  pageList: TocItem[];
  locationCount: number;
  /** Linear markup size, for the browser-only text estimate. */
  linearSize: number;
  /** Sections also provide immediate fallback contents while anchor indexing runs. */
  sections: {
    href: string;
    label: string;
    linear: boolean;
    start: number;
    end: number;
  }[];
  /** What later sub-issues may offer for this format */
  capabilities: {
    search: boolean;
    tts: boolean;
    spreads: boolean;
    scrolled: boolean;
  };
}

export interface TocItem {
  label: string;
  href: string;
  subitems: TocItem[];
  /** Adapter-resolved spine index for formats whose href is not a file path. */
  sectionIndex?: number;
}

/** How the book looks: typography and the theme's literal colours */
export interface Presentation {
  /** Pre-resource decision; reference bytes do not certify actual first-text transfer. */
  fontRoute?: import("./presentation/font-route").ReaderFontRoute;
  /** Persisted per-device presentation; absent only for legacy adapter callers. */
  policy?: import("@/lib/validations/reader-preferences").ReaderPresentation;
  /** A CSS font-family list, or null for the publisher's own fonts */
  fontFamily: string | null;
  /** px */
  fontSize: number;
  lineHeight: number;
  /** Side margins, percent of the page width */
  margin: number;
  textAlign: "left" | "justify";
  /** Resolved colours: the book's frames cannot see the app's CSS variables */
  colors: {
    background: string;
    text: string;
    link: string;
    selection: string;
    muted: string;
  };
  /** @font-face rules for the reading fonts, with absolute URLs */
  fontFaces: string;
}

/** Re-anchoring a stored locator: by CFI, by its text quote, else by its fraction */
export interface ResolveResult {
  status: "exact" | "healed" | "approximate" | "failed";
  /** Where the engine went; with a new hash when healed */
  locator: DurtalLocator | null;
}

/** Strict marking resolver: missing or ambiguous passage text is never a filled
 * approximate range. Pending means bounded/canceled work, not lost content. */
export interface AnnotationResolveResult {
  status: "exact" | "healed" | "approximate" | "orphaned" | "pending";
  locator: DurtalLocator | null;
}

export type OpenErrorKind = "damaged" | "unsupported" | "network" | "expired";
/** Reading input, layout adjustment, and automatic speech movement have different publication rules. */
export type RelocationOrigin = "human" | "layout" | "speech";

export type DecorationStyle =
  | "highlight"
  | "underline"
  | "quote"
  | "outline"
  | "margin";
/** Resolved marks only: a full-state set belongs to one independent group.
 * Colour is a literal supplied by the active theme, never stored in the mark. */
export type Decoration =
  | {
      id: string;
      locator: DurtalLocator;
      style: DecorationStyle;
      color: string;
      note?: boolean;
      current?: boolean;
    }
  | { cfi: string; color: string; current?: boolean }; // existing history return outline

export interface ReaderNote {
  kind: "Footnote" | "Endnote" | "Note" | "Bibliography" | "Definition";
  fontFamily?: string;
  fontFaces?: string;
  content: DocumentFragment;
  href: string;
  originMark?: string;
  keyboard: boolean;
  reference?: HTMLElement;
  anchor: { left: number; right: number; top: number; bottom: number } | null;
}
export interface SelectionDetails {
  text: string;
  locator: DurtalLocator;
  lang: string | null;
  sentence: string;
  /** Measured host viewport coordinates, including fixed-layout scaling. */
  rect: DOMRectReadOnly;
}
export interface EngineEvents {
  "word-gesture": { details: SelectionDetails; document?: Document; input?: "mouse" };
  "fixed-controls": { zoom: number | null };
  note: ReaderNote | null;
  media: ReaderMedia;
  ready: BookInfo & { toc: TocItem[] };
  "annotation-activated": {
    group: string;
    decorationId: string;
    rect: { left: number; top: number; right: number; bottom: number };
  };
  relocate: {
    locator: DurtalLocator;
    chapter: string | null;
    reason: "turn" | "jump" | "layout";
    origin?: RelocationOrigin;
    atEnd: boolean;
    activity?: "turn" | "scroll";
    tocItem: TocItem | null;
    visibleChars: number;
    linear: boolean;
    paginated: boolean;
    navigationId?: number;
    originMark?: string;
    /** Whether the current contents anchor begins on this visible page. */
    atChapterStart?: boolean;
  };
  /** Keyboard focus entered book text outside the painted visible range. */
  focus: { locator: DurtalLocator };
  selection: {
    text: string;
    locator: DurtalLocator;
    rect: { left: number; top: number; right: number; bottom: number };
    keyboard: boolean;
  } | null;
  link: { href: string; external: boolean; originMark?: string };
  capabilities: BookInfo["capabilities"];
  error: { kind: OpenErrorKind; message: string };
  /** A section's document loaded: the input layer listens there too */
  document: { doc: Document };
}

export type GoToTarget =
  | DurtalLocator
  | { href: string }
  | { fraction: number }
  | { location: number }
  | { page: string; href?: string } // Optional canonical entry identity for duplicate labels.;
export interface NavigationOwner {
  id: number;
  signal: AbortSignal;
  origin?: RelocationOrigin;
}
export interface Marginalia {
  head: [string, string];
  foot: [string, string];
  color: string;
}

export interface OpenOptions {
  /** The element the book renders into */
  container: HTMLElement;
  presentation: Presentation;
  /** Where to start: this device's saved place */
  at?: DurtalLocator | { fraction: number } | null;
}

/** Engine-side text enumeration, distinct from the native player/session coordinator. */
export interface ReaderSpeech {
  segments(
    from: DurtalLocator | "visible",
    options?: { signal: AbortSignal },
  ): AsyncIterable<SpeechSegment>;
}

export interface ReaderEngine {
  /** PDF consumers share the opened document; cancellation owns only delivery. */
  pdfPageText?(request: PdfTextPageRequest): Promise<PdfPageText>;
  /** Null means measured geometry is absent; never synthesize item-width rects. */
  locatorForPdfTextOffsets?(request: PdfTextPageRequest & {
    start: number;
    end: number;
  }): Promise<DurtalLocator | null>;
  speech(): ReaderSpeech | null;
  focusBook?(): void;
  selectSpeechSentence?(locator: DurtalLocator): boolean;
  /**
   * Where a place's first line sits on screen, in host viewport coordinates,
   * or null when it is not painted (SLN-675: the search panel moves off it).
   */
  locatorRect?(locator: DurtalLocator): { left: number; top: number; right: number; bottom: number } | null;
  /** Adapter-owned exact text extraction. Aborting it never cancels visible rendering. */
  prepareSpeech?(request: {
    target: SpeechPreparation;
    signal: AbortSignal;
  }): Promise<{
    current: SpeechSegment | null;
    previous: SpeechSegment | null;
    next: SpeechSegment | null;
  }>;
  /** Opens the book and goes to `at` (resolved) or to the start */
  open(
    source: BookSource,
    options: OpenOptions,
  ): Promise<{ resolved: ResolveResult | null }>;
  destroy(): void;
  goTo(target: GoToTarget, owner?: NavigationOwner): Promise<void>;
  locationToFraction(location: number): number;
  sectionFractions(): number[];
  indexAnchors(options: {
    hrefs: string[];
    signal: AbortSignal;
  }): AsyncIterable<{
    href: string;
    fraction: number;
    sectionLabel?: string;
    textRatio?: number;
  }>;
  nextSection(owner?: NavigationOwner): Promise<void>;
  prevSection(owner?: NavigationOwner): Promise<void>;
  firstPage(owner?: NavigationOwner): Promise<void>;
  lastPage(owner?: NavigationOwner): Promise<void>;
  setMarginalia(lines: Marginalia | null): void;
  /** Fades the running lines out while the bars cover them */
  setMarginaliaHidden(hidden: boolean): void;
  setDecorations(group: string, decorations: Decoration[]): void;
  next(owner?: NavigationOwner): Promise<void>;
  prev(owner?: NavigationOwner): Promise<void>;
  /** Whether the book scrolls (the scroll flow) instead of turning pages */
  isScrolled?(): boolean;
  /** Scrolls a scrolled book by a few lines, as an arrow key does (SLN-674) */
  scrollLines?(direction: -1 | 1): void;
  /** Scrolls a scrolled book by this many pixels (a wheel beside the text column) */
  scrollBy?(px: number): void;
  /** Left and right follow the book's direction: right-to-left books turn the other way */
  goLeft(owner?: NavigationOwner): Promise<void>;
  goRight(owner?: NavigationOwner): Promise<void>;
  noteReference?(href: string): DurtalLocator | null;
  showNote?(
    href: string,
    options?: {
      reference?: Element;
      originMark?: string;
      keyboard?: boolean;
      force?: boolean;
    },
  ): Promise<boolean>;
  closeNote?(): void;
  search?(request: SearchRequest): AsyncIterable<SearchUpdate>;
  fixedPages?(): TocItem[] | null;
  adjustFixedZoom?(direction: -1 | 0 | 1): void;
  fixedZoom?(): number | null;
  setFixedZoom?(percent: number | null): void;
  currentLocator(): DurtalLocator | null;
  setPresentation(presentation: Presentation): void;
  /** A locator for the current selection inside the book, or null */
  locatorFromSelection(): DurtalLocator | null;
  /** A book-document origin is exact; an absent origin uses the current selection document. */
  selectionDetails(origin?: Document): SelectionDetails | null;
  /** With an action capture, clear only its still-current native range. */
  clearSelection(expected?: SelectionDetails): void;
  resolve(locator: DurtalLocator): Promise<ResolveResult>;
  resolveAnnotation(
    annotation: { kind: "highlight" | "bookmark"; locator: DurtalLocator },
    options?: { signal?: AbortSignal },
  ): Promise<AnnotationResolveResult>;
  on<K extends keyof EngineEvents>(
    name: K,
    handler: (detail: EngineEvents[K]) => void,
  ): () => void;
}
