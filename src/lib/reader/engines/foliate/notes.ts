import type { ReaderNote } from "../../engine";
import { sanitizeNote } from "../../notes/sanitize";
import { classifyReaderLink } from "../../links/policy";
import { abortable, checkAbort, yieldReaderTask } from "../../search/task";
import type { FoliateBook } from "./foliate";

interface Helpers {
  isFootnoteReference(a: Element): { yes: boolean; maybe(): boolean };
  getReferencedType(el: Element | null): string | null;
  locateNote(
    doc: Document,
    anchor?: (doc: Document) => Range | Element,
    options?: { check: boolean },
  ): Range;
}
const kinds: Record<string, ReaderNote["kind"]> = {
  footnote: "Footnote",
  endnote: "Endnote",
  note: "Note",
  biblioentry: "Bibliography",
  definition: "Definition",
};
const noteNames =
  /\b(?:notes?|endnotes?|footnotes?|notas?|anmerkungen|remarques)\b/i;

/** Three pristine documents; popup blobs are separate leases revoked on every close/replacement. */
export function createNotes(context: {
  book: FoliateBook;
  resolve?(
    href: string,
  ):
    | { index: number; anchor?: (doc: Document) => Range | Element }
    | null
    | undefined;
  getCFI?(index: number, range: Range): string;
  readingFont?(): { fontFamily: string; fontFaces: string };
  readingBusy?(): boolean;
  publish(note: ReaderNote | null): void;
  document: Document;
}) {
  const cache = new Map<number, Document>();
  let active: AbortController | null = null;
  let urls: string[] = [];
  let destroyed = false;
  const references = new Map<string, { cfi: string; index: number }>();
  const canonical = (href: string) => {
    try {
      return decodeURI(href);
    } catch {
      return href;
    }
  };
  let prefetch: AbortController | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const release = () => {
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
  };
  const close = () => {
    active?.abort();
    active = null;
    release();
    context.publish(null);
  };
  return {
    reference(href: string) {
      return references.get(canonical(href)) ?? null;
    },
    async remember(doc: Document, index: number, signal: AbortSignal) {
      const section = context.book.sections[index];
      let budget = performance.now();
      for (const a of doc.querySelectorAll("a[href]")) {
        checkAbort(signal);
        const href =
          section.resolveHref?.(a.getAttribute("href")!) ??
          a.getAttribute("href")!;
        if (classifyReaderLink(href).kind !== "internal") continue;
        const key = canonical(href);
        const previous = references.get(key);
        if (!previous || previous.index > index) {
          const range = doc.createRange();
          range.selectNodeContents(a);
          const cfi = context.getCFI?.(index, range);
          if (cfi) references.set(key, { cfi, index });
        }
        if (performance.now() - budget >= 8) {
          await yieldReaderTask(signal);
          budget = performance.now();
        }
      }
    },
    prefetch(doc: Document, index: number) {
      if (idle) clearTimeout(idle);
      prefetch?.abort();
      const controller = new AbortController();
      prefetch = controller;
      idle = setTimeout(() => {
        idle = null;
        if (destroyed || active || context.readingBusy?.()) return;
        void (async () => {
          const helpers =
            (await import("@/vendor/foliate-js/footnotes.js")) as unknown as Helpers;
          for (const a of doc.querySelectorAll("a[href]")) {
            checkAbort(controller.signal);
            if (active || context.readingBusy?.()) return;
            const reference = helpers.isFootnoteReference(a);
            if (!reference.yes) continue;
            const href =
              context.book.sections[index].resolveHref?.(
                a.getAttribute("href")!,
              ) ?? a.getAttribute("href")!;
            if (classifyReaderLink(href).kind !== "internal") continue;
            const target = await abortable(
              Promise.resolve(context.book.resolveHref(href)),
              controller.signal,
            );
            if (!target || cache.has(target.index)) continue;
            const section = context.book.sections[target.index];
            if (!section?.createDocument) continue;
            const parsed = await abortable(
              section.createDocument({ signal: controller.signal }),
              controller.signal,
            );
            checkAbort(controller.signal);
            cache.set(target.index, parsed);
            while (cache.size > 3) cache.delete(cache.keys().next().value!);
            // One referenced section per idle opportunity, behind reading work.
            return;
          }
        })().catch(() => {});
      }, 2000);
    },
    async open(
      href: string,
      options: {
        reference?: Element;
        originMark?: string;
        keyboard?: boolean;
        force?: boolean;
      } = {},
    ): Promise<boolean> {
      active?.abort();
      prefetch?.abort();
      const controller = new AbortController();
      active = controller;
      const { signal } = controller;
      if (destroyed || classifyReaderLink(href).kind !== "internal")
        return false;
      const leases: string[] = [];
      let shown = false;
      try {
        const { book } = context;
        const resolved = await abortable(
          Promise.resolve(context.resolve?.(href) ?? book.resolveHref(href)),
          signal,
        );
        if (!resolved) return false;
        const helpers =
          (await import("@/vendor/foliate-js/footnotes.js")) as unknown as Helpers;
        checkAbort(signal);
        const a = options.reference;
        const types = (
          a?.getAttributeNS("http://www.idpf.org/2007/ops", "type") ||
          a?.getAttribute("epub:type") ||
          ""
        ).split(/\s+/);
        const roles = (a?.getAttribute("role") ?? "").split(/\s+/);
        if (types.includes("backlink") || roles.includes("doc-backlink"))
          return false;
        const reference = a ? helpers.isFootnoteReference(a) : null;
        const semantic = options.force || reference?.yes || reference?.maybe();
        const section = book.sections[resolved.index];
        if (!section?.createDocument) return false;

        let doc = cache.get(resolved.index);
        if (doc) {
          cache.delete(resolved.index);
          cache.set(resolved.index, doc);
        } else {
          doc = await abortable(section.createDocument({ signal }), signal);
          checkAbort(signal);
          cache.set(resolved.index, doc);
          while (cache.size > 3) cache.delete(cache.keys().next().value!);
        }
        let target = resolved.anchor?.(doc);
        if (options.force && target && "startContainer" in target) {
          const parent =
            target.startContainer.nodeType === 1
              ? (target.startContainer as Element)
              : target.startContainer.parentElement;
          const note = parent?.closest(
            'aside, li, .note, [role~="doc-footnote"], [role~="doc-endnote"]',
          );
          if (note) target = note;
        }
        const element =
          target && "startContainer" in target
            ? target.startContainer.parentElement
            : (target as Element | null);
        const referencedType = helpers.getReferencedType(element);
        const heading = doc.querySelector("h1,h2,title")?.textContent ?? "";
        if (
          !semantic &&
          section.linear !== "no" &&
          !noteNames.test(String(section.id) + " " + heading)
        )
          return false;
        const range = helpers.locateNote(
          doc,
          target ? () => target as Range | Element : resolved.anchor,
          { check: !semantic },
        );
        if (!semantic && range.toString().length > 1500) return false;
        const fragment = range.cloneContents();
        const images = new Map<string, string>();
        for (const image of fragment.querySelectorAll("img[src]")) {
          checkAbort(signal);
          const src = image.getAttribute("src")!;
          const resolvedImage = section.resolveHref?.(src) ?? src;
          if (classifyReaderLink(resolvedImage).kind !== "internal") continue;
          const blob = await abortable(
            book.loadBlob?.(resolvedImage) ?? Promise.resolve(null),
            signal,
          );
          checkAbort(signal);
          if (blob) {
            const url = URL.createObjectURL(blob);
            images.set(src, url);
            leases.push(url);
          }
        }
        const content = sanitizeNote(fragment, {
          document: context.document,
          resolveLink: (raw) => section.resolveHref?.(raw) ?? raw,
          imageUrl: (raw) => images.get(raw) ?? null,
        });
        checkAbort(signal);
        if (!content.textContent?.trim() && !content.querySelector("img"))
          return false;
        const rect = a?.getBoundingClientRect();
        const frame =
          a?.ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
        release();
        urls = leases.splice(0);
        context.publish({
          kind: kinds[referencedType ?? "note"] ?? "Note",
          ...context.readingFont?.(),
          content,
          href,
          originMark: options.originMark,
          keyboard: options.keyboard ?? false,
          reference: a as HTMLElement | undefined,
          anchor: rect
            ? {
                left: rect.left + (frame?.left ?? 0),
                top: rect.top + (frame?.top ?? 0),
                right: rect.right + (frame?.left ?? 0),
                bottom: rect.bottom + (frame?.top ?? 0),
              }
            : null,
        });
        shown = true;
        return true;
      } catch (error) {
        if (signal.aborted) return true; // A replacement owns subsequent delivery; never navigate a stale link.
        if (options.force) throw error;
        return false;
      } finally {
        for (const url of leases) URL.revokeObjectURL(url);
        if (!shown && active === controller) active = null;
      }
    },
    close,
    destroy() {
      destroyed = true;
      prefetch?.abort();
      if (idle) clearTimeout(idle);
      close();
      cache.clear();
      references.clear();
    },
  };
}
