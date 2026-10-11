import { afterEach, describe, expect, it, vi } from "vitest";
import { publicationFixture } from "./publication-fixture";
import { ebookDerivedFolder, ebookFileKey } from "@/lib/ebooks/keys";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: { ebooks: { findFirst: mocks.findFirst } } } }));
import { readCatalogueCover, type CatalogueCover } from "@/lib/ebooks/delivery/files";
import { coverUrlFor } from "@/lib/ebooks/delivery/url";

afterEach(() => { vi.unstubAllEnvs(); mocks.findFirst.mockReset(); });
describe("fresh catalogue cover evidence", () => {
  it("carries only recorded gold widths into the actual delivery caller", async () => {
    vi.stubEnv("EBOOK_DELIVERY", "app");
    const file = { ...publicationFixture(), id: "file", coverKey: null };
    mocks.findFirst.mockResolvedValue({ id: "book", preferredFileId: file.id, coverKey: null, files: [file] });
    const cover = await readCatalogueCover("book");
    expect(cover?.widths).toEqual([240]);
    const brands = Object.getOwnPropertySymbols(cover!);
    expect(brands).toHaveLength(1);
    expect(Reflect.get(cover!, brands[0])).toBe(true);
    expect(coverUrlFor(cover!, 240)).toEqual({ url: "/api/reader/book/cover?w=240", expiresAt: null });
    expect(coverUrlFor(cover!, 400)).toBeNull();
    expect(coverUrlFor(cover!, 800)).toBeNull();
    // Download-ready and native-readable remain distinct capabilities.
    file.metadata.medallion.validation.nativeReadable = false;
    expect((await readCatalogueCover("book"))?.widths).toEqual([240]);
  });
  it("refuses stale, protected and malformed publication evidence", async () => {
    for (const file of [
      { ...publicationFixture(), status: "replaced" },
      { ...publicationFixture(), drm: "adobe-adept" },
      { ...publicationFixture(), metadata: { medallion: null } },
    ]) {
      mocks.findFirst.mockResolvedValue({ id: "book", preferredFileId: "file", coverKey: null,
        files: [{ ...file, id: "file", coverKey: null }] });
      const cover = await readCatalogueCover("book");
      expect(cover).toMatchObject({ sha256: null });
      const brands = Object.getOwnPropertySymbols(cover!);
      expect(brands).toHaveLength(1);
      expect(Reflect.get(cover!, brands[0])).toBe(true);
      expect(coverUrlFor(cover!, 240)).toBeNull();
    }
  });
  it("keeps plain objects outside the catalogue capability type", () => {
    // This becomes a compiler error if the private required brand is weakened.
    const plainObjectIsCatalogueCover:
      { ebookId: string; sha256: string | null } extends CatalogueCover ? true : false = false;
    expect(plainObjectIsCatalogueCover).toBe(false);
  });
  it("does not issue a cover capability for a missing catalogue row", async () => {
    mocks.findFirst.mockResolvedValue(undefined);
    expect(await readCatalogueCover("book")).toBeNull();
  });
  it("brands a fresh legacy cover without relaxing gold publication evidence", async () => {
    vi.stubEnv("EBOOK_DELIVERY", "app");
    const published = publicationFixture();
    const file = { ...published, id: "file", coverKey: null, metadata: {},
      s3Key: ebookFileKey(published.sha256, published.format), manifestKey: null };
    const legacyKey = `${ebookDerivedFolder(file.sha256)}cover-800.webp`;
    mocks.findFirst.mockResolvedValue({ id: "book", preferredFileId: file.id, coverKey: legacyKey, files: [file] });
    const cover = await readCatalogueCover("book");
    expect(cover).toMatchObject({ sha256: file.sha256, key: legacyKey, widths: [] });
    const brands = Object.getOwnPropertySymbols(cover!);
    expect(brands).toHaveLength(1);
    expect(Reflect.get(cover!, brands[0])).toBe(true);
    expect(coverUrlFor(cover!, 240)).toEqual({ url: "/api/reader/book/cover?w=240", expiresAt: null });
  });
});
