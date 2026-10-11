// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { searchBook } from "@/lib/reader/engines/foliate/search";
import type {
  FoliateBook,
  FoliateView,
} from "@/lib/reader/engines/foliate/foliate";
import { DEFAULT_SEARCH_OPTIONS, findInText } from "@/lib/reader/search/fold";
import type { BookInfo } from "@/lib/reader/engine";
import type { createSearchWorker } from "@/lib/reader/search/worker-client";
import { collectSearchText } from "@/lib/reader/search/document";
import {
  readSearchOptions,
  writeSearchOptions,
} from "@/lib/reader/search/preferences";

function fixture(markup: string[]) {
  const acquired: number[] = [];
  const book = {
    sections: markup.map((html, index) => ({
      id: `s${index}.xhtml`,
      size: html.length,
      linear: index === 1 ? "no" : "yes",
      createDocument: async () => {
        acquired.push(index);
        const doc = document.implementation.createHTMLDocument();
        doc.body.innerHTML = html;
        return doc;
      },
    })),
  } as unknown as FoliateBook;
  const info: BookInfo = {
    title: "Book",
    authors: [],
    language: "fr",
    dir: "ltr",
    layout: "reflowable",
    toc: [],
    pageList: [],
    linearSize: 4500,
    locationCount: 3,
    capabilities: { search: true, tts: true, spreads: true, scrolled: true },
    sections: markup.map((_, index) => ({
      href: `s${index}.xhtml`,
      label: `Chapter ${index + 1}`,
      linear: index !== 1,
      start: index / 3,
      end: (index + 1) / 3,
    })),
  };
  const view = {
    getCFI: (index: number, range: Range) =>
      `epubcfi(${index}:${range.toString()})`,
    getProgressOf: () => ({
      pageItem: { label: "xii" },
      tocItem: { label: "A chapter" },
    }),
  } as unknown as FoliateView;
  const close = vi.fn();
  const worker = (() => ({
    close,
    async *search(
      request: Parameters<ReturnType<typeof createSearchWorker>["search"]>[0],
    ) {
      yield [
        ...findInText(
          request.text,
          request.query,
          request.options,
          request.language,
          undefined,
          request.limit,
        ),
      ];
    },
  })) as typeof createSearchWorker;
  return {
    context: {
      book,
      info,
      view,
      fileHash: "a".repeat(64),
      pdf: false,
      current: null,
      noPdfText: vi.fn(),
      worker,
    },
    acquired,
    close,
  };
}
describe("bounded search acquisition and locators", () => {
  it("searches current-to-end then wraps, including nonlinear notes, and preserves pristine UTF-16 offsets", async () => {
    const f = fixture([
      "<p>avant là-bas après</p>",
      '<aside epub:type="footnote">là-bas note</aside>',
      "<p><b>LÀ</b>-BAS fin</p><script>là-bas</script>",
    ]);
    const updates = [];
    for await (const update of searchBook(f.context, {
      query: "la-bas",
      options: { ...DEFAULT_SEARCH_OPTIONS },
      signal: new AbortController().signal,
      startSection: 2,
    }))
      updates.push(update);
    expect(f.acquired).toEqual([2, 0, 1]);
    const hits = updates.flatMap((update) =>
      update.kind === "hits" ? update.hits : [],
    );
    expect(hits.map((hit) => hit.locator.sectionIndex)).toEqual([2, 0, 1]);
    expect(hits[0].locator.text?.highlight).toBe("LÀ-BAS");
    expect(hits[1].start).toBe(6);
    expect(hits[1].locator.pageLabel).toBe("xii");
    expect(hits[2].inNote).toBe(true);
    expect(hits[2].linear).toBe(false);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("does not acquire the next section after aborting a yielded batch", async () => {
    const f = fixture(["<p>text</p>", "<p>text</p>"]);
    const abort = new AbortController();
    const iterator = searchBook(f.context, {
      query: "text",
      options: { ...DEFAULT_SEARCH_OPTIONS },
      signal: abort.signal,
    });
    expect((await iterator.next()).value?.kind).toBe("hits");
    abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(f.acquired).toEqual([0]);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("stops at 5,000 hits and never eagerly fetches the following section", async () => {
    const f = fixture([`<p>${"text ".repeat(5100)}</p>`, "<p>text</p>"]);
    const updates = [];
    for await (const update of searchBook(f.context, {
      query: "text",
      options: { ...DEFAULT_SEARCH_OPTIONS },
      signal: new AbortController().signal,
    }))
      updates.push(update);
    expect(updates.at(-1)).toEqual({
      kind: "complete",
      count: 5000,
      capped: true,
    });
    expect(f.acquired).toEqual([0]);
  });
  it("surfaces missing PDF measurement instead of reporting no matches", async () => {
    const f = fixture(["<p>text</p>"]);
    const iterator = searchBook(
      { ...f.context, pdf: true },
      {
        query: "text",
        options: { ...DEFAULT_SEARCH_OPTIONS },
        signal: new AbortController().signal,
      },
    );
    await expect(iterator.next()).rejects.toThrow("measured page text");
    expect(f.acquired).toEqual([]);
  });
  it("keeps search available after five empty PDF pages when later pages have measured text", async () => {
    const f = fixture(Array.from({ length: 6 }, () => ""));
    const pdfProvider = {
      pdfPageText: vi.fn(
        async ({
          fileHash,
          pageIndex,
        }: {
          fileHash: string;
          pageIndex: number;
        }) => ({
          fileHash,
          pageIndex,
          pageLabel: String(pageIndex + 1),
          text: pageIndex === 5 ? "text" : "",
        }),
      ),
      locatorForPdfTextOffsets: vi.fn(
        async ({
          fileHash,
          pageIndex,
        }: {
          fileHash: string;
          pageIndex: number;
        }) => ({
          v: 1 as const,
          fileHash,
          href: String(pageIndex),
          sectionIndex: pageIndex,
          progression: 0,
          totalProgression: pageIndex / 6,
          pdf: {
            page: pageIndex + 1,
            rects: [[10, 20, 30, 40] as [number, number, number, number]],
          },
        }),
      ),
    };
    const updates = [];
    for await (const update of searchBook(
      { ...f.context, pdf: true, pdfProvider },
      {
        query: "text",
        options: { ...DEFAULT_SEARCH_OPTIONS },
        signal: new AbortController().signal,
      },
    ))
      updates.push(update);
    expect(pdfProvider.pdfPageText).toHaveBeenCalledTimes(6);
    expect(f.context.noPdfText).not.toHaveBeenCalled();
    const hits = updates.flatMap((update) =>
      update.kind === "hits" ? update.hits : [],
    );
    expect(hits[0].locator.pdf?.rects).toEqual([[10, 20, 30, 40]]);
    expect(pdfProvider.locatorForPdfTextOffsets).toHaveBeenCalledWith(
      expect.objectContaining({ pageIndex: 5, start: 0, end: 4 }),
    );
  });
  it("disables PDF search only after all pages are empty and reports absent match geometry", async () => {
    const f = fixture(["", ""]);
    const request = {
      query: "text",
      options: { ...DEFAULT_SEARCH_OPTIONS },
      signal: new AbortController().signal,
    };
    const pdfProvider = {
      pdfPageText: async ({
        fileHash,
        pageIndex,
      }: {
        fileHash: string;
        pageIndex: number;
      }) => ({ fileHash, pageIndex, pageLabel: "1", text: "" }),
      locatorForPdfTextOffsets: async () => null,
    };
    for await (const _update of searchBook(
      { ...f.context, pdf: true, pdfProvider },
      request,
    )) {
      /* consume to completion */
    }
    expect(f.context.noPdfText).toHaveBeenCalledTimes(1);
    const textProvider = {
      ...pdfProvider,
      pdfPageText: async ({
        fileHash,
        pageIndex,
      }: {
        fileHash: string;
        pageIndex: number;
      }) => ({ fileHash, pageIndex, pageLabel: "1", text: "text" }),
    };
    await expect(
      searchBook(
        { ...f.context, pdf: true, pdfProvider: textProvider },
        request,
      ).next(),
    ).rejects.toThrow("could not be measured");
  });
  it("maps across text nodes and rejects executable subtrees without indexing injected controls", async () => {
    const doc = document;
    doc.body.innerHTML =
      "<p>Là<b>-bas</b></p><script>evil</script><style>evil</style><button data-reader-chrome>View table</button>";
    const result = await collectSearchText(doc, new AbortController().signal);
    expect(result.text).toBe("Là-bas");
    const range = result.range(1, 5);
    expect(range.startContainer.nodeValue).toBe("Là");
    expect(range.startOffset).toBe(1);
    expect(range.endContainer.nodeValue).toBe("-bas");
    expect(range.endOffset).toBe(3);
  });
  it("guards versioned preferences and storage failures", () => {
    expect(
      readSearchOptions({ getItem: () => '{"v":2,"wholeWords":true}' }),
    ).toEqual(DEFAULT_SEARCH_OPTIONS);
    expect(
      readSearchOptions({
        getItem: () => {
          throw Error("blocked");
        },
      }),
    ).toEqual(DEFAULT_SEARCH_OPTIONS);
    const setItem = vi.fn();
    writeSearchOptions(
      { setItem },
      { wholeWords: true, matchAccents: false, matchCase: true },
    );
    expect(
      readSearchOptions({ getItem: () => setItem.mock.calls[0][1] }),
    ).toEqual({ wholeWords: true, matchAccents: false, matchCase: true });
  });
});
