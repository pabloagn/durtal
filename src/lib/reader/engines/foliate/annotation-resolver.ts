import type {
  AnnotationResolveResult,
  DurtalLocator,
} from "@/lib/reader/engine";
import { createAnnotationQuoteMatcher } from "./annotation-anchor";
import { quoteFromSelection } from "./locator";
import { normalizeQuoteText } from "./quote-match";
import type { FoliateBook, FoliateView } from "./foliate";

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number; end: number }[];
}
/** Script, publisher CSS and ruby glosses are not the selected reading text. */
function textIndex(doc: Document): TextIndex | null {
  if (!doc.body) return null;
  const walker = doc.createTreeWalker(doc.body, 4, {
    acceptNode: (node) =>
      node.parentElement?.closest("script,style,noscript,rt,rp,rtc,[cfi-inert]")
        ? 2
        : 1,
  });
  const nodes: TextIndex["nodes"] = [];
  let text = "";
  for (
    let node = walker.nextNode() as Text | null;
    node;
    node = walker.nextNode() as Text | null
  ) {
    if (text.length + node.length > 1_000_000) return null;
    nodes.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
  }
  return { text, nodes };
}
function rangeAt(doc: Document, index: TextIndex, start: number, end: number) {
  const first = index.nodes.find((part) => part.end > start);
  const last = index.nodes.find((part) => part.start < end && part.end >= end);
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

/** Per-open document/text cache is shared by every mark, separate from navigation.
 * This resolver never moves the renderer or uses a progress hint to disambiguate.
 */
export class FoliateAnnotationResolver {
  #docs = new Map<number, Promise<Document | null>>();
  #text = new WeakMap<Document, TextIndex | null>();
  #closed = false;
  constructor(
    private book: FoliateBook,
    private view: FoliateView,
    private hash: string,
    private linearProgress: () => number,
  ) {}
  destroy() {
    this.#closed = true;
    this.#docs.clear();
  }
  async #document(index: number) {
    const loaded = this.view.renderer
      .getContents()
      .find((content) => content.index === index)?.doc;
    if (loaded) return loaded;
    let promise = this.#docs.get(index);
    if (!promise) {
      promise = Promise.resolve().then(
        () => this.book.sections[index]?.createDocument?.() ?? null,
      );
      this.#docs.set(index, promise);
    }
    return promise;
  }
  #index(doc: Document) {
    if (!this.#text.has(doc)) this.#text.set(doc, textIndex(doc));
    return this.#text.get(doc) ?? null;
  }
  #locator(
    index: number,
    range: Range,
    old: DurtalLocator,
    ratio: number,
  ): DurtalLocator {
    const progress = this.view.getProgressOf(index, range);
    const fractions = this.view.getSectionFractions();
    return {
      ...old,
      fileHash: this.hash,
      href: String(this.book.sections[index].id),
      sectionIndex: index,
      cfi: this.view.getCFI(index, range),
      text: quoteFromSelection(range),
      // Physical range is independent of the last linear reading position.
      progression: ratio,
      totalProgression:
        this.book.sections[index].linear === "no"
          ? this.linearProgress()
          : (fractions[index] ?? 0) +
            ((fractions[index + 1] ?? 1) - (fractions[index] ?? 0)) * ratio,
      tocLabel: progress.tocItem?.label ?? old.tocLabel,
      pageLabel: progress.pageItem?.label ?? old.pageLabel,
      position: undefined,
      pdf: undefined,
    };
  }
  async resolve(
    annotation: { kind: "highlight" | "bookmark"; locator: DurtalLocator },
    options: { signal?: AbortSignal } = {},
  ): Promise<AnnotationResolveResult> {
    const { locator, kind } = annotation;
    const canceled = () => this.#closed || !!options.signal?.aborted;
    const pending = (): AnnotationResolveResult => ({
      status: "pending",
      locator: null,
    });
    if (canceled()) return pending();
    const quote = locator.text?.highlight
      ? { ...locator.text, highlight: locator.text.highlight }
      : null;
    if (locator.fileHash === this.hash && locator.cfi) {
      try {
        const target = this.view.resolveNavigation(locator.cfi);
        if (target && this.book.sections[target.index]) {
          const doc = await this.#document(target.index);
          if (canceled()) return pending();
          const range = doc && target.anchor?.(doc);
          if (
            range &&
            "startContainer" in range &&
            (kind === "bookmark" ||
              (!range.collapsed &&
                quote &&
                normalizeQuoteText(range.toString()).trim() ===
                  normalizeQuoteText(quote.highlight).trim()))
          )
            return { status: "exact", locator };
        }
      } catch {
        /* Invalid CFI must fall through to the strict quote scan. */
      }
    }
    if (quote) {
      const match = createAnnotationQuoteMatcher({ signal: options.signal });
      const preferred = this.book.sections.findIndex(
        (section) => String(section.id) === locator.href,
      );
      const order = this.book.sections
        .map((_, index) => index)
        .filter((index) => index !== preferred);
      if (preferred >= 0) order.unshift(preferred);
      const found: {
        score: number;
        index: number;
        doc: Document;
        text: TextIndex;
        start: number;
        end: number;
      }[] = [];
      let ambiguous = false;
      for (const index of order) {
        if (canceled()) return pending();
        let doc: Document | null;
        try {
          doc = await this.#document(index);
        } catch {
          return pending();
        }
        if (canceled()) return pending();
        const text = doc && this.#index(doc);
        if (!doc || !text) return pending();
        const result = match(text.text, quote);
        if (result.status === "deferred") return pending();
        if (result.status === "ambiguous") ambiguous = true;
        if (result.status === "found") {
          found.push({
            score: result.match.score,
            index,
            doc,
            text,
            start: result.match.start,
            end: result.match.end,
          });
          if (index === preferred) break;
        } else if (index === preferred && result.status === "ambiguous") break;
        // Yield between sections; cancellation prevents any stale publication.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (canceled()) return pending();
      found.sort((a, b) => b.score - a.score);
      if (
        !ambiguous &&
        found[0] &&
        (!found[1] || found[0].score - found[1].score >= 0.01)
      ) {
        const best = found[0],
          range = rangeAt(best.doc, best.text, best.start, best.end);
        if (range)
          return {
            status: "healed",
            locator: this.#locator(
              best.index,
              range,
              locator,
              best.start / Math.max(1, best.text.text.length),
            ),
          };
      }
      // A valid fraction cannot rescue a missing or ambiguous highlighted passage.
      if (kind === "highlight") return { status: "orphaned", locator: null };
    }
    if (
      kind === "bookmark" &&
      Number.isFinite(locator.totalProgression) &&
      locator.totalProgression >= 0 &&
      locator.totalProgression <= 1
    )
      return {
        status: "approximate",
        locator: {
          ...locator,
          fileHash: this.hash,
          cfi: undefined,
          pdf: undefined,
        },
      };
    return { status: "orphaned", locator: null };
  }
}
