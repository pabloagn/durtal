/**
 * The few types the adapter uses from the vendored foliate-js
 * (src/vendor/foliate-js/, plain JavaScript excluded from tsc and lint).
 * The adapter casts each dynamic import to these.
 */

export interface ZipEntry {
  filename: string;
  directory: boolean;
  compressedSize: number;
  uncompressedSize: number;
  /** Where its local header starts */
  offset?: number;
  /** 0 stored, 8 deflated */
  compressionMethod?: number;
  getData<T>(writer: unknown): Promise<T>;
}

export interface ZipReaderLike {
  readonly size: number;
  readUint8Array(index: number, length: number): Promise<Uint8Array>;
}

export interface ZipModule {
  configure(options: { useWebWorkers: boolean }): void;
  ZipReader: new (reader: ZipReaderLike) => {
    getEntries(): Promise<ZipEntry[]>;
    comment: Uint8Array;
    close(): Promise<void>;
  };
  TextWriter: new () => unknown;
  BlobWriter: new (type?: string) => unknown;
}

export interface ZipLoader {
  entries: { filename: string }[];
  loadText(name: string): Promise<string | null>;
  loadTextOwned?(name: string, signal: AbortSignal): Promise<string | null>;
  loadBlob(name: string, type?: string): Promise<Blob | null>;
  getSize(name: string): number;
  /** Up to `want` bytes from the start of an entry's data, without reading all of it (Durtal's loader) */
  readHead?(name: string, want: number): Promise<Uint8Array | null>;
  getComment(): Promise<string | null>;
  sha1?: (text: string) => Promise<Uint8Array>;
  scanIndex?(
    name: string,
    fragments: string[],
    signal: AbortSignal,
  ): Promise<import("./position-index").MarkupIndex>;
}

export interface FoliateSection {
  id: string | number;
  linear?: string;
  size: number;
  cfi?: string;
  pageSpread?: string;
  load?(): Promise<string | import("./pdf-book").PdfFixedPageSource>;
  loadContent?(): Promise<string | null>;
  unload?(): void;
  createDocument?(options?: { signal: AbortSignal }): Promise<Document>;
  resolveHref?(href: string): string;
  loadText?(): Promise<string | null> | string;
}

export interface FoliateTocEntry {
  label?: string;
  href?: string;
  subitems?: FoliateTocEntry[] | null;
}

export type Localized = string | Record<string, string>;
export type Contributor =
  | Localized
  | { name?: Localized }
  | (Localized | { name?: Localized })[];

export interface FoliateBook {
  metadata?: {
    title?: Localized;
    author?: Contributor;
    language?: string | string[];
  };
  dir?: string;
  rendition?: { layout?: string; viewport?: { width: number; height: number }; spread?: "auto" | "none" | "landscape" | "portrait" | "both" };
  setTwoPages?(twoPages: boolean): void;
  setPdfPresentation?(next: import("@/lib/validations/reader-preferences").ReaderPresentation): boolean;
  pdfCropOffset?(doc: Document): { left: number; top: number };
  pdfViewport?(doc: Document): import("./pdf-geometry").PdfViewport | null;
  sections: FoliateSection[];
  toc?: FoliateTocEntry[];
  pageList?: FoliateTocEntry[];
  loadText?(href: string): Promise<string | null>;
  loadBlob?(href: string): Promise<Blob | null>;
  resources?: {
    opf: Document;
    manifest: { href: string; mediaType: string }[];
    getItemByID(id: string): { href: string } | undefined;
  };
  splitTOCHref?(
    href: string,
  ): [string | number, unknown] | Promise<[string | number, unknown]>;
  getTOCFragment?(doc: Document, fragment: unknown): Element | null;
  indexFragment?(fragment: unknown): string;
  resolveHref(href: string):
    | { index: number; anchor?: (doc: Document) => Range | Element }
    | null
    | Promise<{
        index: number;
        anchor?: (doc: Document) => Range | Element;
      } | null>;
  isExternal?(href: string): boolean;
  /** An EPUB's loader events: `load` before each resource, `data` after (foliate-js) */
  transformTarget?: EventTarget;
  destroy?(): void;
}

