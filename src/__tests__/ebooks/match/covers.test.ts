import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/catalogue/work-store";
import type { LoadedMatchCatalogue } from "@/lib/ebooks/match/load";
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Global database forbidden");
      },
    },
  ),
}));
const mocks = vi.hoisted(() => ({
  head: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/ebooks/storage", () => ({
  headEbookObject: mocks.head,
  getEbookObjectRange: mocks.get,
}));
vi.mock("@/lib/s3/covers", () => ({
  uploadToS3: mocks.put,
  deleteFromS3: mocks.remove,
}));
vi.mock("@/lib/color/extract-palette", () => ({
  extractColorPalette: async () => null,
}));
vi.mock("sharp", () => ({
  default: (bytes: Uint8Array) => {
    const pipeline = {
      rotate: () => pipeline,
      resize: () => pipeline,
      webp: () => pipeline,
      toBuffer: async () => Buffer.from(bytes),
    };
    return pipeline;
  },
}));
import {
  planCoverCopy,
  copyPlannedCover,
  discardUnusedCover,
} from "@/lib/ebooks/match/covers";
import { publicationFixture } from "../publication-fixture";
const bytes = Buffer.from("validated cover fixture");
const hash = createHash("sha256").update(bytes).digest("hex");
function source() {
  const file = publicationFixture(),
    cover = file.metadata.medallion.gold[1];
  cover.key = cover.key.replace("cover-240.webp", "cover-800.webp");
  cover.sha256 = hash;
  cover.size = bytes.length;
  const snapshot = {
    rows: {
      ebook_files: [
        {
          id: "file",
          ebook_id: "book",
          sha256: file.sha256,
          format: file.format,
          size_bytes: file.sizeBytes,
          s3_key: file.s3Key,
          status: file.status,
          drm: null,
          metadata: file.metadata,
          manifest_key: file.manifestKey,
          cover_key: cover.key,
        },
      ],
    },
  } as unknown as Pick<LoadedMatchCatalogue, "rows">;
  return { snapshot, key: cover.key };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.head.mockResolvedValue({
    size: bytes.length,
    sha256: hash,
    metadataSha256: hash,
  });
  mocks.get.mockImplementation(async () => ({
    length: bytes.length,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  }));
});
describe("validated ebook cover copy", () => {
  it("binds source checksum and allocates separate keys for repeated attempts", async () => {
    const s = source(),
      a = planCoverCopy(s.snapshot, "book", "edition", s.key)!,
      b = planCoverCopy(s.snapshot, "book", "edition", s.key)!;
    expect(a.sourceSha256).toBe(hash);
    expect(a.coverKey).not.toBe(b.coverKey);
    expect(await copyPlannedCover(a)).toMatchObject({
      coverKey: a.coverKey,
      thumbnailKey: a.thumbnailKey,
      palette: null,
    });
    expect(mocks.put.mock.calls.map((call) => call[0])).toEqual([
      a.coverKey,
      a.thumbnailKey,
    ]);
    expect(mocks.get).toHaveBeenCalledWith(s.key, 0, bytes.length - 1);
  });
  it("refuses another ebook, an unrecorded key and malformed publication evidence", () => {
    const s = source();
    expect(() => planCoverCopy(s.snapshot, "other", "edition", s.key)).toThrow(
      "validated ebook",
    );
    expect(() =>
      planCoverCopy(s.snapshot, "book", "edition", s.key.replace("800", "400")),
    ).toThrow("validated ebook");
    s.snapshot.rows.ebook_files[0].metadata = { medallion: { gold: [null] } };
    expect(() => planCoverCopy(s.snapshot, "book", "edition", s.key)).toThrow(
      "validated ebook",
    );
  });
  it.each(["checksum", "size", "bytes"] as const)(
    "refuses changed %s before any asset upload",
    async (kind) => {
      const s = source(),
        plan = planCoverCopy(s.snapshot, "book", "edition", s.key)!;
      if (kind === "checksum")
        mocks.head.mockResolvedValue({
          size: bytes.length,
          sha256: "a".repeat(64),
        });
      if (kind === "size")
        mocks.head.mockResolvedValue({ size: 21 * 1024 * 1024, sha256: hash });
      if (kind === "bytes")
        mocks.get.mockResolvedValue({
          length: bytes.length,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.alloc(bytes.length));
              controller.close();
            },
          }),
        });
      await expect(copyPlannedCover(plan)).rejects.toThrow();
      expect(mocks.put).not.toHaveBeenCalled();
    },
  );
  it("cleans only proven unused attempt assets and retains referenced/uncertain assets", async () => {
    const s = source(),
      plan = planCoverCopy(s.snapshot, "book", "edition", s.key)!;
    await discardUnusedCover(
      { execute: async () => [{ used: true }] } as unknown as Db,
      plan,
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    await discardUnusedCover(
      { execute: async () => [] } as unknown as Db,
      plan,
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    await discardUnusedCover(
      { execute: async () => [{ used: false }] } as unknown as Db,
      plan,
    );
    expect(mocks.remove.mock.calls.map((call) => call[0])).toEqual([
      plan.coverKey,
      plan.thumbnailKey,
    ]);
  });
});
