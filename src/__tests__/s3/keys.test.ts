import { describe, it, expect } from "vitest";
import {
  bronzeImportKey,
  bronzeCoverKey,
  bronzeUploadKey,
  bronzeMediaKey,
  silverImportParsedKey,
  silverImportConflictsKey,
  silverImportErrorsKey,
  silverCoverKey,
  goldCoverKey,
  goldThumbnailKey,
  goldExportKey,
  goldMediaKey,
  goldMediaThumbnailKey,
  goldMediaOriginalKey,
  goldCommentAttachmentKey,
} from "@/lib/s3/keys";

// ── Bronze keys ──────────────────────────────────────────────────────────────

describe("bronze keys", () => {
  it("generates import key", () => {
    expect(bronzeImportKey("abc-123", "data.csv")).toBe("bronze/imports/abc-123/data.csv");
  });

  it("generates cover key with extension", () => {
    expect(bronzeCoverKey("ed-id", "jpg")).toBe("bronze/covers/ed-id/original.jpg");
  });

  it("generates upload key", () => {
    expect(bronzeUploadKey("upload-id", "photo.png")).toBe("bronze/uploads/upload-id/photo.png");
  });

  it("generates media upload key", () => {
    expect(bronzeMediaKey("work", "w-id", "f-id", "jpg")).toBe("bronze/media/work/w-id/f-id.jpg");
  });
});

// ── Silver keys ──────────────────────────────────────────────────────────────

describe("silver keys", () => {
  it("generates parsed key", () => {
    expect(silverImportParsedKey("imp-id")).toBe("silver/imports/imp-id/parsed.json");
  });

  it("generates conflicts key", () => {
    expect(silverImportConflictsKey("imp-id")).toBe("silver/imports/imp-id/conflicts.json");
  });

  it("generates errors key", () => {
    expect(silverImportErrorsKey("imp-id")).toBe("silver/imports/imp-id/errors.json");
  });

  it("generates validated cover key", () => {
    expect(silverCoverKey("ed-id", "png")).toBe("silver/covers/ed-id/validated.png");
  });
});

// ── Gold keys ────────────────────────────────────────────────────────────────

describe("gold keys", () => {
  it("generates cover key", () => {
    expect(goldCoverKey("ed-id")).toBe("gold/covers/ed-id/cover.webp");
  });

  it("generates thumbnail key", () => {
    expect(goldThumbnailKey("ed-id")).toBe("gold/covers/ed-id/thumb.webp");
  });

  it("generates export key", () => {
    expect(goldExportKey("exp-id")).toBe("gold/exports/exp-id/library_export.csv");
  });
});

// ── Media keys ───────────────────────────────────────────────────────────────

describe("gold media keys", () => {
  it("generates work media key", () => {
    expect(goldMediaKey("work", "w-id", "poster", "f-id")).toBe(
      "gold/media/work/w-id/poster/f-id.webp",
    );
  });

  it("generates author media key", () => {
    expect(goldMediaKey("author", "a-id", "background", "f-id")).toBe(
      "gold/media/author/a-id/background/f-id.webp",
    );
  });

  it("generates collection media key", () => {
    expect(goldMediaKey("collection", "c-id", "gallery", "f-id")).toBe(
      "gold/media/collection/c-id/gallery/f-id.webp",
    );
  });

  it("generates thumbnail key", () => {
    expect(goldMediaThumbnailKey("work", "w-id", "poster", "f-id")).toBe(
      "gold/media/work/w-id/poster/f-id_thumb.webp",
    );
  });

  it("generates original key", () => {
    expect(goldMediaOriginalKey("author", "a-id", "poster", "f-id")).toBe(
      "gold/media/author/a-id/poster/f-id_original.webp",
    );
  });
});

// ── Comment attachment keys ──────────────────────────────────────────────────

describe("comment attachment keys", () => {
  it("generates correct path", () => {
    expect(goldCommentAttachmentKey("work", "w-id", "c-id", "f-id", "png")).toBe(
      "gold/comments/work/w-id/c-id/f-id.png",
    );
  });
});

// ── Key format invariants ────────────────────────────────────────────────────

describe("key format invariants", () => {
  const allKeys = [
    bronzeImportKey("a", "b"),
    bronzeCoverKey("a", "jpg"),
    bronzeUploadKey("a", "b"),
    silverImportParsedKey("a"),
    silverImportConflictsKey("a"),
    silverImportErrorsKey("a"),
    goldCoverKey("a"),
    goldThumbnailKey("a"),
    goldExportKey("a"),
    goldMediaKey("work", "a", "poster", "b"),
    goldMediaThumbnailKey("work", "a", "poster", "b"),
    goldMediaOriginalKey("author", "a", "poster", "b"),
    goldCommentAttachmentKey("work", "a", "b", "c", "png"),
  ];

  it("no key starts with /", () => {
    for (const key of allKeys) {
      expect(key.startsWith("/")).toBe(false);
    }
  });

  it("no key contains double slashes", () => {
    for (const key of allKeys) {
      expect(key).not.toContain("//");
    }
  });

  it("all keys start with bronze/, silver/, or gold/", () => {
    for (const key of allKeys) {
      expect(key).toMatch(/^(bronze|silver|gold)\//);
    }
  });
});
