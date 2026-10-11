import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";

const store = vi.hoisted(() => ({
  book: vi.fn(),
  plugins: vi.fn(),
  view: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/lib/ebooks/delivery/reader-book", () => ({
  readReaderBook: store.book,
}));
vi.mock("@/lib/ebooks/delivery/url", () => ({ fileUrlFor: vi.fn() }));
vi.mock("@/lib/ebooks/preferences", () => ({
  getReaderPreferences: async () => ({ ok: true, rows: [] }),
}));
vi.mock("@/lib/reader/runtime-loader", () => ({
  loadReaderRuntime: async () => ({ status: "unavailable", code: "reader_runtime_unavailable" }),
}));
vi.mock("@/app/reader/[ebookId]/plugins", () => ({
  loadReaderPlugins: store.plugins,
  getRequiredReaderControllerIds: () => [],
}));
vi.mock("@/app/reader/[ebookId]/reader-view", () => ({
  ReaderView: store.view,
}));

import ReaderPage from "@/app/reader/[ebookId]/page";
import { readerEntryHref } from "@/lib/reader/entry-policy";

const ebookId = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  store.book.mockResolvedValue({
    id: ebookId,
    title: "Nadja",
    authors: [],
    language: "en",
    editionLanguage: "fr",
    workSlug: "nadja",
    files: [],
    file: null,
    place: null,
  });
  store.plugins.mockResolvedValue([]);
});

async function viewProps(returnTo: string | string[] | undefined) {
  const tree = await ReaderPage({
    params: Promise.resolve({ ebookId }),
    searchParams: Promise.resolve({ file: fileId, returnTo }),
  });
  // The reader providers remain in the actual page tree. Inspect the Back
  // prop without executing the client view or its runtime providers.
  type ViewProps = { backHref: string; ebook: { language: string; editionLanguage: string } };
  function findView(node: ReactNode): ViewProps | null {
    for (const child of Children.toArray(node)) {
      if (!isValidElement<{ children?: ReactNode; backHref?: string }>(child)) continue;
      if (child.type === store.view) return child.props as ViewProps;
      const found = findView(child.props.children);
      if (found) return found;
    }
    return null;
  }
  const props = findView(tree);
  expect(props).not.toBeNull();
  return props!;
}

describe("full reader navigation return contract", () => {
  it("round trips the file and catalogue filters/anchor into the actual reader Back prop", async () => {
    const destination = "/series/surrealism?view=list#books";
    const href = readerEntryHref(
      `/reader/${ebookId}?file=${fileId}`,
      destination,
    )!;
    const url = new URL(href, "http://localhost");
    expect(url.searchParams.get("file")).toBe(fileId);
    const props = await viewProps(url.searchParams.get("returnTo")!);
    expect(props.backHref).toBe(destination);
    expect(props.ebook).toMatchObject({ language: "en", editionLanguage: "fr" });
    expect(store.book).toHaveBeenCalledExactlyOnceWith(ebookId, {
      deviceId: null,
      fileId,
    });
  });

  it.each([
    undefined,
    ["/series/one", "/series/two"],
    "//evil.example",
    "https://evil.example/library",
    "/api/ebooks",
  ])(
    "uses the reader eBook detail fallback for invalid or absent return input",
    async (returnTo) => {
      expect((await viewProps(returnTo)).backHref).toBe(`/ebooks/${ebookId}`);
      expect(store.book).toHaveBeenCalledOnce();
    },
  );
});
