import type { FoliateBook } from "./foliate";
import { unit } from "@/lib/reader/position-index";

export function idleSlice(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    let idle = 0,
      timer: ReturnType<typeof setTimeout> | null = null;
    const abort = () => {
      if (idle) globalThis.cancelIdleCallback?.(idle);
      if (timer) clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (typeof requestIdleCallback === "function")
      idle = requestIdleCallback(done, { timeout: 100 });
    else timer = setTimeout(done, 0);
  });
}
export interface MarkupIndex {
  offsets: Record<string, number>;
  length: number;
  label: string;
  textRatio: number;
}
/** Small sections use a bounded incremental scan too; no whole-section DOMParser. */
export async function scanMarkup(
  markup: string,
  fragments: string[],
  signal: AbortSignal,
): Promise<MarkupIndex> {
  const offsets: Record<string, number> = Object.create(null);
  const wanted = new Set(fragments);
  const tags = /<[^>]*>/g;
  let textLength = 0,
    previous = 0,
    steps = 0,
    slice = performance.now();
  for (let tag = tags.exec(markup); tag; tag = tags.exec(markup)) {
    textLength += tag.index - previous;
    previous = tags.lastIndex;
    const attributes =
      /\s(?:id|name|aid|data-foliate-id)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    for (
      let attr = attributes.exec(tag[0]);
      attr;
      attr = attributes.exec(tag[0])
    ) {
      const id = attr[1] ?? attr[2];
      if (wanted.has(id) && !(id in offsets)) offsets[id] = tag.index;
    }
    if (++steps % 64 === 0 && performance.now() - slice >= 8) {
      await idleSlice(signal);
      slice = performance.now();
    }
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  }
  textLength += markup.length - previous;
  // Only the beginning is inspected for a section heading; long chapters cannot cause an unbounded regex.
  const head = markup.slice(0, 65536);
  const heading =
    /<(h[123])\b[^>]*>([\s\S]*?)<\/\1>/i.exec(head)?.[2] ??
    /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ??
    "";
  const label = heading
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    offsets,
    length: markup.length,
    label,
    textRatio: markup.length ? textLength / markup.length : 0.5,
  };
}

export async function* buildAnchorIndex(options: {
  book: FoliateBook;
  fractions: number[];
  hrefs: string[];
  signal: AbortSignal;
  scanSection?: (
    index: number,
    fragments: unknown[],
    signal: AbortSignal,
  ) => Promise<MarkupIndex | null>;
}) {
  const { book, signal, fractions } = options;
  const groups = new Map<number, { href: string; fragment: unknown }[]>();
  let groupedAt = performance.now();
  for (const href of options.hrefs) {
    if (signal.aborted) return;
    const split = await book.splitTOCHref?.(href);
    const section = split
      ? book.sections.findIndex((item) => String(item.id) === String(split[0]))
      : book.sections.findIndex(
          (item) => String(item.id) === href.split("#")[0],
        );
    if (section < 0) continue;
    const fragment = split?.[1] ?? href.split("#")[1] ?? "";
    const group = groups.get(section) ?? [];
    group.push({ href, fragment });
    groups.set(section, group);
    if (performance.now() - groupedAt >= 8) {
      await idleSlice(signal);
      groupedAt = performance.now();
    }
  }
  for (const [index, entries] of groups) {
    await idleSlice(signal);
    const section = book.sections[index];
    const start = fractions[index] ?? 0;
    const share =
      section.linear === "no" ? 0 : (fractions[index + 1] ?? 1) - start;
    let scan: MarkupIndex | null = null;
    if (options.scanSection)
      scan = await options.scanSection(
        index,
        entries.map((entry) => entry.fragment),
        signal,
      );
    else if (section.loadText) {
      const raw = (await section.loadText()) ?? "";
      scan = await scanMarkup(
        raw,
        entries.map((entry) => indexFragment(book, entry.fragment)),
        signal,
      );
    }
    if (signal.aborted) return;
    if (!scan && section.createDocument) {
      const doc = await section.createDocument();
      const root = doc.body ?? doc.documentElement;
      const walker = doc.createTreeWalker(root, 4);
      let size = 0,
        slice = performance.now();
      const offsets = new Map<Node, number>();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        offsets.set(node, size);
        size += node.textContent?.length ?? 0;
        if (performance.now() - slice >= 8) {
          await idleSlice(signal);
          slice = performance.now();
        }
      }
      for (const entry of entries) {
        const resolved = await book.resolveHref(entry.href);
        const anchor = resolved?.anchor?.(doc);
        const range =
          anchor && "startContainer" in anchor ? (anchor as Range) : null;
        const element = range?.startContainer ?? anchor;
        let offset = size;
        for (const [node, at] of offsets) {
          if (
            node === element ||
            (element && (element as Node).contains(node)) ||
            (element && (element as Node).compareDocumentPosition(node) & 4)
          ) {
            offset = at;
            break;
          }
        }
        yield {
          href: entry.href,
          fraction: unit(
            start + (entry.fragment && size ? offset / size : 0) * share,
          ),
        };
      }
    } else
      for (const entry of entries) {
        const fragment = indexFragment(book, entry.fragment);
        yield {
          href: entry.href,
          fraction: unit(
            start +
              (fragment && scan?.length
                ? (scan.offsets[fragment] ?? 0) / scan.length
                : 0) *
                share,
          ),
          sectionLabel: scan?.label,
          textRatio: scan?.textRatio,
        };
      }
  }
}
export function indexFragment(book: FoliateBook, fragment: unknown): string {
  return typeof fragment === "string" || typeof fragment === "number"
    ? String(fragment)
    : (book.indexFragment?.(fragment) ?? "");
}
