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
  evidenceRawKey,
  evidenceTextKey,
  goldCoverStageKeys,
  editionMediaPrefix,
  isEditionCoverKey,
  MEDIA_ENTITY_TYPES,
} from "@/lib/s3/keys";
import { ownedPrefixes } from "@/lib/s3/cleanup";
import { coverKeySha256, parseStageKey } from "@/lib/ebooks/keys";

// ── Evidence keys (SLN-468) ─────────────────────────────────────────────────

describe("evidence keys", () => {
  it("names a page and a text by their content hash, under the private prefix", () => {
    const hash = "a".repeat(64);
    expect(evidenceRawKey(hash)).toBe(`bronze/evidence/${hash}.raw.gz`);
    expect(evidenceTextKey(hash)).toBe(`bronze/evidence/${hash}.txt`);
  });
});

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

// ── Edition covers (SLN-643) ────────────────────────────────────────────────

describe("edition cover keys", () => {
  const edition = "6f1c2b9e-3a4d-4e5f-8a7b-9c0d1e2f3a4b";
  const attempt = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

  it("puts a new attempt in the edition's own gold/media folder, fresh for each attempt", () => {
    expect(goldCoverStageKeys(edition, attempt)).toEqual({
      coverKey: `gold/media/edition/${edition}/cover/attempt-${attempt}/cover.webp`,
      thumbnailKey: `gold/media/edition/${edition}/cover/attempt-${attempt}/thumb.webp`,
    });
    expect(goldCoverStageKeys(edition, "other").coverKey).not.toBe(goldCoverStageKeys(edition, attempt).coverKey);
    expect(editionMediaPrefix(edition)).toBe(`gold/media/edition/${edition}/`);
  });

  it("refuses an identity that could leave the folder or name another", () => {
    for (const bad of ["", "a/b", "..", "a b", "a_b", "x".repeat(129)]) {
      expect(() => goldCoverStageKeys(bad, attempt)).toThrow("Invalid cover stage identity");
      expect(() => goldCoverStageKeys(edition, bad)).toThrow("Invalid cover stage identity");
      expect(() => editionMediaPrefix(bad)).toThrow("Invalid cover stage identity");
    }
  });

  it("recognises new and every legacy cover, and nothing else", () => {
    const covers = [
      goldCoverKey(edition),
      goldThumbnailKey(edition),
      `gold/covers/${edition}/attempt-${attempt}/thumb.webp`,
      goldCoverStageKeys(edition, attempt).coverKey,
      goldCoverStageKeys(edition, attempt).thumbnailKey,
      // Anything in an edition's folder is retained, even a shape no writer makes
      `gold/media/edition/${edition}/cover.webp`,
      `gold/media/edition/${edition}/../work/x.webp`,
    ];
    for (const key of covers) expect(isEditionCoverKey(key), key).toBe(true);
    const others = [
      goldMediaKey("work", edition, "poster", "f"),
      goldMediaThumbnailKey("author", edition, "photo", "f"),
      `gold/media/editions/${edition}/cover/attempt-${attempt}/cover.webp`,
      `gold/media/work/edition/${edition}/cover.webp`,
      `gold/ebooks/epub/aa/${"a".repeat(64)}/cover-400.webp`,
      `derived/${"a".repeat(64)}/cover-400.webp`,
      bronzeCoverKey(edition, "jpg"),
      silverCoverKey(edition, "png"),
      goldCommentAttachmentKey("work", edition, "c", "f", "pdf"),
      `/gold/covers/${edition}/cover.webp`,
      "gold/mediaedition/x",
    ];
    for (const key of others) expect(isEditionCoverKey(key), key).toBe(false);
  });

  it("keeps the edition folder apart from every image owner's", () => {
    expect(MEDIA_ENTITY_TYPES).not.toContain("edition");
    expect(ownedPrefixes.edition(edition)).toEqual([
      `gold/media/edition/${edition}/`,
      `gold/covers/${edition}/`,
      `silver/covers/${edition}/`,
      `bronze/covers/${edition}/`,
    ]);
    for (const type of MEDIA_ENTITY_TYPES)
      for (const prefix of ownedPrefixes[type](edition))
        expect(prefix.startsWith("gold/media/edition/")).toBe(false);
  });

  it("is not an e-book delivery key", () => {
    const { coverKey } = goldCoverStageKeys(edition, attempt);
    expect(coverKeySha256(coverKey)).toBeNull();
    expect(parseStageKey(coverKey)).toBeNull();
  });
});
