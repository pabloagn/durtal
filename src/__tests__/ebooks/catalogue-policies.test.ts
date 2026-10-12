import { describe, expect, it } from "vitest";
import {
  catalogueReadLabel,
  readTarget,
  type CatalogueContinue,
  type EbookAvailability,
} from "@/lib/ebooks/read-target";
import {
  catalogueContinueDTO,
  ebookExportFormats,
  workEbookDTO,
} from "@/lib/ebooks/catalogue-dto";
import { ebookPaletteGroup } from "@/lib/ebooks/palette-group";
import type { ContinueDescriptor } from "@/lib/ebooks/continue-target";

function descriptor(
  overrides: Partial<CatalogueContinue> = {},
): CatalogueContinue {
  return {
    target: { id: "new-file", ebookId: "ebook", sha256: "b".repeat(64) },
    href: "/reader/ebook?file=new-file",
    localAnchor: null,
    anchor: null,
    newestOtherAnchor: null,
    savedPercent: null,
    projection: "none",
    targetPercent: null,
    ...overrides,
  };
}

function ebook(overrides: Partial<EbookAvailability> = {}): EbookAvailability {
  return {
    ebookId: "ebook",
    title: "Nadja",
    editionId: "edition",
    editionLanguage: "fr",
    editionYear: 1964,
    formats: ["epub"],
    continue: descriptor(),
    ...overrides,
  };
}

const anchor = (fileId: string, clock: string | Date) => ({
  deviceId: "local-device",
  deviceLabel: "Mac · Chrome",
  chapter: "Chapter 7",
  fileId,
  clientUpdatedAt: clock,
  locator: {
    v: 1 as const,
    fileHash: "a".repeat(64),
    href: "chapter-7.xhtml",
    sectionIndex: 6,
    progression: 0.4,
    totalProgression: 0.44,
    cfi: "epubcfi(/6/14)",
    text: { before: "before", highlight: "passage", after: "after" },
  },
});

describe("catalogue Read target", () => {
  it("uses the newest local anchor across editions, including an old file awaiting re-anchor", () => {
    const older = ebook({
      ebookId: "older",
      continue: descriptor({
        localAnchor: anchor("new-file", "2026-10-08T10:00:00Z"),
        projection: "same-file",
        targetPercent: 80,
      }),
    });
    const replacement = ebook({
      ebookId: "replacement",
      editionLanguage: "es",
      formats: ["pdf"],
      continue: descriptor({
        localAnchor: anchor("replaced-file", "2026-10-09T10:00:00Z"),
        projection: "pending-reanchor",
        targetPercent: null,
      }),
    });
    const target = readTarget([older, replacement], "fr");
    expect(target).toBe(replacement);
    expect(target?.continue?.target.id).toBe("new-file");
    expect(target?.continue?.localAnchor?.fileId).toBe("replaced-file");
    expect(catalogueReadLabel(target?.continue ?? null)).toBe("Continue");
  });

  it("falls back to original edition language before preferred format", () => {
    const original = ebook({ ebookId: "original", formats: ["pdf"] });
    const translation = ebook({
      ebookId: "translation",
      editionLanguage: "es",
    });
    expect(readTarget([translation, original], "FR")).toBe(original);
  });

  it("uses the best offered format, then stable edition and ebook ids, without mutating input", () => {
    const pdf = ebook({ ebookId: "pdf", formats: ["pdf"] });
    const b = ebook({ ebookId: "b", formats: ["pdf", "epub"] });
    const a = ebook({ ebookId: "a" });
    const candidates = Object.freeze([pdf, b, a]);
    expect(readTarget(candidates, null)).toBe(a);
    expect(candidates).toEqual([pdf, b, a]);
    expect(b.formats).toEqual(["pdf", "epub"]);
    expect(
      readTarget([a, ebook({ ebookId: "z", editionId: "earlier" })], null)
        ?.ebookId,
    ).toBe("z");
  });

  it("ignores null descriptors even when a row claims formats or a local position", () => {
    const unavailable = ebook({ continue: null });
    expect(readTarget([unavailable], "fr")).toBeNull();
    expect(readTarget([], null)).toBeNull();
    expect(
      readTarget([unavailable, ebook({ ebookId: "eligible" })], "fr")?.ebookId,
    ).toBe("eligible");
  });

  it("does not rank an invalid local clock above valid or fallback choices", () => {
    const invalid = ebook({
      ebookId: "invalid",
      editionLanguage: "es",
      continue: descriptor({
        localAnchor: anchor("old-file", "not-a-time"),
      }),
    });
    expect(readTarget([invalid, ebook()], "fr")?.ebookId).toBe("ebook");
    const valid = ebook({
      ebookId: "valid",
      editionLanguage: "es",
      continue: descriptor({
        localAnchor: anchor("old-file", new Date("2026-10-08T10:00:00Z")),
      }),
    });
    expect(readTarget([ebook(), invalid, valid], "fr")).toBe(valid);
  });

  it.each([NaN, Infinity, -1, 101, null])(
    "never labels an invalid target percent %s as a landing",
    (targetPercent) => {
      expect(
        catalogueReadLabel(
          descriptor({
            localAnchor: anchor("new-file", "2026-10-09T10:00:00Z"),
            projection: "same-file",
            targetPercent,
          }),
        ),
      ).toBe("Continue");
    },
  );

  it("labels only a resolved local landing with a percentage", () => {
    expect(catalogueReadLabel(null)).toBeNull();
    expect(catalogueReadLabel(descriptor({ targetPercent: 44 }))).toBe("Read");
    expect(
      catalogueReadLabel(
        descriptor({
          localAnchor: anchor("new-file", "2026-10-09T10:00:00Z"),
          projection: "same-file",
          targetPercent: 44.49,
        }),
      ),
    ).toBe("Continue · 44%");
    expect(
      catalogueReadLabel(
        descriptor({
          localAnchor: anchor("old-file", "2026-10-09T10:00:00Z"),
          projection: "pending-reanchor",
          targetPercent: 44,
        }),
      ),
    ).toBe("Continue");
  });
});

