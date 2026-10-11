// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createNotes } from "@/lib/reader/engines/foliate/notes";
import type { FoliateBook } from "@/lib/reader/engines/foliate/foliate";
import type { ReaderNote } from "@/lib/reader/engine";

function fixture(markup: string, linear = "no") {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = markup;
  const publish = vi.fn<(note: ReaderNote | null) => void>();
  const createDocument = vi.fn(async () => doc);
  const book = {
    sections: [
      {
        id: "notes.xhtml",
        linear,
        size: markup.length,
        createDocument,
        resolveHref: (href: string) => `notes.xhtml${href}`,
      },
    ],
    resolveHref: (href: string) => ({
      index: 0,
      anchor: (document: Document) =>
        document.getElementById(href.split("#")[1])!,
    }),
  } as unknown as FoliateBook;
  const notes = createNotes({ book, document, publish });
  return { notes, doc, publish, createDocument };
}
function reference(attributes = 'role="doc-noteref"') {
  const a = document.createElement("a");
  a.setAttribute("href", "notes.xhtml#one");
  for (const match of attributes.matchAll(/([\w:-]+)="([^"]*)"/g))
    a.setAttribute(match[1], match[2]);
  document.body.append(a);
  return a;
}
describe("pristine footnote extraction", () => {
  it("clones a long semantic note, strips script/backlink probes and leaves the source untouched", async () => {
    const f = fixture(
      `<aside id="one" epub:type="footnote"><p>${"note ".repeat(400)}</p><script>evil()</script><a role="doc-backlink">Back</a></aside>`,
    );
    const before = f.doc.body.innerHTML;
    expect(
      await f.notes.open("notes.xhtml#one", {
        reference: reference(),
        keyboard: true,
      }),
    ).toBe(true);
    const note = f.publish.mock.calls.at(-1)?.[0];
    expect(note?.kind).toBe("Footnote");
    expect(note?.content.textContent?.length).toBeGreaterThan(1500);
    expect(note?.content.querySelector("script, a")).toBeNull();
    expect(f.doc.body.innerHTML).toBe(before);
    f.notes.destroy();
  });
  it("rejects a long untyped heuristic note and excludes semantic backlinks", async () => {
    const f = fixture(`<p id="one"><a>1</a>${"x".repeat(1501)}</p>`);
    expect(
      await f.notes.open("notes.xhtml#one", { reference: reference("") }),
    ).toBe(false);
    expect(
      await f.notes.open("notes.xhtml#one", {
        reference: reference('role="doc-noteref doc-backlink"'),
      }),
    ).toBe(false);
    expect(f.publish).not.toHaveBeenCalled();
    f.notes.destroy();
  });
  it("replaces nested notes while reusing a cached pristine document", async () => {
    const f = fixture(
      '<aside id="one" epub:type="footnote">One <a role="doc-noteref" href="#two">2</a></aside><aside id="two" epub:type="endnote">Two</aside>',
    );
    await f.notes.open("notes.xhtml#one", { reference: reference() });
    const first = f.publish.mock.calls[0][0]!;
    expect(first.content.querySelector("a")?.getAttribute("href")).toBe(
      "notes.xhtml#two",
    );
    await f.notes.open("notes.xhtml#two", { reference: reference() });
    expect(f.publish.mock.calls[1][0]?.kind).toBe("Endnote");
    expect(f.createDocument).toHaveBeenCalledTimes(1);
    f.notes.close();
    expect(f.publish).toHaveBeenLastCalledWith(null);
  });
  it("records the first reference in book order without retaining source elements", async () => {
    const f = fixture('<aside id="one" epub:type="footnote">One</aside>');
    const book = {
      sections: [0, 1].map((index) => ({
        id: `s${index}.xhtml`,
        size: 10,
        resolveHref: () => "notes.xhtml#one",
      })),
    } as unknown as FoliateBook;
    const notes = createNotes({
      book,
      document,
      publish: vi.fn(),
      getCFI: (index) => `epubcfi(${index})`,
    });
    const doc = document.implementation.createHTMLDocument();
    const a = doc.createElement("a");
    a.setAttribute("href", "#one");
    a.textContent = "1";
    doc.body.append(a);
    await notes.remember(doc, 1, new AbortController().signal);
    await notes.remember(doc, 0, new AbortController().signal);
    expect(notes.reference("notes.xhtml#one")).toEqual({
      cfi: "epubcfi(0)",
      index: 0,
    });
    notes.destroy();
    f.notes.destroy();
  });
  it("does not publish or fall back to stale navigation after the popup acquisition is cancelled", async () => {
    const publish = vi.fn();
    let resolve!: (doc: Document) => void;
    const book = {
      sections: [
        {
          id: "notes.xhtml",
          size: 10,
          createDocument: () =>
            new Promise<Document>((done) => {
              resolve = done;
            }),
        },
      ],
      resolveHref: () => ({ index: 0, anchor: (doc: Document) => doc.body }),
    } as unknown as FoliateBook;
    const notes = createNotes({ book, document, publish });
    const opening = notes.open("notes.xhtml#one", { force: true });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    notes.close();
    const doc = document.implementation.createHTMLDocument();
    doc.body.textContent = "note";
    resolve(doc);
    expect(await opening).toBe(true);
    expect(publish.mock.calls).toEqual([[null]]);
    notes.destroy();
  });
});
