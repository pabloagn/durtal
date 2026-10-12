import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const store = vi.hoisted(() => ({ page: vi.fn(), counts: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ebooks/library-queries", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ebooks/library-queries")>(),
  getEbooksPage: store.page, getEbookLibraryCounts: store.counts, getEbookDetail: store.detail,
}));
import { GET as list } from "@/app/api/ebooks/route";
import { GET as detail } from "@/app/api/ebooks/[id]/route";
import { publicationFixture } from "./publication-fixture";
const id = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
const ebook = { id, title: "Nadja", subtitle: null, authors: ["André Breton"], language: "fr", matchState: "pending",
  preferredFileId: fileId, coverKey: "gold/private-cover", createdAt: "2026-10-10T08:00:00Z",
  files: [{ ...publicationFixture(), id: fileId, ebookId: id, createdAt: "2026-10-10T08:00:00Z",
    sourceHost: "private-host", sourcePath: "/private/source" }],
  isbns: [], identifiers: {}, positions: [], history: [], instanceId: null };
beforeEach(() => {
  vi.clearAllMocks(); store.page.mockResolvedValue([ebook]); store.counts.mockResolvedValue({ total: 1 });
  store.detail.mockResolvedValue(ebook);
});
describe("read-only eBook REST metadata", () => {
  it("uses the actual bounded library parser and omits publication state", async () => {
    const response = await list(new NextRequest("http://localhost/api/ebooks?q=Nadja&linked=unlinked&perPage=24&page=2"));
    expect(response.status).toBe(200);
    expect(store.page).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ q: "Nadja", linked: ["unlinked"], perPage: 24, page: 2, offset: 24 }));
    const body = await response.json();
    expect(body).toMatchObject({ total: 1, page: 2, perPage: 24, ebooks: [{ id, readable: true }] });
    expect(JSON.stringify(body)).not.toMatch(/gold\/|private|sourcePath|manifestKey|sha256|metadata|positions|history/);
  });
  it("rejects a malformed id before lookup and returns 404 for missing metadata", async () => {
    const request = new NextRequest("http://localhost/api/ebooks/missing");
    expect((await detail(request, { params: Promise.resolve({ id: "missing" }) })).status).toBe(400);
    expect(store.detail).not.toHaveBeenCalled();
    store.detail.mockResolvedValue(null);
    expect((await detail(request, { params: Promise.resolve({ id }) })).status).toBe(404);
    expect(store.detail).toHaveBeenCalledExactlyOnceWith(id);
  });
  it("keeps excluded details visible but provides no Read or download capability", async () => {
    store.detail.mockResolvedValue({ ...ebook, matchState: "excluded" });
    const response = await detail(new NextRequest(`http://localhost/api/ebooks/${id}`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, readable: false, readerPath: null, linkedCopy: null,
      files: [{ id: fileId, readable: false, downloadable: false }] });
  });
});
