import type { BookInfo, DurtalLocator } from "../../engine";
import {
  collectSearchText,
  NOTE_SELECTOR,
  searchExcerpt,
} from "../../search/document";
import { queryRuns, SEARCH_HIT_LIMIT, safeLocale } from "../../search/fold";
import { abortable, checkAbort, yieldReaderTask } from "../../search/task";
import type {
  SearchHit,
  SearchRequest,
  SearchUpdate,
} from "../../search/types";
import { createSearchWorker } from "../../search/worker-client";
import type { FoliateBook, FoliateView } from "./foliate";

/** SLN-502's PdfSession methods, bound by the adapter with its owned text-layer CSS. */
export interface PdfSearchProvider {
  pdfPageText(request: {
    fileHash: string;
    pageIndex: number;
    signal: AbortSignal;
  }): Promise<{
    fileHash: string;
    pageIndex: number;
    pageLabel: string;
    text: string;
  }>;
  locatorForPdfTextOffsets(request: {
    fileHash: string;
    pageIndex: number;
    signal: AbortSignal;
    start: number;
    end: number;
  }): Promise<DurtalLocator | null>;
}

/** Lazy acquisition and worker backpressure keep only the current pristine section alive. */
export async function* searchBook(
  context: {
    book: FoliateBook;
    view: FoliateView;
    info: BookInfo;
    fileHash: string;
    pdf: boolean;
    pdfProvider?: PdfSearchProvider;
    current: DurtalLocator | null;
    noPdfText(): void;
    rememberDocument?(
      doc: Document,
      index: number,
      signal: AbortSignal,
    ): Promise<void>;
    worker?: typeof createSearchWorker;
  },
  request: SearchRequest,
): AsyncGenerator<SearchUpdate> {
  const { book, view, info, fileHash } = context;
  const { signal } = request;
  checkAbort(signal);
  if (!queryRuns(request.query, info.language) || !info.capabilities.search)
    return;
  if (context.pdf && !context.pdfProvider)
    throw new Error(
      "The PDF text provider is unavailable. Search needs measured page text.",
    );
  const worker = (context.worker ?? createSearchWorker)(signal);
  const first = Math.max(
    0,
    Math.min(
      book.sections.length - 1,
      request.startSection ?? context.current?.sectionIndex ?? 0,
    ),
  );
  let count = 0;
  let pagesWithText = 0;
  try {
    for (let completed = 0; completed < book.sections.length; completed++) {
      checkAbort(signal);
      const index = (first + completed) % book.sections.length;
      const section = book.sections[index];
      const pageRequest = { fileHash, pageIndex: index, signal };
      const doc = context.pdf
        ? null
        : section.createDocument
          ? await abortable(section.createDocument({ signal }), signal)
          : null;
      checkAbort(signal);
      if (!doc && !context.pdf)
        throw new Error("This section has no searchable document.");
      if (doc) await context.rememberDocument?.(doc, index, signal);
      const collected = doc ? await collectSearchText(doc, signal) : null;
      const page = context.pdf
        ? await context.pdfProvider!.pdfPageText(pageRequest)
        : null;
      checkAbort(signal);
      if (page && (page.fileHash !== fileHash || page.pageIndex !== index))
        throw new Error("The PDF text belongs to a different page or file.");
      const text = collected?.text ?? page?.text ?? "";
      if (text.trim()) pagesWithText++;
      for await (const matches of worker.search({
        key: `${fileHash}:${index}`,
        text,
        query: request.query,
        options: request.options,
        language: safeLocale(info.language),
        limit: SEARCH_HIT_LIMIT - count,
      })) {
        checkAbort(signal);
        const hits: SearchHit[] = [];
        let budget = performance.now();
        for (const { start, end } of matches) {
          checkAbort(signal);
          const range = collected?.range(start, end);
          const progress = range ? view.getProgressOf(index, range) : null;
          const ratio = start / Math.max(1, text.length);
          const bounds = info.sections[index];
          const total = bounds?.linear
            ? bounds.start + ratio * (bounds.end - bounds.start)
            : (context.current?.totalProgression ?? 0);
          const locator: DurtalLocator | null = context.pdf
            ? await context.pdfProvider!.locatorForPdfTextOffsets({
                ...pageRequest,
                start,
                end,
              })
            : {
                v: 1,
                fileHash,
                href: String(section.id),
                sectionIndex: index,
                progression: ratio,
                totalProgression: total,
                position: Math.min(
                  info.locationCount,
                  Math.floor((total * info.linearSize) / 1500) + 1,
                ),
                cfi: view.getCFI(index, range!),
                text: {
                  before: text.slice(Math.max(0, start - 32), start),
                  highlight: text.slice(start, end),
                  after: text.slice(end, end + 32),
                },
                pageLabel: progress?.pageItem?.label,
                tocLabel: progress?.tocItem?.label,
              };
          checkAbort(signal);
          if (
            !locator ||
            locator.fileHash !== fileHash ||
            locator.sectionIndex !== index
          )
            throw new Error(
              "The PDF match could not be measured. Try another page or query.",
            );
          const parent =
            range?.startContainer.nodeType === 1
              ? (range.startContainer as Element)
              : range?.startContainer.parentElement;
          const note =
            parent?.closest(NOTE_SELECTOR) ??
            (bounds?.linear === false
              ? parent?.closest("li[id], .note[id], p[id]")
              : null);
          const noteHref = note?.id
            ? `${String(section.id)}#${encodeURIComponent(note.id)}`
            : undefined;
          hits.push({
            id: `${index}:${start}:${end}`,
            start,
            end,
            locator,
            sectionLabel:
              locator.tocLabel ||
              (page?.pageLabel && `Page ${page.pageLabel}`) ||
              bounds?.label ||
              `Section ${index + 1}`,
            linear: bounds?.linear ?? true,
            noteHref,
            inNote:
              !!parent?.closest(NOTE_SELECTOR) || bounds?.linear === false,
            excerpt: searchExcerpt(text, start, end),
          });
          count++;
          if (performance.now() - budget >= 8) {
            await yieldReaderTask(signal);
            budget = performance.now();
          }
        }
        checkAbort(signal);
        yield { kind: "hits", hits };
        checkAbort(signal);
        if (count === SEARCH_HIT_LIMIT) {
          yield { kind: "complete", count, capped: true };
          return;
        }
      }
      checkAbort(signal);
      if (
        !context.pdf ||
        (completed + 1) % 10 === 0 ||
        completed + 1 === book.sections.length
      )
        yield {
          kind: "progress",
          completed: completed + 1,
          total: book.sections.length,
        };
    }
    checkAbort(signal);
    if (context.pdf && !pagesWithText) context.noPdfText();
    yield { kind: "complete", count, capped: false };
  } finally {
    worker.close();
  }
}
