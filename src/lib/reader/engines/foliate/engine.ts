import { indexDiagnosticEnabled, observeIndexDiagnostic } from "@/lib/reader/index-diagnostics";
import { flattenContents } from "@/lib/reader/position-index";
import { pageMarkerPhysicallyVisible } from "./page-marker-visibility";
import type { PdfSearchProvider } from "./search";
import { attachWordGestures, detailsFromRange, frameRectToHost, selectionHostRect } from "./selection";
import { createNotes } from "./notes";
import type { SearchRequest, SearchUpdate } from "../../search/types";
import {
  classifyReaderLink,
  EXTERNAL_WINDOW_FEATURES,
} from "../../links/policy";
import { createFoliateSpeech } from "./speech";
import type {
  SpeechPreparation,
  SpeechSegment,
} from "@/lib/reader/speech/player";
import type {
  BookInfo,
  BookSource,
  DurtalLocator,
  EngineEvents,
  GoToTarget,
  OpenErrorKind,
  OpenOptions,
  Presentation,
  ReaderEngine,
  ReaderFormat,
  ResolveResult,
  SelectionDetails,
  TocItem,
  NavigationOwner,
  Marginalia,
  PdfTextPageRequest,
  Decoration,
  AnnotationResolveResult,
} from "@/lib/reader/engine";
import { fixedSpreadMode, fixedZoomScale, clampFixedZoom, stepFixedZoom } from "./fixed";
import { PublisherInk } from "./publisher-ink";
import { preparePageInk } from "./page-ink-preparation";
import { PdfDecorations } from "./pdf-decorations";
import { resolvePdfAnnotation } from "./pdf-annotation-resolver";
import { preparePdfSpeech } from "./pdf-speech";
import { pdfRectToPage } from "./pdf-geometry";
import { FoliateAnnotationResolver } from "./annotation-resolver";
import { FoliateDecorations } from "./decorations";
import { presentationCss, policyTypographyCss } from "@/lib/reader/presentation";
import { bookCSS } from "@/lib/reader/presentation/book-css";
import { themeColours } from "@/lib/reader/presentation/themes";
import { paginatorAttributes, turnAttributes } from "@/lib/reader/presentation/layout";
import { CHAR_WIDTH_EM } from "@/lib/reader/presentation/fonts";
import { canPreflightCoreFonts, routeFontPresentation, fontPresentationChangeKind } from "@/lib/reader/presentation/font-route";
import { createManagedReaderFontAssets } from "@/lib/reader/presentation/managed-font-assets";
import { UNKNOWN_FONT_FACTS, type FontWindowFacts } from "@/lib/reader/presentation/font-facts";
import { guardFontResourceLoad } from "./font-resource-gate";
import { adaptTypographyDeclaration } from "@/lib/reader/presentation/style-policy";
import { PDFJS_BASE } from "@/lib/reader/first-range";
import { ReadError, RangeSource, RemoteBlob } from "./remote-blob";
import { DeferredImages } from "./deferred-images";
import { makeRangeZipLoader } from "./zip-reader";
import { takePdfWorker } from "./preload";
import { openPdfSession, type PdfSession } from "./pdf-session";
import { makePdfBook } from "./pdf-book";
import { bindPdfTextProvider, type PdfTextProvider } from "./pdf-text-provider";
import { clientRectToPdf, pdfLocatorFromGeometry } from "./pdf-geometry";
import {
  locatorFromRelocate,
  placeCfi,
  quoteFromSelection,
  visibleOriginRange,
} from "./locator";
import { findPageMap, parsePageMap } from "./page-map";
import { buildAnchorIndex, indexFragment, scanMarkup } from "./position-index";
import { matchQuote } from "./quote-match";
import { watchTooltipKeys } from "@/lib/ui/tooltip-keys";
import type {
  Contributor,
  EpubModule,
  Fb2Module,
  FoliateBook,
  FoliateProgress,
  FoliateTocEntry,
  FoliateView,
  Localized,
  MobiModule,
  ZipLoader,
  ZipModule,
} from "./foliate";

/**
 * The ReaderEngine on foliate-js (eBooks sub-issue 3), the only code that
 * imports src/vendor/foliate-js/. The engine loads only in the browser,
 * through dynamic imports, and reads the file by HTTP Range: a zip reader
 * for EPUB, FB2Z and CBZ, a remote Blob for MOBI, AZW3, FB2 and PDF.
 */

type AnyHandler = (detail: never) => void;
type SelectedRange = { range: Range; index: number; text: string };

/** The part of the screen a page turn reads, in the page's coordinates */
type ViewBox = { top: number; bottom: number; left: number; width: number; height: number };

const ZIP_FORMATS = new Set<ReaderFormat>(["epub", "kepub", "fbz", "cbz"]);
/** How far an arrow key scrolls a scrolled book: about two lines */
const SCROLL_LINE_PX = 48;

/** What later sub-issues may offer, per format */
function capabilitiesFor(format: ReaderFormat): BookInfo["capabilities"] {
  if (format === "cbz")
    return { search: false, tts: false, spreads: true, scrolled: false };
  if (format === "pdf")
    return { search: true, tts: true, spreads: true, scrolled: false };
  return { search: true, tts: true, spreads: true, scrolled: true };
}

function localized(value: Localized | undefined): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return Object.values(value)[0] ?? "";
}

function contributors(value: Contributor | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((c) =>
      typeof c === "object" && c !== null && "name" in c
        ? localized(c.name)
        : localized(c as Localized),
    )
    .map((name) => name.trim())
    .filter(Boolean);
}

function tocFrom(entries: FoliateTocEntry[] | undefined): TocItem[] {
  return (entries ?? [])
    .filter((entry) => entry.href || entry.subitems?.length)
    .map((entry) => ({
      label: (entry.label ?? "").trim() || "Untitled",
      href: entry.href ?? "",
      subitems: tocFrom(entry.subitems ?? undefined),
    }));
}

/** What a failure means to the reader: damaged, unsupported, no connection or expired */
export function openErrorKind(error: unknown): OpenErrorKind {
  if (error instanceof ReadError) return error.kind;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypt|drm/i.test(name + message)) return "unsupported";
  if (/not supported|unsupported|No supported/i.test(message))
    return "unsupported";
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(message))
    return "network";
  return "damaged";
}

const ERROR_MESSAGES: Record<OpenErrorKind, string> = {
  damaged: "The file is damaged or not a valid eBook.",
  unsupported: "This kind of file cannot be read here.",
  network: "The file could not be downloaded. Check the connection.",
  expired: "The link to the file expired and could not be renewed.",
};

class FoliateEngine implements ReaderEngine {
  #handlers = new Map<keyof EngineEvents, Set<AnyHandler>>();
  #view: FoliateView | null = null;
  #book: FoliateBook | null = null;
  #source: BookSource | null = null;
  #range: RangeSource | null = null;
  #pdf: PdfSession | null = null;
  #pdfCss = "";
  #pdfTextProvider: PdfTextProvider | null = null;
  #pdfTarget: DurtalLocator | null = null;
  // An explicit printed-page target remains current while its real marker is
  // visible. Ordinary turns continue to use Foliate's natural visible-page label.
  #pageTarget: { label: string; index: number; anchor(doc: Document): Range | Element } | null = null;
  #fixedZoom: number | null = null;
  /** The reader's bars, top and bottom, kept clear of the text (SLN-663) */
  #insets = { top: 0, bottom: 0, pinned: false };
  #covered = { top: 0, bottom: 0 };
  #coveredNow: { top: number; bottom: number } | null = null;
  #ink = new PublisherInk(() => this.#emit("error", { kind: "damaged", message: "The book colours could not be prepared. Try opening the book again." }));
  #pdfMarks = new PdfDecorations(event => this.#emit("annotation-activated", event));
  #opening = new AbortController();
  #locator: DurtalLocator | null = null;
  #jumping = 0;
  #turning = 0;
  #destroyed = false;
  #selectionTimer: ReturnType<typeof setTimeout> | null = null;
  #wordGestureDetach = new WeakMap<Document, () => void>();
  #wordGestureDocs = new Set<WeakRef<Document>>();
  #hadSelection = false;
  #selectionDocument: WeakRef<Document> | null = null;
  #selectionGeneration = 0;
  #nativeSelectionRevision = 0;
  #selectionCaptures = new WeakMap<SelectionDetails, { revision: number; range: Range; doc: Document }>();
  #keyboardSelection = false;
  /** A reflowable EPUB's large images, shown after its text */
  #images: DeferredImages | null = null;
  #info: BookInfo | null = null;
  #zip: ZipLoader | null = null;
  #readingFraction = 0;
  #owner: NavigationOwner | undefined;
  #presentation: Presentation | null = null;
  #requestedPresentation: Presentation | null = null;
  #fontEpoch = 0;
  #fontAssets = createManagedReaderFontAssets(location.origin);
  #appliedPresentation: Presentation | null = null;
  #fontFacts: FontWindowFacts = UNKNOWN_FONT_FACTS;
  #layoutObserver: ResizeObserver | null = null;
  #publisherDeclarations = new WeakMap<CSSStyleDeclaration, Map<string, { value: string; priority: string }>>();
  #marginalia: Marginalia | null = null;
  #marginaliaHidden = false;
  #annotationResolver: FoliateAnnotationResolver | null = null;
  #decorations: FoliateDecorations | null = null;
  #decorationSets = new Map<string, Decoration[]>();
  #decorationLoading: Promise<void> | null = null;
  #searchAbort: AbortController | null = null;
  // Bind SLN-502's accepted opened PdfSession here, with its text-layer CSS.
  // Until that source lands, PDF search explicitly surfaces the missing producer.
  #pdfSearchProvider: PdfSearchProvider | undefined;
  #searchMarks: { cfi: string; color: string; current?: boolean }[] = [];
  #searchMarkEpoch = 0;
  #searchMarkWork: Promise<void> = Promise.resolve();
  #paintedSearchMarks: string[] = [];
  #documents = new WeakMap<Document, number>();
  #blockedLinkLogged = false;
  #notes: ReturnType<typeof createNotes> | null = null;
  #mediaDocs = new Set<WeakRef<Document>>();
  #mediaDetach = new WeakMap<Document, () => void>();
  #markTimer: ReturnType<typeof setTimeout> | null = null;

  /** Bytes and requests so far, for the performance harness */
  get transfer() {
    return {
      bytes: this.#pdf?.range.transferred ?? this.#range?.transferred ?? 0,
      requests: this.#pdf?.range.requests ?? this.#range?.requests ?? 0,
    };
  }

  on<K extends keyof EngineEvents>(
    name: K,
    handler: (detail: EngineEvents[K]) => void,
  ): () => void {
    let set = this.#handlers.get(name);
    if (!set) this.#handlers.set(name, (set = new Set()));
    const handlers = set;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  #emit<K extends keyof EngineEvents>(name: K, detail: EngineEvents[K]) {
    const set = this.#handlers.get(name) as
      | Set<(detail: EngineEvents[K]) => void>
      | undefined;
    set?.forEach((handler) => handler(detail));
  }