export interface FoliateProgress {
  /** Of the whole book */
  fraction: number;
  location?: { current: number; next: number; total: number };
  tocItem?: { label?: string; href?: string } | null;
  pageItem?: { label?: string } | null;
  cfi: string;
  range: Range | null;
  /** Durtal patch 3 */
  index: number;
  sectionFraction: number;
  reason?: string;
}

export interface FoliateOverlayer {
  add(
    key: string,
    range: Range,
    draw: (
      rects: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
      }[],
      options?: Record<string, unknown>,
    ) => SVGElement,
    options: Record<string, unknown>,
  ): void;
  remove(key: string): void;
  /** The layer's SVG, laid over the section's frame */
  readonly element?: SVGSVGElement;
}
export interface FoliateRenderer extends HTMLElement {
  setStyles?(styles: string | [string, string]): void;
  getContents(): {
    doc: Document;
    index: number;
    overlayer?: FoliateOverlayer;
  }[];
  primaryIndex?: number;
  refreshPageSizes?(): void;
  /** Lays every loaded section out again; the paginator only */
  render?(): void;
  showPageRect?(index: number, rect: { left: number; top: number; right: number; bottom: number }): boolean;
  atEnd: boolean;
  /** The paginator in the scroll flow; absent on fixed-layout renderers */
  readonly scrolled?: boolean;
  /** The container's length along the flow, in pixels */
  readonly size?: number;
  containerPosition?: number;
  /** Exact target only during the renderer's synchronous native anchor focus. */
  readonly navigationAnchorFocus?: Element | null;
  heads?: HTMLElement[] | null;
  feet?: HTMLElement[] | null;
  goTo(target: {
    index: number;
    anchor?: number | ((doc: Document) => number | Range | Element);
  }): Promise<void>;
  destroy?(): void;
}

export interface FoliateView extends HTMLElement {
  book: FoliateBook;
  renderer: FoliateRenderer;
  lastLocation: FoliateProgress | null;
  getSectionFractions(): number[];
  getProgressOf(
    index: number,
    range: Range,
  ): { tocItem?: FoliateTocEntry | null; pageItem?: FoliateTocEntry | null };
  addAnnotation(
    annotation: {
      value: string;
      color?: string;
      group?: string;
      current?: boolean;
    },
    remove?: boolean,
  ): Promise<unknown>;
  open(book: FoliateBook): Promise<void>;
  close(): void;
  init(options: {
    lastLocation?: unknown;
    showTextStart?: boolean;
  }): Promise<void>;
  goTo(target: unknown): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  /** In the scroll flow, distance is how far to scroll (a screen without it) */
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  getCFI(index: number, range?: Range): string;
  resolveNavigation(
    target: unknown,
  ): { index: number; anchor?: (doc: Document) => Range | Element } | undefined;
}

export interface EpubModule {
  EPUB: new (loader: ZipLoader) => { init(): Promise<FoliateBook> };
}

export interface ComicModule {
  makeComicBook(
    loader: ZipLoader,
    file: { name: string },
  ): Promise<FoliateBook>;
}

export interface Fb2Module {
  makeFB2(
    blob:
      | Blob
      | {
          size: number;
          type: string;
          name: string;
          arrayBuffer(): Promise<ArrayBuffer>;
        },
  ): Promise<FoliateBook>;
}

export interface MobiModule {
  isMOBI(file: unknown): Promise<boolean>;
  MOBI: new (options: { unzlib: unknown }) => {
    open(file: unknown): Promise<FoliateBook>;
  };
}

export interface PdfModule {
  configurePDFJS(config: {
    base?: string;
    load?: () => Promise<unknown>;
  }): void;
  makePDF(file: unknown): Promise<FoliateBook>;
}
