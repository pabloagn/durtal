import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkKind } from "@/lib/catalogue/kinds";

const mocks = vi.hoisted(() => ({
  media: vi.fn(),
  authors: vi.fn(),
  editions: vi.fn(),
  venues: vi.fn(),
  attachments: vi.fn(),
  kind: vi.fn(),
  build: vi.fn(),
  commit: vi.fn(),
  atomic: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      media: { findFirst: mocks.media },
      authors: { findFirst: mocks.authors },
      editions: { findFirst: mocks.editions },
      venues: { findFirst: mocks.venues },
      commentAttachments: { findFirst: mocks.attachments },
    },
  },
}));
vi.mock("@/lib/db/atomic", () => ({ atomic: mocks.atomic }));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: {},
}));
vi.mock("@/lib/media/ingest", () => ({ mediaOwnerKind: mocks.kind }));
vi.mock("@/lib/media/display", async (original) => {
  const actual = await original<typeof import("@/lib/media/display")>();
  return {
    ...actual,
    buildDisplayFiles: mocks.build,
    commitDisplay: mocks.commit,
  };
});

import {
  getImagePresentation,
  saveImagePresentation,
} from "@/lib/actions/image-adjustments";
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  s3ImageSource,
} from "@/lib/utils/image-adjustments";
import { STALE_IMAGE_PRESENTATION } from "@/lib/media/presentation-revision";

const source = s3ImageSource("gold/media/fixture/full.webp");
const revision = "a".repeat(32);
const item = {
  id: "00000000-0000-0000-0000-000000000333",
  workId: "fixture-work",
  authorId: null,
  collectionId: null,
  organizationId: null,
  artObjectId: null,
  perfumeVariantId: null,
  type: "poster",
  s3Key: "gold/media/fixture/full.webp",
  thumbnailS3Key: "gold/media/fixture/thumb.webp",
  uncroppedS3Key: null,
  appliedCrop: null,
  width: 1200,
  height: 600,
  cropX: 50,
  cropY: 50,
  cropZoom: 100,
  brightness: 115,
  contrast: 125,
  altText: null,
  revision,
  storedSettings: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.media.mockResolvedValue({ ...item });
  mocks.kind.mockResolvedValue("book");
  mocks.build.mockResolvedValue(null);
});

describe("image presentation action boundaries without a database", () => {
  it.each<WorkKind>(["perfume", "painting"])(
    "derives contained %s policy from the resolved owner on read and Save",
    async (kind) => {
      mocks.kind.mockResolvedValue(kind);
      const presentation = await getImagePresentation(source);
      expect(presentation).toMatchObject({
        supportsCrop: false,
        crop: null,
        fit: "contain",
        revision,
      });
      expect(presentation.aspect).toBe(kind === "perfume" ? 1 : 2);
      await expect(
        saveImagePresentation(source, {
          revision,
          settings: {},
          crop: { cropX: 50, cropY: 50, cropZoom: 100 },
        }),
      ).rejects.toThrow("does not support framed cropping");
      expect(mocks.kind).toHaveBeenCalledWith({
        type: "work",
        id: "fixture-work",
      });
      expect(mocks.build).not.toHaveBeenCalled();
      expect(mocks.commit).not.toHaveBeenCalled();
    },
  );
  it("distinguishes stored display pixels, retained crop base and applied crop", async () => {
    mocks.media.mockResolvedValue({
      ...item,
      uncroppedS3Key: "gold/media/fixture/base.webp",
      appliedCrop: { x: 20, y: 70, zoom: 150 },
    });
    expect(await getImagePresentation(source)).toMatchObject({
      display: source,
      preview: s3ImageSource("gold/media/fixture/base.webp"),
      crop: { cropX: 20, cropY: 70, cropZoom: 150 },
      appliedCrop: { x: 20, y: 70, zoom: 150 },
      supportsCrop: true,
    });
  });
  it("preserves whole-raster provenance when a legacy file has no uncropped base", async () => {
    expect(await getImagePresentation(source)).toMatchObject({
      display: source,
      preview: source,
      appliedCrop: null,
    });
  });
  it("requires a well-formed opaque baseline instead of accepting an unguarded save", async () => {
    for (const invalid of [undefined, "absent", 0, new Date(), "a".repeat(31)])
      await expect(
        saveImagePresentation(source, {
          revision: invalid as string,
          settings: {},
        }),
      ).rejects.toThrow();
    expect(mocks.media).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
  it("passes the client's loaded revision to the atomic commit and returns its new revision", async () => {
    const next = "b".repeat(32);
    mocks.commit.mockResolvedValue({ ...item, revision: next });
    const saved = await saveImagePresentation(source, {
      revision,
      settings: { exposure: 1 },
    });
    expect(mocks.commit.mock.calls[0][4]).toEqual({ revision });
    expect(saved).toMatchObject({ revision: next, settings: { exposure: 1 } });
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("surfaces a stale save without retrying it as an unconditional write", async () => {
    mocks.commit.mockRejectedValue(new Error(STALE_IMAGE_PRESENTATION));
    await expect(
      saveImagePresentation(source, { revision, settings: {} }),
    ).resolves.toEqual({ error: "stale", message: STALE_IMAGE_PRESENTATION });
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(mocks.atomic).not.toHaveBeenCalled();
  });
  it("keeps monochrome server-enforced, even for hostile color edits", async () => {
    mocks.media.mockResolvedValue({
      ...item,
      workId: null,
      authorId: "fixture-person",
    });
    mocks.commit.mockResolvedValue({ ...item, revision: "b".repeat(32) });
    await saveImagePresentation(source, {
      revision,
      settings: { grayscale: 0, saturation: 200, sepia: 100 },
    });
    expect(mocks.commit.mock.calls[0][3]).toEqual({
      settings: { ...DEFAULT_IMAGE_ADJUSTMENTS, grayscale: 100 },
      monochrome: true,
    });
  });
  it.each([
    "/api/reader/fixture/cover",
    "https://example.invalid/image.jpg",
    "//example.invalid/image.jpg",
  ])("does not expand editable source policy to %s", async (unsupported) => {
    await expect(
      saveImagePresentation(unsupported, { revision, settings: {} }),
    ).rejects.toThrow("not a stored Durtal asset");
    expect(mocks.media).not.toHaveBeenCalled();
  });
});