  async #makeBook(
    source: BookSource,
    range: RangeSource,
  ): Promise<FoliateBook> {
    const name = `book.${source.format}`;
    if (source.format === "pdf") {
      const base = new URL(PDFJS_BASE, location.href).href;
      const [api, response] = await Promise.all([
        import("pdfjs-dist"),
        fetch(new URL("layers.css", base), { signal: this.#opening.signal }),
      ]);
      this.#opening.signal.throwIfAborted();
      if (!response.ok) throw new ReadError("network", "PDF text-layer styles could not be loaded");
      this.#pdfCss = await response.text();
      this.#opening.signal.throwIfAborted();
      const session = await openPdfSession(api, source, base, location.origin, (url) =>
        takePdfWorker() ?? new Worker(url, { type: "module", name: "durtal-pdf" }), this.#opening.signal);
      this.#pdf = session;
      if (this.#destroyed) {
        await session.destroy();
        throw new DOMException("The PDF was closed while opening", "AbortError");
      }
      void session.failure.catch((error: unknown) => {
        if (this.#destroyed || this.#pdf !== session) return;
        this.#pdfTextProvider = null;
    this.#pdfSearchProvider = undefined;
        this.#pdfCss = "";
        const kind = openErrorKind(error);
        this.#emit("error", { kind, message: ERROR_MESSAGES[kind] });
      });
      try {
        const book = await makePdfBook(session, api, this.#pdfCss, this.#presentation?.policy);
        this.#opening.signal.throwIfAborted();
        this.#pdfTextProvider = bindPdfTextProvider(session, this.#pdfCss);
        this.#pdfSearchProvider = this.#pdfTextProvider;
        return book;
      } catch (error) {
        await session.destroy();
        if (this.#pdf === session) this.#pdf = null;
        this.#pdfTextProvider = null;
    this.#pdfSearchProvider = undefined;
        this.#pdfCss = "";
        throw error;
      }
    }
    if (ZIP_FORMATS.has(source.format)) {
      const zip =
        (await import("@/vendor/foliate-js/vendor/zip.js")) as unknown as ZipModule;
      const loader: ZipLoader = await makeRangeZipLoader(zip, range);
      this.#zip = loader;
      if (source.format === "cbz") {
        const { makeDurtalComicBook } = await import("./comic-book");
        return makeDurtalComicBook(loader, name);
      }
      if (source.format === "fbz") {
        const { makeFB2 } =
          (await import("@/vendor/foliate-js/fb2.js")) as unknown as Fb2Module;
        const entry =
          loader.entries.find((e) => e.filename.endsWith(".fb2")) ??
          loader.entries[0];
        const blob = entry ? await loader.loadBlob(entry.filename) : null;
        if (!blob)
          throw new Error("No FB2 document in the archive: not supported");
        return makeFB2(blob);
      }
      // Fonts obfuscated with the IDPF algorithm need WebCrypto, which only
      // a secure context has. On plain http they are skipped: the key is
      // empty, the font stays unreadable and the reading font is used.
      if (!globalThis.crypto?.subtle)
        loader.sha1 = async () => new Uint8Array(0);
      const { EPUB } =
        (await import("@/vendor/foliate-js/epub.js")) as unknown as EpubModule;
      const book = await new EPUB(loader).init();
      if (!book.pageList?.length) {
        const href = findPageMap(book);
        if (href) {
          const xml = await loader.loadText(href);
          if (xml) book.pageList = parsePageMap(xml, href);
        }
      }
      if (book.rendition?.layout !== "pre-paginated" && book.transformTarget) {
        this.#images = new DeferredImages(loader);
        this.#images.attach(book.transformTarget);
      }
      return book;
    }
    const blob = new RemoteBlob(range, contentTypeOf(source.format), name);
    if (source.format === "fb2") {
      const { makeFB2 } =
        (await import("@/vendor/foliate-js/fb2.js")) as unknown as Fb2Module;
      return makeFB2(blob);
    }
    const { isMOBI, MOBI } =
      (await import("@/vendor/foliate-js/mobi.js")) as unknown as MobiModule;
    if (!(await isMOBI(blob)))
      throw new Error("Not a MOBI or AZW3 file: not supported");
    const fflate =
      (await import("@/vendor/foliate-js/vendor/fflate.js")) as unknown as {
        unzlibSync: unknown;
      };
    return new MOBI({ unzlib: fflate.unzlibSync }).open(blob);
  }

  async open(
    source: BookSource,
    { container, presentation, at }: OpenOptions,
  ): Promise<{ resolved: ResolveResult | null }> {
    this.#source = source;
    this.#fontFacts = UNKNOWN_FONT_FACTS;
    this.#appliedPresentation = null;
    // The server makes no speculative reading-font preload. Resolve the selected
    // full/publisher family before book construction can request any resource.
    this.#presentation = this.#fontPresentation(this.#presentation ?? presentation);
    this.#requestedPresentation = this.#presentation;
    this.#readingFraction =
      at && "v" in at
        ? at.totalProgression
        : at && "fraction" in at
          ? at.fraction
          : 0;
    this.#range = new RangeSource({
      ebookId: source.ebookId,
      url: source.url,
      fallbackUrl: source.fallbackUrl,
      size: source.size,
      refreshUrl: source.refreshUrl,
      prefetch: source.prefetch,
    });
    let book: FoliateBook;
    try {
      book = await this.#makeBook(source, this.#range);
      if (!book.sections?.length) throw new Error("The book has no pages");
    } catch (error) {
      const kind = openErrorKind(error);
      this.#emit("error", { kind, message: ERROR_MESSAGES[kind] });
      throw error;
    }
    if (this.#destroyed) return { resolved: null };
    this.#book = book;
    await this.#prepareBookFonts(book);
    this.#opening.signal.throwIfAborted();
    this.#guardBookFontResources(book);
    this.#notes = createNotes({
      book,
      document: container.ownerDocument,
      getCFI: (index, range) => this.#view!.getCFI(index, range),
      readingFont: () => ({
        fontFamily: this.#presentation?.fontFamily ?? "Georgia, serif",
        fontFaces: this.#presentation?.fontFaces ?? "",
      }),
      readingBusy: () => this.#turning > 0 || this.#jumping > 0,
      resolve: (href) =>
        href.startsWith("epubcfi(")
          ? this.#view?.resolveNavigation(href)
          : undefined,
      publish: (note) => this.#emit("note", note),
    });
    await import("@/vendor/foliate-js/view.js");
    const view = document.createElement("foliate-view") as FoliateView;
    view.style.display = "block";
    view.style.width = "100%";
    view.style.height = "100%";
    view.addEventListener("relocate", (e) =>
      this.#onRelocate((e as CustomEvent<FoliateProgress>).detail),
    );
    view.addEventListener("load", (e) =>
      this.#onLoad((e as CustomEvent<{ doc: Document; index: number; signal?: AbortSignal; waitUntil?: (promise: Promise<void>) => void }>).detail),
    );
    view.addEventListener("create-overlay", () => {
      // The renderer attaches the overlayer after dispatch returns.
      queueMicrotask(() => {
        if (this.#view === view) this.#decorations?.render(view);
      });
    });
    view.addEventListener("show-annotation", (event) => {
      const { value, index, rect } = (
        event as CustomEvent<{
          value: string;
          index: number;
          rect?: { left: number; top: number; right: number; bottom: number };
        }>
      ).detail;
      const mark = this.#decorations?.hit(view, value, index);
      const doc = view.renderer
        .getContents()
        .find((content) => content.index === index)?.doc;
      if (!mark || !rect || !doc || this.#selected()) return;
      const frame = doc.defaultView?.frameElement as HTMLElement | null;
      const host = frame?.getBoundingClientRect();
      const sx =
        host && frame ? host.width / (frame.offsetWidth || host.width) : 1;
      const sy =
        host && frame ? host.height / (frame.offsetHeight || host.height) : 1;
      this.#emit("annotation-activated", {
        group: mark.group,
        decorationId: mark.item.id,
        rect: {
          left: (host?.left ?? 0) + rect.left * sx,
          right: (host?.left ?? 0) + rect.right * sx,
          top: (host?.top ?? 0) + rect.top * sy,
          bottom: (host?.top ?? 0) + rect.bottom * sy,
        },
      });
    });
    view.addEventListener("link", (e) => {
      // Durtal owns history and publication; the vendored default must never jump in parallel.
      e.preventDefault();
      const { href, a } = (e as CustomEvent<{ href: string; a?: Element }>)
        .detail;
      let originMark: string | undefined;
      if (a) {
        const range = a.ownerDocument.createRange();
        range.selectNodeContents(a);
        const index = this.#documents.get(a.ownerDocument);
        if (index != null) originMark = view.getCFI(index, range);
      }
      const policy = classifyReaderLink(href);
      if (policy.kind === "external") {
        window.open(policy.href, "_blank", EXTERNAL_WINDOW_FEATURES);
        this.#emit("link", { href: policy.href, external: true });
      } else if (policy.kind === "internal") {
        void this.showNote(href, {
          reference: a,
          originMark,
          keyboard: (e as CustomEvent<{ keyboard?: boolean }>).detail.keyboard,
        }).then((shown) => {
          if (!shown && !this.#destroyed)
            this.#emit("link", { href, external: false, originMark });
        });
      } else this.#blockedLink();
    });
    view.addEventListener("external-link", (e) => {
      // Opened in a new tab with no reference back to the reader
      e.preventDefault();
      const { href } = (e as CustomEvent<{ href: string }>).detail;
      const policy = classifyReaderLink(href);
      if (policy.kind !== "external") {
        this.#blockedLink();
        return;
      }
      this.#emit("link", { href: policy.href, external: true });
      window.open(policy.href, "_blank", EXTERNAL_WINDOW_FEATURES);
    });
    container.append(view);
    this.#view = view;
    await view.open(book);
    // Swipes, taps and the wheel belong to the reader's input layer (src/lib/reader/input.ts)
    view.renderer.setAttribute("no-swipe", "");
    // Apply the prepared latest request before ready; replaying the public setter
    // would restart an asynchronous cache-miss lookup and delay initial typography.
    let preparedEpoch: number;
    do {
      preparedEpoch = await this.#preparePresentationFonts();
    } while (preparedEpoch !== this.#fontEpoch);
    this.#applyPresentation(this.#presentation ?? presentation);
    this.#layoutObserver = new ResizeObserver(() => this.#applyLayout());
    this.#layoutObserver.observe(view);

    const sizes = book.sections.map((section) =>
      section.linear !== "no" && section.size > 0 ? section.size : 0,
    );
    const linearSize = sizes.reduce((sum, size) => sum + size, 0);
    const fractions = this.sectionFractions();
    const info: BookInfo = {
      title: localized(book.metadata?.title),
      authors: contributors(book.metadata?.author),
      language:
        (Array.isArray(book.metadata?.language)
          ? book.metadata?.language[0]
          : book.metadata?.language) ?? null,
      dir: book.dir === "rtl" ? "rtl" : "ltr",
      layout:
        book.rendition?.layout === "pre-paginated"
          ? "pre-paginated"
          : "reflowable",
      capabilities: capabilitiesFor(source.format),
      toc: tocFrom(book.toc),
      pageList: tocFrom(book.pageList),
      linearSize,
      locationCount: Math.max(1, Math.ceil(linearSize / 1500)),
      sections: book.sections.map((section, index) => ({
        href: String(section.id ?? index),
        label: "Section " + (index + 1),
        linear: section.linear !== "no",
        start: fractions[index] ?? 0,
        end: fractions[index + 1] ?? 1,
      })),
    };
    // MOBI hrefs use filepos/kindle addresses, rather than a spine path.
    const mapSections = (entries: TocItem[]) => {
      for (const entry of entries) {
        try {
          const split = book.splitTOCHref?.(entry.href);
          if (split && !(split instanceof Promise)) {
            const index = book.sections.findIndex(
              (section) => String(section.id) === String(split[0]),
            );
            if (index >= 0) entry.sectionIndex = index;
          }
        } catch {
          /* Invalid publisher hrefs remain navigable through the adapter. */
        }
        mapSections(entry.subitems);
      }
    };
    mapSections(info.toc);
    mapSections(info.pageList);
    this.#info = info;
    this.#emit("ready", info);

    let resolved: ResolveResult | null = null;
    if (at && "fraction" in at) {
      await this.goTo(at);
      resolved = { status: "approximate", locator: this.#locator };
    } else if (at) {
      resolved = await this.resolve(at).catch(() => ({
        status: "failed" as const,
        locator: null,
      }));
      // A place saved before SLN-676 is a visible range: open at its start point
      if (resolved.locator)
        await this.goTo(resolved.locator.cfi ? { ...resolved.locator, cfi: placeCfi(resolved.locator.cfi) } : resolved.locator);
    }
    if (!resolved?.locator) {
      if (indexDiagnosticEnabled()) observeIndexDiagnostic("engine-initial-start-start");
      await this.#start();
      if (indexDiagnosticEnabled()) observeIndexDiagnostic("engine-initial-start-return");
    }
    if (indexDiagnosticEnabled()) observeIndexDiagnostic("engine-open-ink-start");
    await this.#waitInk();
    if (indexDiagnosticEnabled()) observeIndexDiagnostic("engine-open-ink-return");
    return { resolved };
  }

  /** The first page */
  async #start() {
    this.#jumping++;
    try {
      await this.#view?.init({ showTextStart: false });
    } finally {
      this.#jumping--;
    }
  }

  destroy() {
    this.#destroyed = true;
    ++this.#selectionGeneration;
    this.#opening.abort();
    this.#searchAbort?.abort();
    this.#notes?.destroy();
    this.#notes = null;
    for (const ref of this.#mediaDocs) {
      const doc = ref.deref();
      if (doc) this.#mediaDetach.get(doc)?.();
    }
    this.#mediaDocs.clear();
    for (const ref of this.#wordGestureDocs) {
      const doc = ref.deref();
      if (doc) this.#wordGestureDetach.get(doc)?.();
    }
    this.#wordGestureDocs.clear();
    this.#selectionDocument = null;
    if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
    if (this.#markTimer) clearTimeout(this.#markTimer);
    this.#layoutObserver?.disconnect();
    this.#layoutObserver = null;
    this.#annotationResolver?.destroy();
    this.#annotationResolver = null;
    this.#pdfMarks.destroy();
    this.#decorations?.clear();
    this.#decorations = null;
    this.#decorationLoading = null;
    this.#decorationSets.clear();
    this.#view?.close();
    this.#view?.remove();
    this.#book?.destroy?.();
    this.#fontEpoch++;
    this.#fontAssets.dispose();
    void this.#pdf?.destroy().catch(() => {});
    this.#pdf = null;
    this.#pdfTextProvider = null;
    this.#pdfSearchProvider = undefined;
    this.#pdfCss = "";
    this.#images?.destroy();
    this.#images = null;
    this.#view = null;
    this.#book = null;
    this.#handlers.clear();
  }

  #isPdf() {
    return this.#source?.format === "pdf";
  }

  pdfPageText(request: PdfTextPageRequest) {
    if (!this.#pdfTextProvider || this.#destroyed)
      return Promise.reject(new Error("This opened book has no PDF text provider"));
    return this.#pdfTextProvider.pdfPageText(request);
  }

  locatorForPdfTextOffsets(request: PdfTextPageRequest & { start: number; end: number }) {
    if (!this.#pdfTextProvider || this.#destroyed)
      return Promise.reject(new Error("This opened book has no PDF text provider"));
    return this.#pdfTextProvider.locatorForPdfTextOffsets(request);
  }

  #onRelocate(detail: FoliateProgress) {
    const book = this.#book;
    if (!book || !this.#source) return;
    const index = Number.isInteger(detail.index) ? detail.index : 0;
    const section = book.sections[index];
    const linear = section?.linear !== "no";
    // Section-boundary turns use the renderer's navigation path; scrolled
    // keyboard turns may have no raw reason. Their adapter operation owns them.
    const turnNavigation =
      this.#turning > 0 &&
      (detail.reason === "navigation" || detail.reason == null);
    const reason =
      this.#jumping > 0
        ? "jump"
        : turnNavigation ||
            ["page", "snap", "scroll"].includes(detail.reason ?? "")
          ? "turn"
          : "layout";
    const relocationOrigin =
      reason === "layout" ? "layout" : (this.#owner?.origin ?? "human");
    if (reason === "turn") this.#pageTarget = null;
    const pageLabel = this.#visiblePageTarget(detail) ?? detail.pageItem?.label;
    const atEnd =
      linear &&
      index === book.sections.findLastIndex((item) => item.linear !== "no") &&
      !!this.#view?.renderer.atEnd;
    if (linear && relocationOrigin !== "layout")
      this.#readingFraction = atEnd ? 1 : (detail.fraction ?? 0);
    const fraction = this.#readingFraction;
    let locator = locatorFromRelocate({
      fileHash: this.#source.sha256,
      sectionIndex: index,
      href: String(section?.id ?? index),
      sectionFraction: detail.sectionFraction ?? 0,
      fraction,
      location:
        linear && relocationOrigin !== "layout"
          ? detail.location?.current
          : Math.floor((fraction * (this.#info?.linearSize ?? 0)) / 1500),
      cfi: detail.cfi,
      range: detail.range,
      tocLabel: detail.tocItem?.label,
      pageLabel,
      pdfPage: this.#isPdf() ? index + 1 : undefined,
    });
    if (this.#isPdf()) {
      if (reason === "turn" || this.#pdfTarget?.sectionIndex !== index) this.#pdfTarget = null;
      if (this.#pdfTarget) {
        locator = structuredClone(this.#pdfTarget);
        if (relocationOrigin !== "layout") this.#readingFraction = locator.totalProgression;
      }
    }
    this.#locator = locator;
    this.#nameFrames();
    if (locator.position && this.#info)
      locator.position = Math.min(this.#info.locationCount, locator.position);
    if (reason === "turn") this.setDecorations("history", []);
    const tocItem = detail.tocItem?.href
      ? (tocFrom([detail.tocItem])[0] ?? null)
      : null;
    const origin =
      detail.range && !this.#isPdf() ? visibleOriginRange(detail.range) : null;
    this.#writeMarginalia();
    this.#drawSearchMarks();
    this.#drawPdfMarks();
    this.#emit("relocate", {
      locator,
      chapter: detail.tocItem?.label?.trim() || null,
      reason,
      origin: relocationOrigin,
      atEnd: relocationOrigin === "human" && atEnd,
      activity:
        reason === "turn" && relocationOrigin === "human"
          ? detail.reason === "scroll"
            ? "scroll"
            : "turn"
          : undefined,
      tocItem,
      visibleChars: detail.range?.toString().length ?? 0,
      linear,
      paginated:
        book.rendition?.layout !== "pre-paginated" &&
        this.#view?.renderer.getAttribute("flow") !== "scrolled",
      navigationId: this.#owner?.id,
      originMark: origin ? this.#view?.getCFI(index, origin) : undefined,
      atChapterStart: this.#atChapterStart(detail),
    });
  }

  #atChapterStart(detail: FoliateProgress): boolean {
    if (!detail.range || !detail.tocItem?.href || !this.#view)
      return detail.sectionFraction === 0;
    try {
      const doc = detail.range.startContainer.ownerDocument!;
      const split = this.#book?.splitTOCHref?.(detail.tocItem.href);
      const target =
        !split || split instanceof Promise
          ? this.#view.resolveNavigation(detail.tocItem.href)
          : null;
      const anchor =
        split && !(split instanceof Promise) && this.#book?.getTOCFragment
          ? this.#book.getTOCFragment(doc, split[1])
          : target?.index === detail.index
            ? target.anchor?.(doc)
            : null;
      if (!anchor) return detail.sectionFraction === 0;
      if ("startContainer" in anchor)
        return (
          detail.range.comparePoint(
            anchor.startContainer,
            anchor.startOffset,
          ) === 0
        );
      const text = doc.createTreeWalker(anchor, 4).nextNode();
      return !!text && detail.range.comparePoint(text, 0) === 0;
    } catch {
      return false;
    }
  }

  noteReference(href: string): DurtalLocator | null {
    const reference = this.#notes?.reference(href);
    if (!reference || !this.#source || !this.#info) return null;
    const section = this.#info.sections[reference.index];
    return {
      v: 1,
      fileHash: this.#source.sha256,
      href: section.href,
      sectionIndex: reference.index,
      cfi: reference.cfi,
      progression: 0,
      totalProgression: section.start,
    };
  }
  showNote(
    href: string,
    options?: {
      reference?: Element;
      originMark?: string;
      keyboard?: boolean;
      force?: boolean;
    },
  ) {
    const reference = !options?.reference ? this.#notes?.reference(href) : null;
    if (reference && this.#view) {
      const navigation = this.#view.resolveNavigation(reference.cfi);
      const doc = this.#view.renderer
        .getContents()
        .find((entry) => entry.index === reference.index)?.doc;
      const target = doc && navigation?.anchor?.(doc);
      const element =
        target && "startContainer" in target
          ? target.startContainer.parentElement
          : (target as Element | null);
      const a = element?.closest("a[href]") ?? undefined;
      options = { ...options, reference: a, originMark: reference.cfi };
    }
    return this.#notes?.open(href, options) ?? Promise.resolve(false);
  }
  closeNote() {
    this.#notes?.close();
  }

  #blockedLink() {
    if (this.#blockedLinkLogged) return;
    this.#blockedLinkLogged = true;
    console.warn("[reader] Blocked unsafe book link.");
  }

  async *search(request: SearchRequest): AsyncGenerator<SearchUpdate> {
    this.#searchAbort?.abort();
    const controller = new AbortController();
    this.#searchAbort = controller;
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) controller.abort();
    try {
      if (
        !this.#book ||
        !this.#view ||
        !this.#info ||
        !this.#source ||
        this.#destroyed
      )
        return;
      const { searchBook } = await import("./search");
      yield* searchBook(
        {
          book: this.#book,
          view: this.#view,
          info: this.#info,
          fileHash: this.#source.sha256,
          pdf: this.#isPdf(),
          pdfProvider: this.#pdfSearchProvider,
          current: this.#locator,
          rememberDocument: (doc, index, signal) =>
            this.#notes?.remember(doc, index, signal) ?? Promise.resolve(),
          noPdfText: () => {
            if (!this.#info || controller.signal.aborted) return;
            this.#info.capabilities.search = false;
            this.#emit("capabilities", { ...this.#info.capabilities });
          },
        },
        { ...request, signal: controller.signal },
      );
    } finally {
      controller.abort();
      request.signal.removeEventListener("abort", abort);
      if (this.#searchAbort === controller) this.#searchAbort = null;
    }
  }

  #nameFrame(doc: Document, index: number) {
    // Renderer contents can retain a document while its root is absent.
    const root = doc.documentElement;
    if (!root) return;
    const title =
      this.#info?.title || localized(this.#book?.metadata?.title) || "Book";
    const frame = doc.defaultView?.frameElement;
    const chapter =
      index === this.#locator?.sectionIndex
        ? (this.#locator.tocLabel ?? this.#info?.sections[index]?.label)
        : this.#info?.sections[index]?.label;
    if (frame) {
      frame.setAttribute(
        "aria-label",
        chapter ? `${title}, ${chapter}` : title,
      );
      frame.removeAttribute("aria-hidden");
      frame.removeAttribute("inert");
      frame.setAttribute("tabindex", "0");
    }
    if (!root.getAttribute("lang"))
      root.setAttribute(
        "lang",
        root.getAttributeNS(
          "http://www.w3.org/XML/1998/namespace",
          "lang",
        ) ??
          root.getAttribute("xml:lang") ??
          this.#info?.language ??
          (Array.isArray(this.#book?.metadata?.language)
            ? this.#book.metadata.language[0]
            : this.#book?.metadata?.language) ??
          "und",
      );
  }
  #nameFrames() {
    for (const { doc, index } of this.#view?.renderer.getContents() ?? [])
      this.#nameFrame(doc, index);
  }

  focusBook() {
    const contents = this.#view?.renderer.getContents() ?? [];
    const doc = (
      contents.find((item) => item.index === this.#locator?.sectionIndex) ??
      contents[0]
    )?.doc;
    if (!doc) return;
    const frame = doc.defaultView?.frameElement;
    if (frame && "focus" in frame && typeof frame.focus === "function")
      frame.focus({ preventScroll: true });
    if (doc.body) {
      doc.body.tabIndex = -1;
      doc.body.focus({ preventScroll: true });
    }
  }

  locatorRect(locator: DurtalLocator): { left: number; top: number; right: number; bottom: number } | null {
    if (!this.#source || locator.fileHash !== this.#source.sha256 || !this.#view) return null;
    try {
      if (locator.pdf) {
        const content = this.#view.renderer.getContents().find(item => item.index + 1 === locator.pdf?.page);
        const viewport = content && this.#book?.pdfViewport?.(content.doc);
        const frame = content?.doc.defaultView?.frameElement as HTMLElement | null | undefined;
        const first = locator.pdf.rects?.[0];
        const box = viewport && first && pdfRectToPage(first, viewport, this.#book?.pdfCropOffset?.(content!.doc) ?? { left: 0, top: 0 });
        if (!frame || !box) return null;
        const host = frame.getBoundingClientRect();
        const scaleX = host.width / (frame.offsetWidth || host.width || 1);
        const scaleY = host.height / (frame.offsetHeight || host.height || 1);
        return { left: host.left + box.left * scaleX, top: host.top + box.top * scaleY,
          right: host.left + box.right * scaleX, bottom: host.top + box.bottom * scaleY };
      }
      if (!locator.cfi) return null;
      const resolved = this.#view.resolveNavigation(locator.cfi);
      const doc = this.#view.renderer.getContents().find((item) => item.index === resolved?.index)?.doc;
      if (!doc || !resolved?.anchor) return null;
      const anchor = resolved.anchor(doc);
      const range = "nodeType" in anchor ? doc.createRange() : anchor;
      if ("nodeType" in anchor) range.selectNodeContents(anchor);
      // The first line only: a match that wraps would otherwise span the column
      const line = range.getClientRects()[0];
      if (!line) return null;
      const rect = frameRectToHost(line, doc);
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    } catch {
      return null;
    }
  }

  selectSpeechSentence(locator: DurtalLocator): boolean {
    if (
      !this.#source ||
      locator.fileHash !== this.#source.sha256 ||
      !locator.cfi ||
      !this.#view
    )
      return false;
    const resolved = this.#view.resolveNavigation(locator.cfi);
    const doc = this.#view.renderer
      .getContents()
      .find((item) => item.index === resolved?.index)?.doc;
    if (!doc || !resolved?.anchor) return false;
    const anchor = resolved.anchor(doc);
    const range = "nodeType" in anchor ? doc.createRange() : anchor;
    if ("nodeType" in anchor) range.selectNodeContents(anchor);
    const selection = doc.getSelection();
    if (!selection || range.collapsed) return false;
    this.#keyboardSelection = true;
    if (selection.setBaseAndExtent)
      selection.setBaseAndExtent(
        range.startContainer,
        range.startOffset,
        range.endContainer,
        range.endOffset,
      );
    else {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    this.#selectionChanged(this.#selected(doc));
    return true;
  }

  #preparingPageColours = new WeakSet<Document>();
  #pageInkLifetime = new WeakMap<Document, AbortSignal>();
  #onLoad({ doc, index, signal: loadSignal, waitUntil }: { doc: Document; index: number; signal?: AbortSignal; waitUntil?: (promise: Promise<void>) => void }) {
    this.#nameFrame(doc, index);
    // Tab from the book onto the reader's controls shows their tooltips
    watchTooltipKeys(doc);
    doc.addEventListener("focusin", (event) => {
      const target = event.target as Element | null;
      if (
        !target ||
        target.nodeType !== 1 ||
        target === doc.body ||
        target === doc.documentElement ||
        !this.#view ||
        // Renderer-owned native focus retains accessibility focus without
        // turning its exact CFI arrival into a replacement human command.
        target === this.#view.renderer.navigationAnchorFocus ||
        !this.#source ||
        this.#destroyed
      )
        return;
      const visible = this.#view.lastLocation?.range;
      const range = doc.createRange();
      range.selectNodeContents(target);
      if (
        visible?.startContainer.ownerDocument === doc &&
        visible.comparePoint(
          doc.createTreeWalker(target, 4).nextNode() ?? target,
          0,
        ) === 0
      )
        return;
      const locator: DurtalLocator = {
        ...(this.#locator ?? {
          v: 1 as const,
          progression: 0,
          totalProgression: 0,
        }),
        fileHash: this.#source.sha256,
        href: String(this.#book?.sections[index]?.id ?? index),
        sectionIndex: index,
        cfi: this.#view.getCFI(index, range),
        text: quoteFromSelection(range),
      };
      this.#emit("focus", { locator });
    });
    doc.addEventListener("durtal-pdf-painted", () => this.#drawPdfMarks());
    const signal = loadSignal ? AbortSignal.any([this.#opening.signal, loadSignal]) : this.#opening.signal;
    this.#pageInkLifetime.set(doc, signal);
    const prepare = !!waitUntil && !!this.#presentation?.policy &&
      this.#book?.rendition?.layout !== "pre-paginated" &&
      !doc.querySelector("style[data-durtal-page-colours]");
    if (prepare) this.#preparingPageColours.add(doc);
    this.#applyPagePolicy(doc);
    if (prepare) {
      waitUntil!(preparePageInk(this.#ink, doc, signal, () => {
        this.#preparingPageColours.delete(doc);
        this.#applyPagePolicy(doc, false);
      }).finally(() => this.#preparingPageColours.delete(doc)));
    }
    this.#documents.set(doc, index);
    this.#edgeRoom(doc, false);
    this.#notes?.prefetch(doc, index);
    void import("../../media/document").then(({ attachReaderMedia }) => {
      if (this.#destroyed || this.#mediaDetach.has(doc)) return;
      const detach = attachReaderMedia(doc, (media) => {
        this.closeNote();
        this.#emit("media", media);
      }, { pageImages: this.#book?.rendition?.layout === "pre-paginated" });
      this.#mediaDetach.set(doc, detach);
      for (const old of this.#mediaDocs)
        if (!old.deref()) this.#mediaDocs.delete(old);
      this.#mediaDocs.add(new WeakRef(doc));
    });
    for (const a of doc.querySelectorAll("a[href]")) {
      if (classifyReaderLink(a.getAttribute("href") ?? "").kind !== "external")
        continue;
      a.setAttribute("data-durtal-external", "");
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
      a.setAttribute("aria-description", "Opens in a new tab");
    }
    this.#drawSearchMarks();
    this.#images?.fill(doc);
    this.#emit("document", { doc });
    if (!this.#wordGestureDetach.has(doc)) {
      this.#wordGestureDetach.set(doc, attachWordGestures(doc, (input, range) => {
        const selected = this.#selected(doc, range);
        if (!selected) return;
        const locator = this.#locatorForSelection(selected);
        if (!locator) return;
        // A cloned DOM Range is still live. Capture every lookup value before
        // a selection listener can edit the selected text, markup or geometry.
        const details = Object.freeze(detailsFromRange(selected.range, locator));
        if (locator.text) Object.freeze(locator.text);
        if (locator.pdf) {
          locator.pdf.rects?.forEach(rect => Object.freeze(rect));
          if (locator.pdf.rects) Object.freeze(locator.pdf.rects);
          Object.freeze(locator.pdf);
        }
        Object.freeze(locator);
        if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
        const { generation } = this.#selectionChanged(selected, details);
        if (this.#destroyed || generation !== this.#selectionGeneration ||
          this.#selectionDocument?.deref() !== doc ||
          !this.#view?.renderer.getContents().some(content => content.doc === doc)) return;
        this.#emit("word-gesture", { details, document: doc, input });
      }));
      for (const ref of this.#wordGestureDocs)
        if (!ref.deref()) this.#wordGestureDocs.delete(ref);
      this.#wordGestureDocs.add(new WeakRef(doc));
    }
    doc.addEventListener("keydown", (event) => {
      if (event.shiftKey && event.key.startsWith("Arrow"))
        this.#keyboardSelection = true;
    });
    doc.addEventListener("pointerdown", () => {
      this.#keyboardSelection = false;
    });
    doc.addEventListener(
      "touchstart",
      () => {
        this.#keyboardSelection = false;
      },
      { passive: true },
    );
    doc.addEventListener("selectionchange", () => {
      const selected = this.#selected(doc);
      if (selected) this.#selectionDocument = new WeakRef(doc);
      // Clearing a different retained selection must not dismiss the current one.
      else if (this.#selectionDocument?.deref() !== doc) return;
      ++this.#nativeSelectionRevision;
      if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
      this.#selectionTimer = setTimeout(() => this.#selectionChanged(this.#selected(doc)), 150);
    });
  }

  #selectionChanged(selected: SelectedRange | null = this.#selected(), snapshot?: SelectionDetails) {
    const generation = ++this.#selectionGeneration;
    const locator = snapshot?.locator ?? this.#locatorForSelection(selected);
    if (locator?.text?.highlight) {
      this.#hadSelection = true;
      if (!selected) return { locator: null, generation };
      this.#selectionDocument = new WeakRef(selected.range.startContainer.ownerDocument!);
      const bounds = snapshot?.rect ?? selectionHostRect(selected.range);
      const rect = { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
      this.#emit("selection", {
        text: locator.text.highlight,
        // Selection consumers may mutate their locator without changing the
        // immutable lookup snapshot published after this notification.
        locator: snapshot ? structuredClone(locator) : locator,
        rect,
        keyboard: this.#keyboardSelection,
      });
    } else if (this.#hadSelection) {
      this.#hadSelection = false;
      this.#emit("selection", null);
    }
    return { locator, generation };
  }

  /** The document a selection is in, with its section */
  #selected(origin?: Document, capturedRange?: Range): SelectedRange | null {
    const contents = this.#view?.renderer.getContents() ?? [];
    const preferred = origin ?? this.#selectionDocument?.deref();
    // Once a source document is chosen, an empty/unloaded source never falls back
    // to a stale native selection in another spread/continuous-reading frame.
    const candidates = preferred
      ? contents.filter(({ doc }) => doc === preferred)
      : this.#selectionDocument ? [] : contents;
    for (const { doc, index } of candidates) {
      const selection = doc.getSelection();
      if (!capturedRange && (!selection || selection.isCollapsed || !selection.rangeCount))
        continue;
      const range = capturedRange ?? selection!.getRangeAt(0).cloneRange();
      if (range.collapsed || range.startContainer.ownerDocument !== doc ||
        range.endContainer.ownerDocument !== doc || !doc.documentElement.contains(range.commonAncestorContainer))
        continue;
      const text = range.toString();
      if (!text.trim()) continue;
      return { range, index, text };
    }
    return null;
  }

  speech() {
    const available = () => !this.#destroyed && !!this.#info?.capabilities.tts;
    return available()
      ? createFoliateSpeech({
          available,
          prepare: (request) => this.prepareSpeech(request),
        })
      : null;
  }

  async prepareSpeech({
    target,
    signal,
  }: {
    target: SpeechPreparation;
    signal: AbortSignal;
  }) {
    const book = this.#book,
      view = this.#view,
      source = this.#source;
    if (
      !book ||
      !view ||
      !source ||
      this.#destroyed ||
      source.format === "cbz"
    )
      return { current: null, previous: null, next: null };
    if (this.#isPdf() && !this.#pdfTextProvider) throw new Error("The opened PDF speech text provider is unavailable.");
    if (this.#isPdf() && this.#pdfTextProvider) return preparePdfSpeech({
      provider: this.#pdfTextProvider, fileHash: source.sha256, pageCount: book.sections.length,
      language: this.#info?.language ?? null, target, visible: this.#locator, signal,
      isVisible: locator => this.#pdfLocatorVisible(locator),
    });
    const { domSpeechSentences } =
      await import("@/lib/reader/speech/dom-sentences");
    signal.throwIfAborted();
    const requested = target.kind === "adjacent" ? target.locator : target.from;
    if (requested !== "visible" && requested.fileHash !== source.sha256)
      throw new Error("That speech place belongs to another file.");
    const index =
      requested === "visible"
        ? (this.#locator?.sectionIndex ?? 0)
        : requested.sectionIndex;
    const visible = view.renderer
      .getContents()
      .find((item) => item.index === index)?.doc;
    const liveRange = requested === "visible" ? view.lastLocation?.range : null;
    if (requested !== "visible" && !requested.cfi)
      throw new Error("That speech place has no exact text anchor.");
    const anchorCfi =
      requested === "visible" ? this.#locator?.cfi : requested.cfi;
    const resolved = anchorCfi ? view.resolveNavigation(anchorCfi) : null;
    const fractions = view.getSectionFractions();
    const nextIndex = (at: number, direction: -1 | 1) => {
      for (
        let n = at + direction;
        n >= 0 && n < book.sections.length;
        n += direction
      )
        if (book.sections[n].linear !== "no") return n;
      return null;
    };
    const sentences = async function* (at: number, engine: FoliateEngine) {
      signal.throwIfAborted();
      const section = book.sections[at];
      const doc =
        (at === index ? visible : undefined) ??
        (await section.createDocument?.());
      signal.throwIfAborted();
      if (!doc || engine.#destroyed || engine.#book !== book) return;
      for await (const sentence of domSpeechSentences(
        doc,
        engine.#info?.language ?? null,
        signal,
      )) {
        const progress = view.getProgressOf(at, sentence.range);
        const cfi = view.getCFI(at, sentence.range);
        const locator: DurtalLocator = {
          v: 1,
          fileHash: source.sha256,
          href: String(section.id),
          sectionIndex: at,
          progression:
            at === engine.#locator?.sectionIndex
              ? engine.#locator.progression
              : 0,
          totalProgression: fractions[at] ?? 0,
          cfi,
          text: {
            ...quoteFromSelection(sentence.range),
            highlight: sentence.text,
          },
          ...(progress?.tocItem?.label
            ? { tocLabel: progress.tocItem.label }
            : {}),
          ...(progress?.pageItem?.label
            ? { pageLabel: progress.pageItem.label }
            : {}),
        };
        yield {
          segment: { text: sentence.text, lang: sentence.lang, locator },
          range: sentence.range,
          doc,
        };
      }
    };
    let previous: SpeechSegment | null = null,
      current: SpeechSegment | null = null,
      next: SpeechSegment | null = null;
    let anchor: Range | null = null,
      matched = false;
    for await (const item of sentences(index, this)) {
      if (!anchor) {
        if (
          requested === "visible" &&
          liveRange?.startContainer.ownerDocument === item.doc
        )
          anchor = liveRange;
        else if (resolved?.index === index && resolved.anchor) {
          const node = resolved.anchor(item.doc);
          if ("nodeType" in node) {
            anchor = item.doc.createRange();
            anchor.selectNodeContents(node);
          } else anchor = node;
        }
      }
      if (current) {
        next = item.segment;
        break;
      }
      if (matched) {
        current = item.segment;
        continue;
      }
      if (!anchor && requested === "visible")
        return { current: null, previous: null, next: null };
      const same =
        requested !== "visible" && item.segment.locator.cfi === requested.cfi;
      const end = item.range.cloneRange();
      end.collapse(false);
      const reached = anchor
        ? end.comparePoint(anchor.startContainer, anchor.startOffset) < 0
        : same || requested === "visible";
      if (reached) {
        const start = item.range.cloneRange();
        start.collapse(true);
        // A page with no sentence of its own (a title page, an image) reads
        // on from the next text rather than refusing
        if (target.kind === "adjacent" && target.direction === "previous") {
          current = previous;
          next = item.segment;
          previous = null;
          break;
        }
        if (target.kind === "adjacent") {
          matched = true;
          previous = item.segment;
        } else current = item.segment;
      } else previous = item.segment;
    }
    if (target.kind === "from" && !current && requested !== "visible")
      return { current: null, previous: null, next: null };
    // Cross-section extraction owns no renderer movement and skips non-linear spine entries.
    if (
      !current &&
      target.kind === "adjacent" &&
      target.direction === "previous"
    ) {
      let at = nextIndex(index, -1);
      while (at !== null && !current) {
        for await (const item of sentences(at, this)) {
          previous = current;
          current = item.segment;
        }
        at = nextIndex(at, -1);
      }
    } else if (!current || !next) {
      let at = nextIndex(index, 1);
      while (at !== null && !next) {
        for await (const item of sentences(at, this)) {
          if (!current) current = item.segment;
          else {
            next = item.segment;
            break;
          }
        }
        at = nextIndex(at, 1);
      }
    }
    signal.throwIfAborted();
    if (this.#destroyed || this.#book !== book)
      throw new DOMException("Closed", "AbortError");
    return { current, previous, next };
  }

  locatorFromSelection(): DurtalLocator | null {
    return this.#locatorForSelection(this.#selected());
  }

  #locatorForSelection(selected: SelectedRange | null): DurtalLocator | null {
    const view = this.#view;
    if (!view || !selected || !this.#source || !this.#book) return null;
    const { range, index } = selected;
    const quote = quoteFromSelection(range);
    const base = this.#locator;
    const progress = view.getProgressOf(index, range);
    const tocLabel = progress?.tocItem?.label?.trim().slice(0, 300);
    const pageLabel = progress?.pageItem?.label?.trim().slice(0, 40);
    if (this.#isPdf()) {
      // A PDF passage needs a complete, nonempty text quote.
      if (!quote?.highlight) return null;
      const doc = range.startContainer.ownerDocument;
      const viewport = doc && this.#book.pdfViewport?.(doc);
      const layer = doc?.querySelector<HTMLElement>(".textLayer");
      if (!viewport || !layer) return null;
      const canvas = doc?.querySelector("#canvas");
      if (!canvas) return null;
      const origin = canvas.getBoundingClientRect();
      const rects = Array.from(range.getClientRects()).flatMap((rect) => {
        const converted = clientRectToPdf(rect, viewport, {
          left: origin.left,
          top: origin.top,
          cropLeft: 0,
          cropTop: 0,
        });
        return converted ? [converted] : [];
      });
      return pdfLocatorFromGeometry({
        fileHash: this.#source.sha256,
        href: String(this.#book.sections[index]?.id ?? index),
        pageIndex: index,
        pageCount: this.#book.sections.length,
        viewport,
        rects,
        text: { ...quote, highlight: quote.highlight },
        pageLabel,
        tocLabel,
      });
    }
    return {
      v: 1,
      fileHash: this.#source.sha256,
      href: String(this.#book.sections[index]?.id ?? index),
      sectionIndex: index,
      progression: base?.sectionIndex === index ? base.progression : 0,
      totalProgression: base?.totalProgression ?? 0,
      cfi: view.getCFI(index, range),
      // The whole selection is the highlight; the context comes from around it
      text: quote,
      ...(tocLabel ? { tocLabel } : {}),
      ...(pageLabel ? { pageLabel } : {}),
      ...(base?.position ? { position: base.position } : {}),
    };
  }

  selectionDetails(origin?: Document) {
    const selected = this.#selected(origin), locator = this.#locatorForSelection(selected);
    if (!selected || !locator || this.#destroyed) return null;
    const doc = selected.range.startContainer.ownerDocument!;
    this.#selectionDocument = new WeakRef(doc);
    const details = detailsFromRange(selected.range, locator);
    this.#selectionCaptures.set(details, { revision: this.#nativeSelectionRevision, range: selected.range.cloneRange(), doc });
    return details;
  }

  clearSelection(expected?: SelectionDetails): void {
    if (expected) {
      const capture = this.#selectionCaptures.get(expected);
      if (!capture || this.#destroyed || capture.revision !== this.#nativeSelectionRevision ||
        this.#selectionDocument?.deref() !== capture.doc) return;
      const current = this.#selected(capture.doc)?.range, range = capture.range;
      if (!current || current.startContainer !== range.startContainer || current.startOffset !== range.startOffset ||
        current.endContainer !== range.endContainer || current.endOffset !== range.endOffset ||
        current.toString() !== expected.text) return;
      this.#selectionCaptures.delete(expected);
    }
    ++this.#nativeSelectionRevision;
    ++this.#selectionGeneration;
    if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
    for (const { doc } of this.#view?.renderer.getContents() ?? [])
      doc.getSelection()?.removeAllRanges();
    this.#hadSelection = false;
    this.#selectionDocument = null;
    this.#emit("selection", null);
  }

  // The paginator holds its pages at opacity 0 until a reopen's spread is
  // lined up (patch 29); the fixed-layout renderer never hides them
  #textContainer(): HTMLElement | null {
    return this.#view?.renderer?.shadowRoot?.getElementById("container") ?? null;
  }

  textHidden(): boolean {
    return this.#textContainer()?.style.opacity === "0";
  }

  whenTextShows(signal?: AbortSignal): Promise<void> {
    const container = this.#textContainer();
    if (!container || container.style.opacity !== "0" || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        observer.disconnect();
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const observer = new MutationObserver(() => {
        if (container.style.opacity !== "0") done();
      });
      observer.observe(container, { attributes: true, attributeFilter: ["style"] });
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  fixedPages(): TocItem[] | null { return this.#book?.rendition?.layout === "pre-paginated" ? (this.#info?.pageList.length ? this.#info.pageList : this.#info?.sections.map(section => ({ href: section.href, label: section.label, subitems: [] })) ?? []) : null; }
  adjustFixedZoom(direction: -1 | 0 | 1) { this.setFixedZoom(direction === 0 ? null : stepFixedZoom(this.#fixedZoom ?? 100, direction)); }
  fixedZoom(): number | null { return this.#fixedZoom; }
  setFixedZoom(percent: number | null) {
    if (this.#book?.rendition?.layout !== "pre-paginated") return;
    this.#fixedZoom = percent === null ? null : clampFixedZoom(percent);
    this.#emit("fixed-controls", { zoom: this.#fixedZoom });
    this.#applyLayout();
  }

  currentLocator(): DurtalLocator | null {
    return this.#locator;
  }

  setPresentation(presentation: Presentation) {
    if (this.#destroyed) return;
    presentation = this.#fontPresentation(presentation);
    this.#requestedPresentation = presentation;
    const epoch = ++this.#fontEpoch;
    const ready = this.#fontAssets.ready(presentation.fontFaces);
    if (ready !== null || !this.#source) {
      this.#fontAssets.cancelPending();
      this.#applyPresentation({ ...presentation, fontFaces: ready ?? presentation.fontFaces });
      return;
    }
    void this.#fontAssets.prepare(presentation.fontFaces, this.#opening.signal).then(fontFaces => {
      if (this.#destroyed || epoch !== this.#fontEpoch) return;
      this.#applyPresentation({ ...presentation, fontFaces });
    }).catch(() => {
      if (this.#destroyed || epoch !== this.#fontEpoch || this.#opening.signal.aborted) return;
      this.#emit("error", { kind: "network", message: "The reading font could not be prepared. Try opening the book again." });
    });
  }

  #applyPresentation(presentation: Presentation) {
    const previous = this.#presentation;
    this.#presentation = presentation;
    if (previous?.policy?.fixedFit !== presentation.policy?.fixedFit) this.#fixedZoom = null;
    const cropChanged = presentation.policy && this.#book?.setPdfPresentation?.(presentation.policy);
    if (cropChanged) this.#view?.renderer.refreshPageSizes?.();
    this.#drawPdfMarks();
    const history = this.#decorationSets.get("history");
    if (history?.length) this.setDecorations("history", history);
    const renderer = this.#view?.renderer;
    if (!renderer) return;
    if (presentation.policy) {
      const change = fontPresentationChangeKind(this.#appliedPresentation, presentation);
      for (const { doc } of renderer.getContents()) this.#applyPagePolicy(doc, change === "layout");
      // Changing colours owns only a page-local sheet. Never call setStyles or paginator attributes.
      if (change === "layout") {
        this.#applyLayout();
        if (this.#book?.rendition?.layout !== "pre-paginated")
          renderer.setStyles?.(policyTypographyCss(presentation));
      }
      this.#appliedPresentation = presentation;
      return;
    }
    if (this.#book?.rendition?.layout === "pre-paginated") return;
    renderer.setAttribute("flow", "paginated");
    renderer.setAttribute("gap", `${presentation.margin}%`);
    renderer.setAttribute("margin-left", "0px");
    renderer.setAttribute("margin-right", "0px");
    for (const [name, value] of Object.entries(this.#blockMargins())) renderer.setAttribute(name, value);
    renderer.setAttribute("max-inline-size", "720px");
    renderer.setAttribute("max-column-count", "2");
    renderer.setStyles?.(presentationCss(presentation));
    this.#appliedPresentation = presentation;
  }

  /** The paginator's top and bottom margins: 48px, or in pages the bar there
   * if it is taller. Scrolled text already stops short of the bars. */
  #blockMargins(scrolled = false) {
    return {
      "margin-top": `${scrolled ? 48 : Math.max(48, this.#insets.top)}px`,
      "margin-bottom": `${scrolled ? 48 : Math.max(48, this.#insets.bottom)}px`,
    };
  }

  #fontPresentation(presentation: Presentation): Presentation {
    const fixed = this.#source?.format === "pdf" || this.#source?.format === "cbz" ||
      this.#book?.rendition?.layout === "pre-paginated";
    const routed = routeFontPresentation(presentation, location.origin, this.#fontFacts, fixed);
    return { ...routed, fontFaces: this.#fontAssets.ready(routed.fontFaces) ?? routed.fontFaces };
  }

  async #prepareBookFonts(book: FoliateBook) {
    // No source scanning or new asset URLs until an accepted shaping/browser/publication
    // release exists. Today every Garamond caller takes the honest full-variable route.
    if (canPreflightCoreFonts() && this.#presentation?.policy?.font === "garamond" && this.#presentation.policy.fontWeight === 400 &&
        !this.#presentation.policy.publisherStyles && book.rendition?.layout !== "pre-paginated" &&
        this.#source?.format !== "pdf" && this.#source?.format !== "cbz") {
      const { collectBookFontFacts } = await import("@/lib/reader/presentation/font-preflight");
      this.#opening.signal.throwIfAborted();
      const language = book.metadata?.language;
      this.#fontFacts = await collectBookFontFacts(book.sections.map(section => ({
        sourceBytes: section.size,
        read: section.loadText?.bind(section),
        readStylesheet: async (href: string) => {
          // Only pristine manifest CSS is read. No section.load, blob replacement,
          // embedded-font resolution, DOM attachment or external URL fetching here.
          const path = section.resolveHref?.(href);
          if (!path || !book.loadText || !book.resources?.manifest.some(item => item.href === path && item.mediaType === "text/css")) return null;
          const size = this.#zip?.getSize(path);
          if (size === undefined || !Number.isSafeInteger(size) || size < 0 || size > 65_536) return null;
          return book.loadText(path);
        },
      })), typeof language === "string" ? language : language?.[0] ?? null, this.#opening.signal);
    }
    this.#opening.signal.throwIfAborted();
    await this.#preparePresentationFonts();
  }

  async #preparePresentationFonts() {
    while (!this.#destroyed) {
      this.#opening.signal.throwIfAborted();
      const requested = this.#requestedPresentation ?? this.#presentation;
      if (!requested) return this.#fontEpoch;
      const epoch = this.#fontEpoch;
      const routed = this.#fontPresentation(requested);
      let fontFaces: string;
      try { fontFaces = await this.#fontAssets.prepare(routed.fontFaces, this.#opening.signal); }
      catch (error) {
        this.#opening.signal.throwIfAborted();
        if (epoch !== this.#fontEpoch) continue;
        throw error;
      }
      this.#opening.signal.throwIfAborted();
      if (epoch !== this.#fontEpoch) continue;
      this.#presentation = { ...routed, fontFaces };
      return epoch;
    }
    throw new DOMException("Reader fonts retired", "AbortError");
  }

  #guardBookFontResources(book: FoliateBook) {
    // Fixed formats have no reader-font installation and retain their page-source ownership.
    if (book.rendition?.layout === "pre-paginated") return;
    const prepare = async () => { await this.#preparePresentationFonts(); };
    for (const section of book.sections) {
      if (section.load) section.load = guardFontResourceLoad(section.load.bind(section), prepare, this.#opening.signal);
      if (section.loadContent) section.loadContent = guardFontResourceLoad(section.loadContent.bind(section), prepare, this.#opening.signal);
    }
  }

  setCovered(covered: { top: number; bottom: number }, now?: { top: number; bottom: number }) {
    const edges = (e: { top: number; bottom: number }) => ({ top: Math.max(0, e.top), bottom: Math.max(0, e.bottom) });
    this.#covered = edges(covered);
    this.#coveredNow = now ? edges(now) : null;
  }

  setInsets(insets: { top: number; bottom: number; pinned: boolean }) {
    const top = Math.max(0, Math.ceil(insets.top)), bottom = Math.max(0, Math.ceil(insets.bottom));
    const { pinned } = insets;
    if (top === this.#insets.top && bottom === this.#insets.bottom && pinned === this.#insets.pinned) return;
    this.#insets = { top, bottom, pinned };
    this.#applyLayout();
  }

  /** Paginated text keeps the bars in its top and bottom margins, where the
   * running lines are. Scrolled text, PDFs and comics use the whole screen,
   * under bars that come and go, and stop short of them only while the bars
   * are kept visible */
  #reserveInsets(view: FoliateView, margins: boolean) {
    const { top, bottom } = margins || !this.#insets.pinned ? { top: 0, bottom: 0 } : this.#insets;
    const padding = top || bottom ? `${top}px 0px ${bottom}px` : "";
    if (view.style.padding === padding) return;
    view.style.boxSizing = padding ? "border-box" : "";
    view.style.padding = padding;
  }

  /** Scrolled text under bars that come and go: the book's first line starts
   * below the top bar and its last line ends above the bottom bar, so the
   * first and last screens are never covered */
  #edgeRoom(doc: Document, render = true) {
    const index = this.#documents.get(doc);
    const sections = this.#book?.sections;
    const scrolled = this.#presentation?.policy?.flow === "scrolled" && this.#book?.rendition?.layout !== "pre-paginated";
    // Vertical text pads its block ends itself
    const vertical = doc.defaultView?.getComputedStyle(doc.body ?? doc.documentElement).writingMode.startsWith("vertical");
    const rules: string[] = [];
    if (scrolled && !vertical && !this.#insets.pinned && index !== undefined && sections) {
      if (index === sections.findIndex((section) => section.linear !== "no"))
        rules.push(`padding-top: ${this.#insets.top}px !important;`);
      if (index === sections.findLastIndex((section) => section.linear !== "no"))
        rules.push(`padding-bottom: ${this.#insets.bottom}px !important;`);
    }
    const text = rules.length ? `html { ${rules.join(" ")} }` : "";
    let sheet = doc.querySelector<HTMLStyleElement>("style[data-durtal-edge-room]");
    if ((sheet?.textContent ?? "") === text) return;
    if (!sheet) {
      sheet = doc.createElement("style");
      sheet.setAttribute("data-durtal-edge-room", "");
      doc.head?.append(sheet);
    }
    sheet.textContent = text;
    if (render) this.#view?.renderer.render?.();
  }

  #applyLayout() {
    const p = this.#presentation?.policy;
    const view = this.#view;
    if (!p || !view || this.#destroyed) return;
    const renderer = view.renderer;
    if (this.#book?.rendition?.layout === "pre-paginated") {
      this.#reserveInsets(view, false);
      const rect = view.getBoundingClientRect();
      const kept = this.#insets.pinned ? this.#insets.top + this.#insets.bottom : 0;
      const area = { width: rect.width, height: rect.height - kept };
      const doc = renderer.getContents()[0]?.doc;
      const meta = doc?.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
      const width = Number(meta.match(/width=([\d.]+)/)?.[1]), height = Number(meta.match(/height=([\d.]+)/)?.[1]);
      const image = doc?.querySelector("img");
      const page = width > 0 && height > 0 ? { width, height } : image?.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : this.#book.rendition.viewport;
      const spread = page && area.width > 0 && area.height > 0 ? fixedSpreadMode({ preference: p.spread, areaWidth: area.width, areaHeight: area.height, pageWidth: page.width, pageHeight: page.height, renditionSpread: this.#book.rendition.spread }) : "none";
      const values = { zoom: this.#fixedZoom === null ? (p.fixedFit === "width" ? "fit-width" : "fit-page") : String(fixedZoomScale(this.#isPdf() ? "pdf" : this.#source?.format === "cbz" ? "cbz" : "epub", this.#fixedZoom)), spread,
        flow: p.flow === "scrolled" ? "scrolled" : "paginated" };
      const { animated, ...turn } = turnAttributes(p, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      for (const [name, value] of Object.entries({ ...values, ...turn }))
        if (renderer.getAttribute(name) !== value) renderer.setAttribute(name, value);
      if (animated) renderer.setAttribute("animated", "");
      else renderer.removeAttribute("animated");
      return;
    }
    this.#reserveInsets(view, p.flow !== "scrolled");
    const rect = view.getBoundingClientRect();
    const size = p.flow === "scrolled" && this.#insets.pinned
      ? { width: rect.width, height: rect.height - this.#insets.top - this.#insets.bottom }
      : rect;
    if (size.width <= 0 || size.height <= 0) return;
    const attributes = paginatorAttributes(p, size, {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      fontMetrics: CHAR_WIDTH_EM,
    });
    const { animated, ...values } = attributes;
    for (const [name, value] of Object.entries({ ...values, gap: "0%", ...this.#blockMargins(p.flow === "scrolled") }))
      if (renderer.getAttribute(name) !== value) renderer.setAttribute(name, value);
    if (animated) renderer.setAttribute("animated", "");
    else renderer.removeAttribute("animated");
    for (const { doc } of renderer.getContents()) this.#edgeRoom(doc);
  }

  #applyPagePolicy(doc: Document, typography = true) {
    const p = this.#presentation?.policy;
    if (!p || this.#book?.rendition?.layout === "pre-paginated") return;
    let colourSheet = doc.querySelector<HTMLStyleElement>("style[data-durtal-page-colours]");
    if (!this.#preparingPageColours.has(doc)) {
      this.#ink.apply(doc, p, this.#pageInkLifetime.get(doc) ?? this.#opening.signal);
      if (!colourSheet) {
        colourSheet = doc.createElement("style");
        colourSheet.setAttribute("data-durtal-page-colours", "");
        doc.head.append(colourSheet);
      }
      colourSheet.textContent = bookCSS(p, themeColours(p)).colours;
    }
    if (!typography) return;
    const adapt = (style: CSSStyleDeclaration, context: { inline?: boolean; protectedTypography?: boolean }) => {
      let original = this.#publisherDeclarations.get(style);
      if (!original) {
        original = new Map();
        for (const name of ["font-size", "text-align"])
          if (style.getPropertyValue(name)) original.set(name, { value: style.getPropertyValue(name), priority: style.getPropertyPriority(name) });
        this.#publisherDeclarations.set(style, original);
      }
      for (const [name, saved] of original)
        style.setProperty(name, adaptTypographyDeclaration(name, saved.value, p, context), saved.priority);
    };
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if ("selectorText" in rule && "style" in rule) {
          const styled = rule as CSSStyleRule;
          // Preserve protected typography even when a selector covers several descendants.
          const protectedTypography = /(?:^|[\s,>+~])(?:pre|code|kbd|samp|tt|math|svg)(?:$|[\s,.#:[>+~])/.test(styled.selectorText);
          adapt(styled.style, { protectedTypography });
        }
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(doc.styleSheets)) {
      // The renderer owns these sheets; source publisher declarations alone are adapted.
      if (!sheet.ownerNode || sheet.ownerNode.nodeType !== 1 || sheet.ownerNode === colourSheet ||
          !(sheet.ownerNode as Element).matches("link[rel=stylesheet], style:not([data-durtal-page-colours])")) continue;
      // Foliate inserts its own typography sheets without an original source node marker.
      // Ignore sheets containing our face family or our own structural namespace.
      if (sheet.ownerNode.textContent?.includes("@namespace epub")) continue;
      try { walk(sheet.cssRules); } catch { /* A publisher cross-origin sheet remains intact. */ }
    }
    for (const element of doc.querySelectorAll<HTMLElement>("[style]"))
      adapt(element.style, { inline: true, protectedTypography: !!element.closest("pre,code,kbd,samp,tt,math,svg") });
  }

  async goTo(target: GoToTarget, owner?: NavigationOwner): Promise<void> {
    this.closeNote();
    const view = this.#view;
    if (!view || this.#destroyed) throw new Error("The book is closed.");
    if (owner?.signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    this.#pdfTarget = this.#isPdf() && "v" in target && target.fileHash === this.#source?.sha256 && target.pdf?.rects?.length
      ? structuredClone(target) : null;
    this.#pageTarget = null;
    this.#owner = owner;
    this.#jumping++;
    let arrived = false;
    try {
      if (indexDiagnosticEnabled()) observeIndexDiagnostic("engine-goto-navigation-start");
      // Resolve only a canonical page of this file. Restoring a saved locator
      // keeps its exact CFI/words, and its page only if that marker is visible.
      const pageLabel = "page" in target ? target.page
        : "v" in target && target.fileHash === this.#source?.sha256 ? target.pageLabel : undefined;
      const pageHref = "page" in target ? target.href : undefined;
      if ("page" in target && pageLabel && !this.#isPdf())
        await this.#preparePageTarget(pageLabel, pageHref);
      if ("fraction" in target) {
        await this.#goToFraction(target.fraction);
      } else if ("location" in target) {
        await this.#goToFraction(this.locationToFraction(target.location));
      } else if ("page" in target) {
        const page = this.#canonicalPage(target.page, target.href);
        if (!page) throw new Error("This edition has no page " + target.page);
        await this.#anchor(page.href);
      } else if ("v" in target) {
        this.#readingFraction = target.totalProgression;
        const current = target.fileHash === this.#source?.sha256;
        if (current && target.pdf?.page) {
          await this.#anchor(target.pdf.page - 1);
          await this.#waitPdfPaint(target.pdf.page - 1, owner?.signal ?? this.#opening.signal);
          const content = view.renderer.getContents().find(item => item.index + 1 === target.pdf?.page);
          const viewport = content && this.#book?.pdfViewport?.(content.doc);
          const rect = viewport && target.pdf.rects?.[0] && pdfRectToPage(target.pdf.rects[0], viewport, this.#book?.pdfCropOffset?.(content!.doc) ?? { left: 0, top: 0 });
          if (target.pdf.rects?.length && (!rect || !view.renderer.showPageRect?.(target.pdf.page - 1, rect)))
            throw new Error("The PDF passage could not be brought into view.");
        }
        else if (current && target.cfi) await this.#anchor(target.cfi);
        else if (
          current &&
          this.#book?.sections[target.sectionIndex]?.linear === "no"
        )
          await view.renderer.goTo({
            index: target.sectionIndex,
            anchor: target.progression,
          });
        else await this.#goToFraction(target.totalProgression);
      } else {
        await this.#anchor(target.href);
      }
      if (indexDiagnosticEnabled()) observeIndexDiagnostic("engine-goto-navigation-return");
      if (indexDiagnosticEnabled()) observeIndexDiagnostic("engine-goto-ink-start");
      await this.#waitInk();
      if (indexDiagnosticEnabled()) observeIndexDiagnostic("engine-goto-ink-return");
      if (this.#destroyed || owner?.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      // Saved page metadata follows the actual CFI landing. Neither a stale
      // saved section nor an ambiguous label may change its exact destination.
      if ("v" in target && pageLabel && !this.#isPdf() && view.lastLocation)
        await this.#prepareSavedPageTarget(pageLabel, view.lastLocation);
      if (this.#destroyed || owner?.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      // A renderer may leave the same page without a new relocate. Give the controller
      // an owned arrival; its exact-anchor comparison makes this a no-op.
      if (view.lastLocation) this.#onRelocate(view.lastLocation);
      arrived = true;
    } finally {
      if (!arrived) {
        this.#pdfTarget = null;
        this.#pageTarget = null;
      }
      this.#jumping--;
      this.#owner = undefined;
    }
  }

  #canonicalPage(label: string, href?: string) {
    // Match the parser's recursive, href-bearing page entries. A parser-selected
    // href disambiguates labels even when indexed fractions reorder its pages;
    // it must still belong to this file's canonical page list.
    return flattenContents(this.#info?.pageList ?? []).find(item =>
      !!item.href && item.label.toLowerCase() === label.toLowerCase() &&
      (href === undefined || item.href === href));
  }

  async #preparePageTarget(label: string, href?: string) {
    const page = this.#canonicalPage(label, href);
    if (!page) return;
    try {
      const resolved = await this.#view!.resolveNavigation(page.href);
      if (resolved && Number.isInteger(resolved.index) && resolved.anchor)
        this.#pageTarget = { label: page.label, index: resolved.index, anchor: resolved.anchor };
    } catch {
      // Optional page metadata must never block a valid saved CFI. Explicit
      // page navigation still resolves its destination in #anchor and fails normally.
    }
  }

  async #prepareSavedPageTarget(label: string, detail: FoliateProgress) {
    for (const page of flattenContents(this.#info?.pageList ?? [])) {
      if (!page.href || page.label.toLowerCase() !== label.toLowerCase()) continue;
      try {
        const resolved = await this.#view!.resolveNavigation(page.href);
        if (!resolved || resolved.index !== detail.index || !resolved.anchor) continue;
        const candidate = { label: page.label, index: resolved.index, anchor: resolved.anchor };
        // The same mounted-range and physical guard used for explicit pages
        // chooses an eligible duplicate within the observed restored section.
        if (this.#visiblePageTarget(detail, candidate)) {
          this.#pageTarget = candidate;
          return;
        }
      } catch {
        // A broken optional candidate cannot block the CFI or later duplicates.
      }
    }
  }

  #visiblePageTarget(detail: FoliateProgress, target = this.#pageTarget): string | undefined {
    if (!target || target.index !== detail.index || !detail.range) return;
    const renderer = this.#view?.renderer;
    // Only the measured reflowable paginated geometry is admitted here.
    // Scrolled/fixed renderers keep their observed labels pending native proof.
    if (!renderer || this.#book?.rendition?.layout === "pre-paginated" || renderer.getAttribute("flow")?.startsWith("scrolled")) return;
    const content = this.#view?.renderer.getContents().find(item => item.index === target.index);
    if (!content) return;
    try {
      const anchor = target.anchor(content.doc);
      if (!anchor) return;
      const point = "startContainer" in anchor
        ? { node: anchor.startContainer, offset: anchor.startOffset }
        : { node: anchor, offset: 0 };
      // A label is never enough: the current native range must contain this
      // actual publisher marker in the mounted frame. Otherwise use the
      // ordinary observed label, exposing a failed/incorrect physical landing.
      if (detail.range.comparePoint(point.node, point.offset) === 0 &&
          pageMarkerPhysicallyVisible(anchor, content.doc, renderer)) return target.label;
    } catch {
      // A retired frame or absent marker cannot supply current-page metadata.
    }
  }

  async #waitInk() {
    if (this.#book?.rendition?.layout === "pre-paginated") return;
    const docs = this.#view?.renderer.getContents().map(item => item.doc) ?? [];
    await Promise.all(docs.map(doc => this.#ink.ready(doc, this.#owner?.signal ?? this.#opening.signal)));
    this.#opening.signal.throwIfAborted();
  }

  async #anchor(target: string | number) {
    const view = this.#view!;
    const resolved = await view.resolveNavigation(target);
    if (
      !resolved ||
      !Number.isInteger(resolved.index) ||
      !this.#book?.sections[resolved.index]
    )
      throw new Error("That place could not be found in this book.");
    // Foliate's view.goTo catches and logs renderer failures. The adapter must propagate them.
    await view.renderer.goTo(resolved);
  }

  /** A fraction of the book; for fixed layouts (PDF, comics), of its pages */
  async #goToFraction(fraction: number) {
    const view = this.#view!;
    const at = Math.min(
      1,
      Math.max(0, Number.isFinite(fraction) ? fraction : 0),
    );
    if (this.#book?.rendition?.layout === "pre-paginated") {
      const sections = this.#book.sections
        .map((section, index) => ({ section, index }))
        .filter((item) => item.section.linear !== "no");
      if (!sections.length) throw new Error("This book has no reading order.");
      await this.#anchor(
        sections[Math.round(at * (sections.length - 1))].index,
      );
    } else if (at === 0 || at === 1) {
      const sections = this.#book!.sections;
      const index =
        at === 1
          ? sections.findLastIndex((section) => section.linear !== "no")
          : sections.findIndex((section) => section.linear !== "no");
      if (index < 0) throw new Error("This book has no reading order.");
      await view.renderer.goTo({ index, anchor: at });
    } else await view.goToFraction(at);
  }

  locationToFraction(location: number) {
    if (
      !this.#info ||
      !Number.isInteger(location) ||
      location < 1 ||
      location > this.#info.locationCount
    )
      throw new Error("Location is outside this book.");
    return Math.min(
      1,
      ((location - 1) * 1500) / Math.max(1, this.#info.linearSize),
    );
  }
  sectionFractions() {
    const sections = this.#book?.sections ?? [];
    const sizes = sections.map((section) =>
      section.linear !== "no" ? Math.max(0, section.size || 0) : 0,
    );
    const total = sizes.reduce((sum, size) => sum + size, 0);
    let sum = 0;
    return [0, ...sizes.map((size) => (sum += size) / Math.max(1, total))];
  }
  indexAnchors({ hrefs, signal }: { hrefs: string[]; signal: AbortSignal }) {
    const book = this.#book;
    if (!book) throw new Error("The book is closed.");
    const fractions = this.sectionFractions();
    if (book.rendition?.layout === "pre-paginated")
      return (async function* () {
        for (const href of hrefs) {
          if (signal.aborted) return;
          const resolved = await book.resolveHref(href);
          if (resolved)
            yield { href, fraction: fractions[resolved.index] ?? 0 };
        }
      })();
    return buildAnchorIndex({
      book,
      fractions: this.sectionFractions(),
      hrefs,
      signal,
      scanSection:
        (this.#source?.format === "epub" || this.#source?.format === "kepub") &&
        this.#zip?.scanIndex
          ? (index, fragments, abort) =>
              this.#zip!.scanIndex!(
                String(book.sections[index].id),
                fragments.map((fragment) => indexFragment(book, fragment)),
                abort,
              )
          : async (index, fragments, abort) => {
              const raw = await book.sections[index].loadText?.();
              if (raw === undefined || raw === null) return null;
              const identifiers = fragments.map((fragment) =>
                indexFragment(book, fragment),
              );
              if (raw.length >= 128 * 1024 && typeof Worker !== "undefined") {
                const { scanInWorker } = await import("./index-worker-client");
                return scanInWorker(
                  { markup: raw, fragments: identifiers },
                  abort,
                );
              }
              return scanMarkup(raw, identifiers, abort);
            },
    });
  }
  firstPage(owner?: NavigationOwner) {
    return this.goTo({ fraction: 0 }, owner);
  }
  lastPage(owner?: NavigationOwner) {
    return this.goTo({ fraction: 1 }, owner);
  }
  async #stepSection(direction: -1 | 1, owner?: NavigationOwner) {
    const sections = this.#book?.sections ?? [];
    let index = (this.#locator?.sectionIndex ?? 0) + direction;
    while (sections[index]?.linear === "no") index += direction;
    if (!sections[index])
      return direction > 0 ? this.lastPage(owner) : this.firstPage(owner);
    const fraction = this.sectionFractions()[index] ?? 0;
    return this.goTo(
      {
        v: 1,
        fileHash: this.#source!.sha256,
        href: String(sections[index].id ?? index),
        sectionIndex: index,
        progression: 0,
        totalProgression: fraction,
        cfi: this.#view!.getCFI(index),
      },
      owner,
    );
  }
  nextSection(owner?: NavigationOwner) {
    return this.#stepSection(1, owner);
  }
  prevSection(owner?: NavigationOwner) {
    return this.#stepSection(-1, owner);
  }
  setMarginalia(lines: Marginalia | null) {
    this.#marginalia = lines;
    this.#writeMarginalia();
  }
  setMarginaliaHidden(hidden: boolean) {
    this.#marginaliaHidden = hidden;
    this.#writeMarginalia();
  }
  #writeMarginalia() {
    const renderer = this.#view?.renderer;
    if (!renderer) return;
    const lines = this.#marginalia;
    const rtl = this.#book?.dir === "rtl";
    const fade = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (
      elements: HTMLElement[] | null | undefined,
      parts: [string, string] | undefined,
    ) => {
      if (!elements) return;
      for (const element of elements) {
        element.replaceChildren();
        element.style.cssText =
          "display:flex;direction:ltr;justify-content:space-between;gap:12px;overflow:hidden;font:12px Inter,sans-serif;font-variant-numeric:tabular-nums;color:" +
          (lines?.color ?? this.#presentation?.colors.muted ?? "inherit") +
          // The glass bars show the same lines; seen through them, these
          // would cross the bars' own text and the progress slider
          (this.#marginaliaHidden ? ";opacity:0" : "") +
          (fade ? ";transition:opacity 200ms" : "");
      }
      if (!parts) return;
      const first = elements[rtl ? elements.length - 1 : 0];
      const last = elements[rtl ? 0 : elements.length - 1];
      for (const [at, text] of parts.entries()) {
        const element = at ? last : first;
        if (!element || !text) continue;
        const span = document.createElement("span");
        span.dir = "auto";
        span.textContent = text;
        span.style.cssText =
          "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
          (at ? "margin-left:auto" : "");
        element.append(span);
      }
    };
    draw(renderer.heads, lines?.head);
    draw(renderer.feet, lines?.foot);
  }
  setDecorations(group: string, decorations: Decoration[]) {
    if (this.#isPdf()) {
      this.#pdfMarks.set(group, decorations);
      this.#drawPdfMarks();
      if (group === "history") {
        if (this.#markTimer) clearTimeout(this.#markTimer);
        this.#markTimer = decorations.length ? setTimeout(() => this.setDecorations("history", []), 4000) : null;
      }
      return;
    }
    if (group === "search") {
      this.#searchMarks = decorations.flatMap((item) => {
        const cfi = "cfi" in item ? item.cfi : item.locator.cfi;
        return cfi ? [{ cfi, color: item.color,
          current: "current" in item ? item.current : false }] : [];
      });
      this.#drawSearchMarks();
      return;
    }
    this.#decorationSets.set(
      group,
      decorations.map((item) => structuredClone(item)),
    );
    if (group === "history") {
      if (this.#markTimer) clearTimeout(this.#markTimer);
      this.#markTimer = decorations.length
        ? setTimeout(() => this.setDecorations("history", []), 4000)
        : null;
    }
    const view = this.#view,
      source = this.#source;
    if (!view || !source || this.#destroyed) return;
    const apply = () => {
      if (this.#destroyed || this.#view !== view || !this.#decorations) return;
      const items = (this.#decorationSets.get(group) ?? []).map((item) => ({
        ...item,
        color:
          item.color === "link"
            ? (this.#presentation?.colors.link ?? "#8c9fae")
            : item.color,
      }));
      this.#decorations.set(view, source.sha256, group, items);
    };
    if (this.#decorations) {
      apply();
      return;
    }
    this.#decorationLoading ??= import("@/vendor/foliate-js/overlayer.js").then(
      (module) => {
        if (!this.#destroyed && this.#view === view)
          this.#decorations = new FoliateDecorations(module.Overlayer);
      },
    );
    void this.#decorationLoading
      .then(apply)
      .catch((error) =>
        console.error("[reader] Decoration drawing failed:", error),
      );
  }

  resolveAnnotation(
    annotation: { kind: "highlight" | "bookmark"; locator: DurtalLocator },
    options: { signal?: AbortSignal } = {},
  ): Promise<AnnotationResolveResult> {
    if (!this.#book || !this.#view || !this.#source || this.#destroyed)
      return Promise.resolve({ status: "pending", locator: null });
    if (this.#isPdf() && this.#pdfTextProvider) return resolvePdfAnnotation({
      provider: this.#pdfTextProvider, hash: this.#source.sha256, pageCount: this.#book.sections.length,
      annotation, signal: AbortSignal.any([options.signal ?? this.#opening.signal, this.#opening.signal]),
    }).catch(error => {
      if (options.signal?.aborted || this.#destroyed) return { status: "pending" as const, locator: null };
      throw error;
    });
    this.#annotationResolver ??= new FoliateAnnotationResolver(
      this.#book,
      this.#view,
      this.#source.sha256,
      () => this.#readingFraction,
    );
    return this.#annotationResolver.resolve(annotation, options);
  }

  #waitPdfPaint(index: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const documents = new Set<Document>();
      const done = (error?: unknown) => { clearTimeout(timer); offDocument(); offError();
        signal.removeEventListener("abort", abort);
        for (const doc of documents) doc.removeEventListener("durtal-pdf-painted", check);
        if (error) reject(error); else resolve(); };
      const abort = () => done(signal.reason ?? new DOMException("Cancelled", "AbortError"));
      const check = () => {
        const content = this.#view?.renderer.getContents().find(item => item.index === index);
        if (content && this.#book?.pdfViewport?.(content.doc)) { done(); return; }
        if (content && !documents.has(content.doc)) { documents.add(content.doc); content.doc.addEventListener("durtal-pdf-painted", check); }
      };
      const offDocument = this.on("document", check);
      const offError = this.on("error", event => done(new Error(event.message)));
      const timer = setTimeout(() => done(new Error("The PDF page took too long to paint.")), 30_000);
      signal.addEventListener("abort", abort, { once: true }); check();
    });
  }
  #drawPdfMarks() {
    if (this.#isPdf() && this.#view && this.#book && this.#source && this.#presentation && !this.#destroyed)
      this.#pdfMarks.render(this.#view, this.#book, this.#source.sha256, this.#presentation.colors);
  }
  #pdfLocatorVisible(locator: DurtalLocator) {
    const content = this.#view?.renderer.getContents().find(item => item.index + 1 === locator.pdf?.page);
    const viewport = content && this.#book?.pdfViewport?.(content.doc);
    const frame = content?.doc.defaultView?.frameElement;
    if (!content || !viewport || !frame || !this.#view) return false;
    const host = frame.getBoundingClientRect(), area = this.#view.getBoundingClientRect();
    const scaleX = host.width / ((frame as HTMLElement).offsetWidth || host.width);
    const scaleY = host.height / ((frame as HTMLElement).offsetHeight || host.height);
    const crop = this.#book?.pdfCropOffset?.(content.doc) ?? { left: 0, top: 0 };
    return locator.pdf?.rects?.some(rect => {
      const box = pdfRectToPage(rect, viewport, crop);
      return !!box && host.left + box.right * scaleX > area.left && host.left + box.left * scaleX < area.right &&
        host.top + box.bottom * scaleY > area.top && host.top + box.top * scaleY < area.bottom;
    }) ?? false;
  }

  #drawSearchMarks() {
    const view = this.#view;
    const epoch = ++this.#searchMarkEpoch;
    if (!view || this.#destroyed) return;
    const marks = [...this.#searchMarks].sort(
      (a, b) => Number(!!b.current) - Number(!!a.current),
    );
    // Serialize removal and addition. A stale add cannot revive marks after Close.
    this.#searchMarkWork = this.#searchMarkWork
      .catch(() => {})
      .then(async () => {
        if (
          this.#view !== view ||
          this.#destroyed ||
          epoch !== this.#searchMarkEpoch
        )
          return;
        for (const value of this.#paintedSearchMarks)
          await view.addAnnotation({ value, group: "search" }, true);
        this.#paintedSearchMarks = [];
        const counts = new Map<number, number>();
        const { yieldReaderTask } = await import("../../search/task");
        const controller = new AbortController();
        let budget = performance.now();
        for (const item of marks) {
          if (
            this.#view !== view ||
            this.#destroyed ||
            epoch !== this.#searchMarkEpoch
          )
            return;
          const index = view.resolveNavigation(item.cfi)?.index;
          if (index == null || (counts.get(index) ?? 0) >= 500) continue;
          counts.set(index, (counts.get(index) ?? 0) + 1);
          const value = "foliate-search:" + item.cfi;
          await view.addAnnotation({
            value,
            group: "search",
            color:
              item.color === "link"
                ? this.#presentation?.colors.link
                : item.color,
            current: item.current,
          });
          this.#paintedSearchMarks.push(value);
          if (performance.now() - budget >= 8) {
            await yieldReaderTask(controller.signal);
            budget = performance.now();
          }
        }
      })
      .catch(() => {
        /* A failed outline never disables result navigation. */
      });
  }

  async #turn(
    direction: "next" | "prev" | "goLeft" | "goRight",
    owner?: NavigationOwner,
  ) {
    if (owner?.signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    this.closeNote();
    this.#owner = owner;
    this.#turning++;
    try {
      const forward =
        direction === "next" ||
        (direction !== "prev" &&
          (direction === "goRight") === (this.#view?.book.dir !== "rtl"));
      const screen = this.#screenDistance(forward);
      if (screen === undefined) await this.#view?.[direction]();
      else await this.#view?.[forward ? "next" : "prev"](screen);
      await this.#waitInk();
      if (owner?.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
    } finally {
      this.#turning--;
      this.#owner = undefined;
    }
  }
  isScrolled() {
    return !!this.#view?.renderer?.scrolled;
  }
  /**
   * In the scroll flow a page turn scrolls a screen less one line: the last
   * line wholly on screen comes to the top, or going back the first comes to
   * the bottom, so the reader keeps their line (SLN-674). Undefined when the
   * book turns pages.
   */
  #screenDistance(forward: boolean) {
    const pressed = this.#coveredNow;
    this.#coveredNow = null;
    const renderer = this.#view?.renderer;
    const size = renderer?.scrolled ? renderer.size : undefined;
    if (!renderer || !size) return undefined;
    const line = this.#lineHeight();
    const rect = renderer.shadowRoot
      ?.getElementById("container")
      ?.getBoundingClientRect();
    // The line is read between the layers over the text at the key press
    // and lands clear of those left once the turn has hidden the bars,
    // unless either would leave less than half the screen
    const fits = (e: { top: number; bottom: number }) => e.top + e.bottom < size / 2;
    const after = fits(this.#covered) ? this.#covered : { top: 0, bottom: 0 };
    const now = pressed && fits(pressed) ? pressed : after;
    const box = rect && {
      top: rect.top + now.top, bottom: rect.bottom - now.bottom,
      left: rect.left, width: rect.width, height: rect.height - now.top - now.bottom,
    };
    const kept = box && this.#keptLine(box, forward, line);
    const distance = !rect || !kept
      ? size - (forward ? now.bottom + after.top : now.top + after.bottom) - line
      : forward
        ? kept.top - (rect.top + after.top)
        : rect.bottom - after.bottom - kept.bottom;
    return Math.min(size, Math.max(size / 2, distance));
  }
  /**
   * The line wholly on screen nearest the edge a turn leaves by: probes the
   * text block at the edge, and steps past a cut line or a gap between
   * blocks, at most half a screen in.
   */
  #keptLine(box: ViewBox, forward: boolean, line: number) {
    const edge = forward ? box.bottom : box.top;
    const step = forward ? -1 : 1;
    let y = edge + step;
    for (let probes = 0; probes < 40 && Math.abs(y - edge) < box.height / 2; probes++) {
      const rects = this.#lineRectsAt(box, y);
      if (!rects?.length) {
        y += step * (line / 2);
        continue;
      }
      const whole = rects.filter((r) =>
        forward ? r.bottom <= edge + 0.5 : r.top >= edge - 0.5,
      );
      if (whole.length) {
        const kept = whole.reduce((a, b) =>
          forward ? (b.bottom > a.bottom ? b : a) : b.top < a.top ? b : a,
        );
        // An image seen whole is not shown again: the turn starts after it
        if (!kept.image) return kept;
        const at = forward ? kept.bottom : kept.top;
        return { top: at, bottom: at, image: true };
      }
      // Every line of this block is cut by the edge: probe the next one in.
      // A block whose lines all lie past the probe (its padding) steps on
      const next = forward
        ? Math.min(...rects.map((r) => r.top)) - 1
        : Math.max(...rects.map((r) => r.bottom)) + 1;
      y = (next - y) * step > 0 ? next : y + step * (line / 2);
    }
    return undefined;
  }
  /** The line boxes of the text block at this height, in the page's coordinates */
  #lineRectsAt(box: ViewBox, y: number) {
    for (const { doc } of this.#view?.renderer.getContents() ?? []) {
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
      if (!frame || y < frame.top || y >= frame.bottom) continue;
      const x = Math.max(frame.left, box.left) + Math.min(frame.width, box.width) / 2;
      const element = doc.elementFromPoint(x - frame.left, y - frame.top);
      if (!element || element === doc.body || element === doc.documentElement)
        return null;
      // A block with no text (an image, or the paragraph holding one) is one
      // box: one cut by the edge is stepped past whole
      const image = !element.textContent?.trim();
      const range = doc.createRange();
      range.selectNodeContents(element);
      const lines = image ? [element.getBoundingClientRect()] : [...range.getClientRects()];
      return lines
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ top: r.top + frame.top, bottom: r.bottom + frame.top, image }));
    }
    return null;
  }
  /** The text's line height, or the arrow keys' step where the text has none */
  #lineHeight() {
    const doc = this.#view?.renderer.getContents()[0]?.doc;
    const body = doc?.body;
    const style = body ? doc.defaultView?.getComputedStyle(body) : undefined;
    if (!style) return SCROLL_LINE_PX;
    const lineHeight = parseFloat(style.lineHeight);
    if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
    const fontSize = parseFloat(style.fontSize);
    return Number.isFinite(fontSize) && fontSize > 0
      ? fontSize * 1.2
      : SCROLL_LINE_PX;
  }
  scrollLines(direction: -1 | 1) {
    this.scrollBy(direction * SCROLL_LINE_PX);
  }
  scrollBy(px: number) {
    const renderer = this.#view?.renderer;
    if (!renderer?.scrolled || renderer.containerPosition === undefined) return;
    renderer.containerPosition += px;
  }
  next(owner?: NavigationOwner) {
    return this.#turn("next", owner);
  }
  prev(owner?: NavigationOwner) {
    return this.#turn("prev", owner);
  }
  goLeft(owner?: NavigationOwner) {
    return this.#turn("goLeft", owner);
  }
  goRight(owner?: NavigationOwner) {
    return this.#turn("goRight", owner);
  }

  /**
   * Re-anchors a stored locator in this file: by its CFI when it was made in
   * this file; else by its text quote, in its section and then in the whole
   * book (healed: saved again with this file's hash); else at the same
   * fraction of the book (approximate).
   */
  async resolve(locator: DurtalLocator): Promise<ResolveResult> {
    const view = this.#view;
    const book = this.#book;
    const source = this.#source;
    if (!view || !book || !source || locator?.v !== 1)
      return { status: "failed", locator: null };
    if (locator.fileHash === source.sha256) {
      if (locator.pdf?.page && locator.pdf.page <= book.sections.length)
        return { status: "exact", locator };
      if (locator.cfi) {
        const target = view.resolveNavigation(locator.cfi);
        if (
          target &&
          Number.isInteger(target.index) &&
          book.sections[target.index]
        )
          return { status: "exact", locator };
      }
    }
    if (locator.text?.highlight && !this.#isPdf()) {
      const first = book.sections.findIndex(
        (s) => String(s.id) === locator.href,
      );
      const order = [first, ...book.sections.keys()].filter(
        (i, at, all) => i >= 0 && all.indexOf(i) === at,
      );
      for (const index of order) {
        const healed = await this.#findQuote(index, locator).catch(() => null);
        if (healed) return { status: "healed", locator: healed };
      }
    }
    if (Number.isFinite(locator.totalProgression)) {
      // The same point of the book: goTo reads the fraction of a locator with no CFI
      const { cfi: _cfi, pdf: _pdf, ...rest } = locator;
      void _cfi;
      void _pdf;
      return {
        status: "approximate",
        locator: { ...rest, fileHash: source.sha256 },
      };
    }
    return { status: "failed", locator: null };
  }

  async #findQuote(
    index: number,
    locator: DurtalLocator,
  ): Promise<DurtalLocator | null> {
    const book = this.#book!;
    const section = book.sections[index];
    if (!section?.createDocument || !locator.text) return null;
    const doc = await section.createDocument();
    const body = doc.body ?? doc.documentElement;
    // The section's text, whitespace collapsed, with where each character came from
    const walker = doc.createTreeWalker(body, 4 /* SHOW_TEXT */);
    const nodes: Text[] = [];
    let raw = "";
    const starts: number[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push(node as Text);
      starts.push(raw.length);
      raw += (node as Text).data;
    }
    const map: number[] = [];
    let text = "";
    for (let i = 0; i < raw.length; i++) {
      const space = /\s/.test(raw[i]);
      if (space && text.endsWith(" ")) continue;
      text += space ? " " : raw[i];
      map.push(i);
    }
    const hint =
      locator.sectionIndex === index
        ? Math.round(locator.progression * text.length)
        : undefined;
    const found = matchQuote(text, locator.text, hint);
    if (!found) return null;
    const point = (offset: number): [Text, number] => {
      const at = map[Math.min(offset, map.length - 1)] ?? 0;
      let n = starts.length - 1;
      while (n > 0 && starts[n] > at) n--;
      return [nodes[n], at - starts[n]];
    };
    const range = doc.createRange();
    const [startNode, startOffset] = point(found.start);
    range.setStart(startNode, startOffset);
    range.collapse(true);
    return {
      ...locator,
      fileHash: this.#source!.sha256,
      href: String(section.id),
      sectionIndex: index,
      progression: text.length ? found.start / text.length : 0,
      cfi: this.#view!.getCFI(index, range),
    };
  }
}

function contentTypeOf(format: ReaderFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "fb2":
      return "application/x-fictionbook+xml";
    case "mobi":
      return "application/x-mobipocket-ebook";
    default:
      return "application/vnd.amazon.mobi8-ebook";
  }
}

export function createFoliateEngine(): ReaderEngine & {
  readonly transfer: { bytes: number; requests: number };
} {
  return new FoliateEngine();
}
