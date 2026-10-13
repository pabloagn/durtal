// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EbookMarksExport } from "@/components/ebooks/ebook-marks-export";
import { annotation, at, id } from "../reader/fixtures/annotation";

// Export on the e-book page (SLN-500): the marks are fetched when asked for,
// then saved as the reader's panel saves them.

const book = { id: id(2), title: "Là-bas", authors: ["J.-K. Huysmans"] };
const saved: { name: string; blob: Blob }[] = [];
let root: Root;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  saved.length = 0;
  let blob: Blob | null = null;
  URL.createObjectURL = vi.fn((value: Blob) => {
    blob = value;
    return "blob:export";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blob! });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pull = (annotations: unknown[]) => ({ annotations, serverTime: at, reset: true });
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((item) => item.textContent === label)!;

describe("EbookMarksExport", () => {
  it("fetches the book's marks only when asked, then saves Markdown and W3C files", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(pull([annotation()]))));
    vi.stubGlobal("fetch", fetchMock);
    act(() => root.render(createElement(EbookMarksExport, { book })));
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => button("Export Markdown").click());
    expect(fetchMock).toHaveBeenCalledWith(`/api/reader/${book.id}/annotations`, { cache: "no-store" });
    expect(saved.map((item) => item.name)).toEqual(["Là-bas.md"]);
    const markdown = await saved[0].blob.text();
    expect(markdown).toContain("# Là-bas");
    expect(markdown).toContain("> The quiet glass.");
    expect(markdown).toContain("My thought");

    await act(async () => button("Export annotations").click());
    expect(saved[1].name).toBe("Là-bas.annotations.json");
    expect(JSON.parse(await saved[1].blob.text())).toMatchObject({ type: "AnnotationPage" });
  });

  it("says so when the marks cannot be loaded, and saves nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    act(() => root.render(createElement(EbookMarksExport, { book })));
    await act(async () => button("Export Markdown").click());
    expect(saved).toEqual([]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Could not load the marks. Try again.");
    expect(button("Export Markdown").disabled).toBe(false);
  });
});
