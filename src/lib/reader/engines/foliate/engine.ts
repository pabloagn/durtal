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
  NavigationOwner,
  Marginalia,
} from "@/lib/reader/engine";
import { presentationCss } from "@/lib/reader/presentation";
import { PDFJS_BASE } from "@/lib/reader/first-range";
import { ReadError, RangeSource, RemoteBlob } from "./remote-blob";
import { DeferredImages } from "./deferred-images";
import { makeRangeZipLoader } from "./zip-reader";
import { startPdfWorker } from "./preload";
import {
  locatorFromRelocate,
  quoteFromSelection,
  visibleOriginRange,
} from "./locator";
import { findPageMap, parsePageMap } from "./page-map";
import { buildAnchorIndex, indexFragment, scanMarkup } from "./position-index";
import { matchQuote } from "./quote-match";
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
  if (format === "cbz")
    return { search: false, tts: false, spreads: true, scrolled: false };
  if (format === "pdf")
    return { search: true, tts: false, spreads: true, scrolled: true };
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
  #locator: DurtalLocator | null = null;
  #jumping = 0;
  #destroyed = false;
  #selectionTimer: ReturnType<typeof setTimeout> | null = null;
  #hadSelection = false;
  #keyboardSelection = false;
  /** A reflowable EPUB's large images, shown after its text */
  #images: DeferredImages | null = null;
  #info: BookInfo | null = null;
  #zip: ZipLoader | null = null;
  #readingFraction = 0;
  #owner: NavigationOwner | undefined;
  #presentation: Presentation | null = null;
  #marginalia: Marginalia | null = null;
  #historyMarks: string[] = [];
  #markEpoch = 0;
  #markTimer: ReturnType<typeof setTimeout> | null = null;

  /** Bytes and requests so far, for the performance harness */
  get transfer() {
    return {
      bytes: this.#range?.transferred ?? 0,
      requests: this.#range?.requests ?? 0,
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
    if (ZIP_FORMATS.has(source.format)) {
      const zip =
        (await import("@/vendor/foliate-js/vendor/zip.js")) as unknown as ZipModule;
      const loader: ZipLoader = await makeRangeZipLoader(zip, range);
      this.#zip = loader;
      if (source.format === "cbz") {
        const { makeComicBook } =
          (await import("@/vendor/foliate-js/comic-book.js")) as unknown as ComicModule;
        return makeComicBook(loader, { name });
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
    if (source.format === "pdf") {
      const pdf =
        (await import("@/vendor/foliate-js/pdf.js")) as unknown as PdfModule;
      pdf.configurePDFJS({
        base: PDFJS_BASE,
        load: () =>
          import("pdfjs-dist").then((lib) => {
            const worker = startPdfWorker();
            if (worker && !lib.GlobalWorkerOptions.workerPort)
              lib.GlobalWorkerOptions.workerPort = worker;
            return lib;
          }),
      });
      return pdf.makePDF(blob);
    }
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
    await import("@/vendor/foliate-js/view.js");
    const view = document.createElement("foliate-view") as FoliateView;
    view.style.display = "block";
    view.style.width = "100%";
    view.style.height = "100%";
    view.addEventListener("relocate", (e) =>
      this.#onRelocate((e as CustomEvent<FoliateProgress>).detail),
    );
    view.addEventListener("load", (e) =>
      this.#onLoad((e as CustomEvent<{ doc: Document; index: number }>).detail),
    );
    view.addEventListener("link", (e) => {
      // Durtal owns history and publication; the vendored default must never jump in parallel.
      e.preventDefault();
      const { href, a } = (e as CustomEvent<{ href: string; a?: Element }>)
        .detail;
      let originMark: string | undefined;
      if (a && this.#locator) {
        const range = a.ownerDocument.createRange();
        range.selectNodeContents(a);
        originMark = view.getCFI(this.#locator.sectionIndex, range);
      }
      this.#emit("link", { href, external: false, originMark });
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
    if (this.#markTimer) clearTimeout(this.#markTimer);
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
    const linear = section?.linear !== "no";
    const atEnd =
      linear &&
      index === book.sections.findLastIndex((item) => item.linear !== "no") &&
      !!this.#view?.renderer.atEnd;
    if (linear) this.#readingFraction = atEnd ? 1 : (detail.fraction ?? 0);
    const fraction = this.#readingFraction;
    const locator = locatorFromRelocate({
      fileHash: this.#source.sha256,
      sectionIndex: index,
      href: String(section?.id ?? index),
      sectionFraction: detail.sectionFraction ?? 0,
      fraction,
      location: linear
        ? detail.location?.current
        : Math.floor((fraction * (this.#info?.linearSize ?? 0)) / 1500),
      cfi: detail.cfi,
      range: detail.range,
      tocLabel: detail.tocItem?.label,
      pageLabel: detail.pageItem?.label,
      pdfPage: this.#isPdf() ? index + 1 : undefined,
    });
    this.#locator = locator;
    if (locator.position && this.#info)
      locator.position = Math.min(this.#info.locationCount, locator.position);
    const reason =
      this.#jumping > 0 ||
      !["page", "snap", "scroll"].includes(detail.reason ?? "")
        ? "jump"
        : "turn";
    if (reason === "turn") this.setDecorations("history", []);
    const tocItem = detail.tocItem?.href
      ? (tocFrom([detail.tocItem])[0] ?? null)
      : null;
    const origin =
      detail.range && !this.#isPdf() ? visibleOriginRange(detail.range) : null;
    this.#writeMarginalia();
    this.#emit("relocate", {
      locator,
      chapter: detail.tocItem?.label?.trim() || null,
      reason,
      atEnd,
      activity: detail.reason === "scroll" ? "scroll" : "turn",
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

  #onLoad({ doc }: { doc: Document; index: number }) {
    this.#images?.fill(doc);
    this.#emit("document", { doc });
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
      if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
      this.#selectionTimer = setTimeout(() => this.#selectionChanged(), 150);
    });
  }

  #selectionChanged() {
    const locator = this.locatorFromSelection();
    if (locator?.text?.highlight) {
      this.#hadSelection = true;
      const selected = this.#selected();
      if (!selected) return;
      const bounds = selected.range.getBoundingClientRect();
      const doc = selected.range.startContainer.ownerDocument;
      const frame = doc?.defaultView?.frameElement;
      const host = frame?.getBoundingClientRect();
      const scaleX =
        host && frame
          ? host.width / ((frame as HTMLElement).offsetWidth || host.width)
          : 1;
      const scaleY =
        host && frame
          ? host.height / ((frame as HTMLElement).offsetHeight || host.height)
          : 1;
      const rect = {
        left: (host?.left ?? 0) + bounds.left * scaleX,
        right: (host?.left ?? 0) + bounds.right * scaleX,
        top: (host?.top ?? 0) + bounds.top * scaleY,
        bottom: (host?.top ?? 0) + bounds.bottom * scaleY,
      };
      this.#emit("selection", {
        text: locator.text.highlight,
        locator,
        rect,
        keyboard: this.#keyboardSelection,
      });
    } else if (this.#hadSelection) {
      this.#hadSelection = false;
      this.#emit("selection", null);
    }
  }

  /** The document a selection is in, with its section */
  #selected(): { range: Range; index: number; text: string } | null {
    for (const { doc, index } of this.#view?.renderer.getContents() ?? []) {
      const selection = doc.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount)
        continue;
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
    const { range, index } = selected;
    const quote = quoteFromSelection(range);
    const base = this.#locator;
    const progress = view.getProgressOf(index, range);
    const tocLabel = progress?.tocItem?.label?.trim().slice(0, 300);
    const pageLabel = progress?.pageItem?.label?.trim().slice(0, 40);
    return {
      v: 1,
      fileHash: this.#source.sha256,
      href: String(this.#book.sections[index]?.id ?? index),
      sectionIndex: index,
      progression: base?.sectionIndex === index ? base.progression : 0,
      totalProgression: base?.totalProgression ?? 0,
      ...(this.#isPdf()
        ? { pdf: { page: index + 1 } }
        : { cfi: view.getCFI(index, range) }),
      // The whole selection is the highlight; the context comes from around it
      text: quote,
      ...(tocLabel ? { tocLabel } : {}),
      ...(pageLabel ? { pageLabel } : {}),
      ...(base?.position ? { position: base.position } : {}),
    };
  }

  clearSelection(): void {
    if (this.#selectionTimer) clearTimeout(this.#selectionTimer);
    for (const { doc } of this.#view?.renderer.getContents() ?? [])
      doc.getSelection()?.removeAllRanges();
    this.#hadSelection = false;
    this.#emit("selection", null);
  }

  currentLocator(): DurtalLocator | null {
    return this.#locator;
  }

  setPresentation(presentation: Presentation) {
    this.#presentation = presentation;
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

  async goTo(target: GoToTarget, owner?: NavigationOwner): Promise<void> {
    const view = this.#view;
    if (!view || this.#destroyed) throw new Error("The book is closed.");
    if (owner?.signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    this.#owner = owner;
    this.#jumping++;
    try {
      if ("fraction" in target) {
        await this.#goToFraction(target.fraction);
      } else if ("location" in target) {
        await this.#goToFraction(this.locationToFraction(target.location));
      } else if ("page" in target) {
        const page = this.#info?.pageList.find(
          (item) => item.label.toLowerCase() === target.page.toLowerCase(),
        );
        if (!page) throw new Error("This edition has no page " + target.page);
        await this.#anchor(page.href);
      } else if ("v" in target) {
        this.#readingFraction = target.totalProgression;
        const current = target.fileHash === this.#source?.sha256;
        if (current && target.pdf?.page)
          await this.#anchor(target.pdf.page - 1);
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
      if (this.#destroyed || owner?.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      // A renderer may leave the same page without a new relocate. Give the controller
      // an owned arrival; its exact-anchor comparison makes this a no-op.
      if (view.lastLocation) this.#onRelocate(view.lastLocation);
    } finally {
      this.#jumping--;
      this.#owner = undefined;
    }
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
  #writeMarginalia() {
    const renderer = this.#view?.renderer;
    if (!renderer) return;
    const lines = this.#marginalia;
    const rtl = this.#book?.dir === "rtl";
    const draw = (
      elements: HTMLElement[] | null | undefined,
      parts: [string, string] | undefined,
    ) => {
      if (!elements) return;
      for (const element of elements) {
        element.replaceChildren();
        element.style.cssText =
          "display:flex;justify-content:space-between;gap:12px;overflow:hidden;font:12px Inter,sans-serif;font-variant-numeric:tabular-nums;color:" +
          (lines?.color ?? this.#presentation?.colors.muted ?? "inherit");
      }
      if (!parts) return;
      const first = elements[rtl ? elements.length - 1 : 0];
      const last = elements[rtl ? 0 : elements.length - 1];
      for (const [at, text] of parts.entries()) {
        const element = at ? last : first;
        if (!element || !text) continue;
        const span = document.createElement("span");
        span.textContent = text;
        span.style.cssText =
          "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
          (at ? "margin-inline-start:auto" : "");
        element.append(span);
      }
    };
    draw(renderer.heads, lines?.head);
    draw(renderer.feet, lines?.foot);
  }
  setDecorations(
    _group: "history",
    decorations: { cfi: string; color: string }[],
  ) {
    const epoch = ++this.#markEpoch;
    if (this.#markTimer) {
      clearTimeout(this.#markTimer);
      this.#markTimer = null;
    }
    for (const value of this.#historyMarks)
      void this.#view?.addAnnotation({ value, group: "history" }, true);
    this.#historyMarks = [];
    if (!decorations.length || !this.#view || this.#destroyed) return;
    const view = this.#view;
    void import("@/vendor/foliate-js/overlayer.js").then((module) => {
      if (this.#destroyed || this.#view !== view || epoch !== this.#markEpoch)
        return;
      const draw = (event: Event) => {
        const detail = (
          event as CustomEvent<{
            annotation: { group?: string; color?: string };
            draw: (fn: unknown, options: { color: string }) => void;
          }>
        ).detail;
        if (detail.annotation.group === "history")
          detail.draw(module.Overlayer.outline, {
            color:
              detail.annotation.color ??
              this.#presentation?.colors.link ??
              "#8c9fae",
          });
      };
      view.addEventListener("draw-annotation", draw);
      const additions = decorations.map((item) => {
        const value = "foliate-note:" + item.cfi;
        this.#historyMarks.push(value);
        return view
          .addAnnotation({
            value,
            group: "history",
            color:
              item.color === "link"
                ? this.#presentation?.colors.link
                : item.color,
          })
          .then(() => {
            if (epoch !== this.#markEpoch && !this.#destroyed)
              return view.addAnnotation({ value, group: "history" }, true);
          });
      });
      void Promise.all(additions)
        .catch(() => {
          /* Returning still works if an outline cannot be drawn. */
        })
        .finally(() => view.removeEventListener("draw-annotation", draw));
      this.#markTimer = setTimeout(
        () => this.setDecorations("history", []),
        4000,
      );
    });
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
