import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactNode } from "react";

const store = vi.hoisted(() => ({
  book: vi.fn(),
  plugins: vi.fn(),
  view: vi.fn(),
  exists: vi.fn(async (id: string) => id === "11111111-1111-1111-1111-111111111111"),
  device: "33333333-3333-4333-8333-333333333333" as string | undefined,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "durtal-device" && store.device ? { name, value: store.device } : undefined }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/lib/ebooks/delivery/reader-book", () => ({
  readReaderBook: store.book,
}));
vi.mock("@/lib/ebooks/delivery/url", () => ({ fileUrlFor: vi.fn() }));
vi.mock("@/lib/catalogue/record-exists", () => ({ ebookExists: store.exists }));
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
import { DeviceHandshake } from "@/components/reader/device-handshake";
import { readerEntryHref } from "@/lib/reader/entry-policy";

const ebookId = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  store.device = "33333333-3333-4333-8333-333333333333";
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
      deviceId: store.device,
      fileId,
      fromDeviceId: null,
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

describe("a browser with no device id yet (SLN-668)", () => {
  it("gets one before the book loads, keeping the way back", async () => {
    store.device = undefined;
    const tree = await ReaderPage({
      params: Promise.resolve({ ebookId }),
      searchParams: Promise.resolve({ returnTo: "/series/surrealism" }),
    });
    const parts = isValidElement<{ children: ReactNode }>(tree) ? Children.toArray(tree.props.children) : [];
    const handshake = parts.find((part) => isValidElement(part) && part.type === DeviceHandshake);
    expect(isValidElement<{ ebookId: string; backHref: string }>(handshake) && handshake.props).toEqual({ ebookId, backHref: "/series/surrealism" });
    // An Escape before the page's code runs is kept for the handshake (SLN-811)
    expect(parts.some((part) => isValidElement<{ dangerouslySetInnerHTML?: { __html: string } }>(part)
      && part.type === "script" && part.props.dangerouslySetInnerHTML?.__html.includes("__durtalEarlyEscape"))).toBe(true);
    expect(store.book).not.toHaveBeenCalled();
    expect(store.plugins).not.toHaveBeenCalled();
  });

  it("is a 404 for an eBook that does not exist, before anything streams (SLN-933)", async () => {
    store.device = undefined;
    await expect(ReaderPage({
      params: Promise.resolve({ ebookId: "44444444-4444-4444-8444-444444444444" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    expect(store.book).not.toHaveBeenCalled();
  });
});