describe("public eBook projection and export", () => {
  it("preserves local and remote anchor provenance while redacting target storage metadata", () => {
    const local = anchor("replaced-file", "2026-10-09T10:00:00Z");
    const remote = {
      ...anchor("other-file", "2026-10-09T11:00:00Z"),
      deviceId: "remote-device",
    };
    const raw: ContinueDescriptor = {
      ...descriptor(),
      target: {
        ...descriptor().target,
        status: "verified",
        drm: null,
        sizeBytes: 200,
        format: "epub",
        createdAt: "2026-10-09T09:00:00Z",
        s3Key: "gold/private-file",
        metadata: { secret: "private" },
      },
      anchor: local,
      localAnchor: local,
      newestOtherAnchor: remote,
      projection: "pending-reanchor",
      savedPercent: 44,
      targetPercent: null,
    };
    const result = catalogueContinueDTO(raw)!;
    expect(result.anchor).toEqual(local);
    expect(result.localAnchor).toEqual(local);
    expect(result.newestOtherAnchor).toEqual(remote);
    expect(result.target.sha256).toBe("b".repeat(64));
    expect(result.anchor?.locator.fileHash).toBe("a".repeat(64));
    expect(result.anchor?.locator.text).toEqual(local.locator.text);
    expect(result.anchor?.clientUpdatedAt).toBe(local.clientUpdatedAt);
    expect(result.savedPercent).toBe(44);
    expect(result.targetPercent).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/gold\/|secret|metadata/);
    result.anchor!.locator.text!.before = "changed projection";
    expect(local.locator.text.before).toBe("before");
    expect(catalogueContinueDTO(null)).toBeNull();
  });
  it("excludes storage data, nested file metadata and device anchors even from a wider source row", () => {
    const wide = {
      ...ebook({ formats: ["pdf", "epub", "pdf"] }),
      coverKey: "gold/private-cover",
      metadata: { token: "secret" },
      continue: {
        ...descriptor(),
        target: {
          ...descriptor().target,
          s3Key: "gold/private-file",
          metadata: { token: "secret" },
        },
        anchor: {
          ...anchor("old-file", "2026-10-09T10:00:00Z"),
          deviceId: "private-device",
          locator: {
            ...anchor("old-file", "2026-10-09T10:00:00Z").locator,
            fileHash: "private-hash",
          },
        },
      },
    };
    const result = workEbookDTO(wide);
    expect(result).toEqual({
      id: "ebook",
      title: "Nadja",
      formats: ["epub", "pdf"],
      readable: true,
      readerPath: "/reader/ebook?file=new-file",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /gold\/|secret|private-device|private-hash|metadata|anchor/,
    );
  });

  it("has no formats or reader path without a shared eligible descriptor", () => {
    expect(workEbookDTO(ebook({ continue: null }))).toEqual({
      id: "ebook",
      title: "Nadja",
      formats: [],
      readable: false,
      readerPath: null,
    });
  });

  it("exports a stable union across editions and excludes unavailable rows", () => {
    const rows = [
      workEbookDTO(ebook({ formats: ["pdf", "epub"] })),
      workEbookDTO(ebook({ formats: ["kepub", "epub"] })),
      { ...workEbookDTO(ebook()), readable: false, formats: ["cbz" as const] },
    ];
    expect(ebookExportFormats(rows)).toBe("EPUB; Kobo EPUB; PDF");
    expect(ebookExportFormats([])).toBe("");
  });
});

describe("palette eBook grouping", () => {
  it("keeps non-book domains isolated and gives unreadable eBooks metadata links only", () => {
    const readable = workEbookDTO(ebook());
    const unavailable = workEbookDTO(
      ebook({ ebookId: "unavailable", continue: null }),
    );
    const result = ebookPaletteGroup({
      works: [
        { id: "book", kind: "book", ebook: readable },
        { id: "film", kind: "film", ebook: readable },
        { id: "unavailable-book", kind: "book", ebook: unavailable },
      ],
      ebooks: [
        { ebook: readable, matchState: "linked" },
        { ebook: readable, matchState: "excluded" },
        { ebook: unavailable, matchState: "pending" },
      ],
      recent: unavailable,
      emptyQuery: true,
    });
    expect([...result.bookReaderPaths]).toEqual([
      ["book", readable.readerPath],
    ]);
    expect(result.ebooks).toEqual([
      {
        id: "unavailable",
        title: "Nadja",
        href: "/ebooks/unavailable",
        readerPath: null,
      },
    ]);
    expect(result.continueReading).toBeNull();
  });

  it("caps the unique unlinked group at five in query rank order", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      ebook: workEbookDTO(ebook({ ebookId: String(i) })),
      matchState: "standalone" as const,
    }));
    const result = ebookPaletteGroup({
      works: [],
      ebooks: [rows[0], ...rows],
      recent: null,
      emptyQuery: false,
    });
    expect(result.ebooks.map((row) => row.id)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("offers eligible Continue only for an empty query using its actual reader path", () => {
    const recent = workEbookDTO(ebook());
    const input = { works: [], ebooks: [], recent, emptyQuery: true };
    expect(ebookPaletteGroup(input).continueReading).toEqual({
      id: "ebook",
      title: "Continue reading Nadja",
      href: recent.readerPath,
      readerPath: recent.readerPath,
    });
    expect(
      ebookPaletteGroup({ ...input, emptyQuery: false }).continueReading,
    ).toBeNull();
  });
});
