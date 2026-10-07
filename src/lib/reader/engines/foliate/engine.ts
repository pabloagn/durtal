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
  TocItem,
} from "@/lib/reader/engine";
import { presentationCss } from "@/lib/reader/presentation";
import { ReadError, RangeSource, RemoteBlob } from "./remote-blob";
import { DeferredImages } from "./deferred-images";
import { makeRangeZipLoader } from "./zip-reader";
import { locatorFromRelocate, quoteAt } from "./locator";
import { matchQuote, normalizeQuoteText } from "./quote-match";
import type {
  ComicModule,
  Contributor,
  EpubModule,
  Fb2Module,
  FoliateBook,
  FoliateProgress,
  FoliateTocEntry,
  FoliateView,
  Localized,
  MobiModule,
  PdfModule,
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

const ZIP_FORMATS = new Set<ReaderFormat>(["epub", "kepub", "fbz", "cbz"]);

/** What later sub-issues may offer, per format */
function capabilitiesFor(format: ReaderFormat): BookInfo["capabilities"] {
  if (format === "cbz") return { search: false, tts: false, spreads: true, scrolled: false };
  if (format === "pdf") return { search: true, tts: false, spreads: true, scrolled: true };
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
    .map((c) => (typeof c === "object" && c !== null && "name" in c ? localized(c.name) : localized(c as Localized)))
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
  if (/not supported|unsupported|No supported/i.test(message)) return "unsupported";
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(message)) return "network";
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
  #locator: DurtalLocator | null = null;
  #jumping = 0;
  #destroyed = false;
  #selectionTimer: ReturnType<typeof setTimeout> | null = null;
  #hadSelection = false;
  /** A reflowable EPUB's large images, shown after its text */
  #images: DeferredImages | null = null;

  /** Bytes and requests so far, for the performance harness */
  get transfer() {
    return { bytes: this.#range?.transferred ?? 0, requests: this.#range?.requests ?? 0 };
  }

  on<K extends keyof EngineEvents>(name: K, handler: (detail: EngineEvents[K]) => void): () => void {
    let set = this.#handlers.get(name);
    if (!set) this.#handlers.set(name, (set = new Set()));
    const handlers = set;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }

  #emit<K extends keyof EngineEvents>(name: K, detail: EngineEvents[K]) {
    const set = this.#handlers.get(name) as Set<(detail: EngineEvents[K]) => void> | undefined;
    set?.forEach((handler) => handler(detail));
  }

  async #makeBook(source: BookSource, range: RangeSource): Promise<FoliateBook> {
    const name = `book.${source.format}`;
    if (ZIP_FORMATS.has(source.format)) {
      const zip = (await import("@/vendor/foliate-js/vendor/zip.js")) as unknown as ZipModule;
      const loader: ZipLoader = await makeRangeZipLoader(zip, range);
      if (source.format === "cbz") {
        const { makeComicBook } = (await import("@/vendor/foliate-js/comic-book.js")) as unknown as ComicModule;
        return makeComicBook(loader, { name });
      }
      if (source.format === "fbz") {
        const { makeFB2 } = (await import("@/vendor/foliate-js/fb2.js")) as unknown as Fb2Module;
        const entry = loader.entries.find((e) => e.filename.endsWith(".fb2")) ?? loader.entries[0];
        const blob = entry ? await loader.loadBlob(entry.filename) : null;
        if (!blob) throw new Error("No FB2 document in the archive: not supported");
        return makeFB2(blob);
      }
      // Fonts obfuscated with the IDPF algorithm need WebCrypto, which only
      // a secure context has. On plain http they are skipped: the key is
      // empty, the font stays unreadable and the reading font is used.
      if (!globalThis.crypto?.subtle) loader.sha1 = async () => new Uint8Array(0);
      const { EPUB } = (await import("@/vendor/foliate-js/epub.js")) as unknown as EpubModule;
      const book = await new EPUB(loader).init();
      if (book.rendition?.layout !== "pre-paginated" && book.transformTarget) {
        this.#images = new DeferredImages(loader);
        this.#images.attach(book.transformTarget);
      }
      return book;
    }
    const blob = new RemoteBlob(range, contentTypeOf(source.format), name);
    if (source.format === "pdf") {
      const pdf = (await import("@/vendor/foliate-js/pdf.js")) as unknown as PdfModule;
      pdf.configurePDFJS({ base: "/vendor/pdfjs/", load: () => import("pdfjs-dist") });
      return pdf.makePDF(blob);
    }
    if (source.format === "fb2") {
      const { makeFB2 } = (await import("@/vendor/foliate-js/fb2.js")) as unknown as Fb2Module;
      return makeFB2(blob);
    }
    const { isMOBI, MOBI } = (await import("@/vendor/foliate-js/mobi.js")) as unknown as MobiModule;
    if (!(await isMOBI(blob))) throw new Error("Not a MOBI or AZW3 file: not supported");
    const fflate = (await import("@/vendor/foliate-js/vendor/fflate.js")) as unknown as { unzlibSync: unknown };
    return new MOBI({ unzlib: fflate.unzlibSync }).open(blob);
  }

  async open(source: BookSource, { container, presentation, at }: OpenOptions): Promise<{ resolved: ResolveResult | null }> {
    this.#source = source;
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
    await import("@/vendor/foliate-js/view.js");
    const view = document.createElement("foliate-view") as FoliateView;
    view.style.display = "block";
    view.style.width = "100%";
    view.style.height = "100%";
    view.addEventListener("relocate", (e) => this.#onRelocate((e as CustomEvent<FoliateProgress>).detail));
    view.addEventListener("load", (e) => this.#onLoad((e as CustomEvent<{ doc: Document; index: number }>).detail));
    view.addEventListener("link", (e) => {
      const { href } = (e as CustomEvent<{ href: string }>).detail;
      this.#emit("link", { href, external: false });
    });
    view.addEventListener("external-link", (e) => {
      // Opened in a new tab with no reference back to the reader
      e.preventDefault();
      const { href } = (e as CustomEvent<{ href: string }>).detail;
      this.#emit("link", { href, external: true });
      window.open(href, "_blank", "noopener,noreferrer");
    });
    container.append(view);
    this.#view = view;
    await view.open(book);
    // Swipes, taps and the wheel belong to the reader's input layer (src/lib/reader/input.ts)
    view.renderer.setAttribute("no-swipe", "");
    this.setPresentation(presentation);

    const info: BookInfo = {
      title: localized(book.metadata?.title),
      authors: contributors(book.metadata?.author),
      language: (Array.isArray(book.metadata?.language) ? book.metadata?.language[0] : book.metadata?.language) ?? null,
      dir: book.dir === "rtl" ? "rtl" : "ltr",
      layout: book.rendition?.layout === "pre-paginated" ? "pre-paginated" : "reflowable",
      capabilities: capabilitiesFor(source.format),
    };
    this.#emit("ready", { ...info, toc: tocFrom(book.toc) });

    let resolved: ResolveResult | null = null;
    if (at) {
      resolved = await this.resolve(at).catch(() => ({ status: "failed" as const, locator: null }));
      if (resolved.locator) await this.goTo(resolved.locator);
    }
    if (!resolved?.locator) await this.#start();
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
    if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
    this.#view?.close();
    this.#view?.remove();
    this.#book?.destroy?.();
    this.#images?.destroy();
    this.#images = null;
    this.#view = null;
    this.#book = null;
    this.#handlers.clear();
  }

  #isPdf() {
    return this.#source?.format === "pdf";
  }

  #onRelocate(detail: FoliateProgress) {
    const book = this.#book;
    if (!book || !this.#source) return;
    const index = Number.isInteger(detail.index) ? detail.index : 0;
    const section = book.sections[index];
    const locator = locatorFromRelocate({
      fileHash: this.#source.sha256,
      sectionIndex: index,
      href: String(section?.id ?? index),
      sectionFraction: detail.sectionFraction ?? 0,
      fraction: detail.fraction ?? 0,
      location: detail.location?.current,
      cfi: detail.cfi,
      range: detail.range,
      tocLabel: detail.tocItem?.label,
      pageLabel: detail.pageItem?.label,
      pdfPage: this.#isPdf() ? index + 1 : undefined,
    });
    this.#locator = locator;
    this.#emit("relocate", {
      locator,
      chapter: detail.tocItem?.label?.trim() || null,
      reason: this.#jumping > 0 ? "jump" : "turn",
    });
  }

  #onLoad({ doc }: { doc: Document; index: number }) {
    this.#images?.fill(doc);
    this.#emit("document", { doc });
    doc.addEventListener("selectionchange", () => {
      if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
      this.#selectionTimer = setTimeout(() => this.#selectionChanged(), 150);
    });
  }

  #selectionChanged() {
    const locator = this.locatorFromSelection();
    if (locator?.text?.highlight) {
      this.#hadSelection = true;
      this.#emit("selection", { text: locator.text.highlight, locator });
    } else if (this.#hadSelection) {
      this.#hadSelection = false;
      this.#emit("selection", null);
    }
  }

  /** The document a selection is in, with its section */
  #selected(): { range: Range; index: number; text: string } | null {
    for (const { doc, index } of this.#view?.renderer.getContents() ?? []) {
      const selection = doc.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) continue;
      const text = selection.toString();
      if (!text.trim()) continue;
      return { range: selection.getRangeAt(0), index, text };
    }
    return null;
  }

  locatorFromSelection(): DurtalLocator | null {
    const view = this.#view;
    const selected = this.#selected();
    if (!view || !selected || !this.#source || !this.#book) return null;
    const { range, index, text } = selected;
    const quote = quoteAt(range);
    const base = this.#locator;
    return {
      v: 1,
      fileHash: this.#source.sha256,
      href: String(this.#book.sections[index]?.id ?? index),
      sectionIndex: index,
      progression: base?.sectionIndex === index ? base.progression : 0,
      totalProgression: base?.totalProgression ?? 0,
      ...(this.#isPdf() ? { pdf: { page: index + 1 } } : { cfi: view.getCFI(index, range) }),
      // The whole selection is the highlight; the context comes from around it
      text: { ...quote, highlight: normalizeQuoteText(text).trim().slice(0, 10_000) },
      ...(base?.tocLabel ? { tocLabel: base.tocLabel } : {}),
    };
  }

  currentLocator(): DurtalLocator | null {
    return this.#locator;
  }

  setPresentation(presentation: Presentation) {
    const renderer = this.#view?.renderer;
    if (!renderer) return;
    if (this.#book?.rendition?.layout === "pre-paginated") return;
    renderer.setAttribute("flow", "paginated");
    renderer.setAttribute("gap", `${presentation.margin}%`);
    renderer.setAttribute("margin-left", "0px");
    renderer.setAttribute("margin-right", "0px");
    renderer.setAttribute("margin-top", "48px");
    renderer.setAttribute("margin-bottom", "48px");
    renderer.setAttribute("max-inline-size", "720px");
    renderer.setAttribute("max-column-count", "2");
    renderer.setStyles?.(presentationCss(presentation));
  }

  async goTo(target: GoToTarget): Promise<void> {
    const view = this.#view;
    if (!view) return;
    this.#jumping++;
    try {
      if ("fraction" in target) {
        await this.#goToFraction(target.fraction);
      } else if ("v" in target) {
        const current = target.fileHash === this.#source?.sha256;
        if (current && target.pdf?.page) await view.goTo(target.pdf.page - 1);
        else if (current && target.cfi) await view.goTo(target.cfi);
        else await this.#goToFraction(target.totalProgression);
      } else {
        await view.goTo(target.href);
      }
    } finally {
      this.#jumping--;
    }
  }

  /** A fraction of the book; for fixed layouts (PDF, comics), of its pages */
  async #goToFraction(fraction: number) {
    const view = this.#view!;
    const at = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    if (this.#book?.rendition?.layout === "pre-paginated") {
      const last = Math.max(0, this.#book.sections.length - 1);
      await view.goTo(Math.round(at * last));
    } else await view.goToFraction(at);
  }

  next() {
    return this.#view?.next() ?? Promise.resolve();
  }
  prev() {
    return this.#view?.prev() ?? Promise.resolve();
  }
  goLeft() {
    return this.#view?.goLeft() ?? Promise.resolve();
  }
  goRight() {
    return this.#view?.goRight() ?? Promise.resolve();
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
    if (!view || !book || !source || locator?.v !== 1) return { status: "failed", locator: null };
    if (locator.fileHash === source.sha256) {
      if (locator.pdf?.page && locator.pdf.page <= book.sections.length) return { status: "exact", locator };
      if (locator.cfi) {
        const target = view.resolveNavigation(locator.cfi);
        if (target && Number.isInteger(target.index) && book.sections[target.index]) return { status: "exact", locator };
      }
    }
    if (locator.text?.highlight && !this.#isPdf()) {
      const first = book.sections.findIndex((s) => String(s.id) === locator.href);
      const order = [first, ...book.sections.keys()].filter((i, at, all) => i >= 0 && all.indexOf(i) === at);
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
      return { status: "approximate", locator: { ...rest, fileHash: source.sha256 } };
    }
    return { status: "failed", locator: null };
  }

  async #findQuote(index: number, locator: DurtalLocator): Promise<DurtalLocator | null> {
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
    const hint = locator.sectionIndex === index ? Math.round(locator.progression * text.length) : undefined;
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

export function createFoliateEngine(): ReaderEngine & { readonly transfer: { bytes: number; requests: number } } {
  return new FoliateEngine();
}
