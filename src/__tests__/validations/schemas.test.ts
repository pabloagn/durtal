import { describe, it, expect } from "vitest";
import { createWorkSchema, updateWorkSchema } from "@/lib/validations/works";
import {
  monochromeParamsSchema,
  createMediaSchema,
  updateMediaCropSchema,
  parseProcessingParams,
  DEFAULT_MONOCHROME_PARAMS,
} from "@/lib/validations/media";

// ── Work validation ──────────────────────────────────────────────────────────

describe("createWorkSchema", () => {
  const validWork = {
    title: "Don Quixote",
    authorIds: [{ authorId: "550e8400-e29b-41d4-a716-446655440000", role: "author" as const }],
  };

  it("accepts valid minimal input", () => {
    const result = createWorkSchema.safeParse(validWork);
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = createWorkSchema.safeParse({ ...validWork, title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects title longer than 500 chars", () => {
    const result = createWorkSchema.safeParse({ ...validWork, title: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("rejects empty authorIds", () => {
    const result = createWorkSchema.safeParse({ ...validWork, authorIds: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID in authorIds", () => {
    const result = createWorkSchema.safeParse({
      ...validWork,
      authorIds: [{ authorId: "not-a-uuid", role: "author" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid catalogue statuses", () => {
    for (const status of ["tracked", "shortlisted", "wanted", "on_order", "accessioned", "deaccessioned"]) {
      const result = createWorkSchema.safeParse({ ...validWork, catalogueStatus: status });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid catalogue status", () => {
    const result = createWorkSchema.safeParse({ ...validWork, catalogueStatus: "invalid" });
    expect(result.success).toBe(false);
  });

  it("defaults catalogueStatus to tracked", () => {
    const result = createWorkSchema.parse(validWork);
    expect(result.catalogueStatus).toBe("tracked");
  });

  it("accepts valid rating range 1-5", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const result = createWorkSchema.safeParse({ ...validWork, rating });
      expect(result.success).toBe(true);
    }
  });

  it("rejects rating outside 1-5", () => {
    expect(createWorkSchema.safeParse({ ...validWork, rating: 0 }).success).toBe(false);
    expect(createWorkSchema.safeParse({ ...validWork, rating: 6 }).success).toBe(false);
  });

  it("accepts year range -3000 to 2100", () => {
    expect(createWorkSchema.safeParse({ ...validWork, originalYear: -3000 }).success).toBe(true);
    expect(createWorkSchema.safeParse({ ...validWork, originalYear: 2100 }).success).toBe(true);
  });

  it("rejects year outside range", () => {
    expect(createWorkSchema.safeParse({ ...validWork, originalYear: -3001 }).success).toBe(false);
    expect(createWorkSchema.safeParse({ ...validWork, originalYear: 2101 }).success).toBe(false);
  });
});

describe("updateWorkSchema", () => {
  it("accepts partial updates (no required fields)", () => {
    const result = updateWorkSchema.safeParse({ title: "Updated Title" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = updateWorkSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

// ── Monochrome params ────────────────────────────────────────────────────────

describe("monochromeParamsSchema", () => {
  it("accepts valid defaults", () => {
    const result = monochromeParamsSchema.safeParse(DEFAULT_MONOCHROME_PARAMS);
    expect(result.success).toBe(true);
  });

  it("rejects contrast below 0.5", () => {
    expect(
      monochromeParamsSchema.safeParse({ ...DEFAULT_MONOCHROME_PARAMS, contrast: 0.4 }).success,
    ).toBe(false);
  });

  it("rejects contrast above 3.0", () => {
    expect(
      monochromeParamsSchema.safeParse({ ...DEFAULT_MONOCHROME_PARAMS, contrast: 3.1 }).success,
    ).toBe(false);
  });

  it("rejects brightness below 0.5", () => {
    expect(
      monochromeParamsSchema.safeParse({ ...DEFAULT_MONOCHROME_PARAMS, brightness: 0.4 }).success,
    ).toBe(false);
  });

  it("rejects brightness above 2.0", () => {
    expect(
      monochromeParamsSchema.safeParse({ ...DEFAULT_MONOCHROME_PARAMS, brightness: 2.1 }).success,
    ).toBe(false);
  });

  it("rejects gamma below 0.5", () => {
    expect(
      monochromeParamsSchema.safeParse({ ...DEFAULT_MONOCHROME_PARAMS, gamma: 0.4 }).success,
    ).toBe(false);
  });

  it("rejects sharpness above 5.0", () => {
    expect(
      monochromeParamsSchema.safeParse({ ...DEFAULT_MONOCHROME_PARAMS, sharpness: 5.1 }).success,
    ).toBe(false);
  });

  it("accepts boundary values", () => {
    const boundary = { grayscale: true, contrast: 0.5, sharpness: 0.0, gamma: 0.5, brightness: 0.5 };
    expect(monochromeParamsSchema.safeParse(boundary).success).toBe(true);
  });
});

describe("parseProcessingParams", () => {
  it("returns null for falsy input", () => {
    expect(parseProcessingParams(null)).toBeNull();
    expect(parseProcessingParams(undefined)).toBeNull();
    expect(parseProcessingParams(0)).toBeNull();
  });

  it("returns parsed params for valid input", () => {
    const result = parseProcessingParams(DEFAULT_MONOCHROME_PARAMS);
    expect(result).toEqual(DEFAULT_MONOCHROME_PARAMS);
  });

  it("returns null for invalid input", () => {
    expect(parseProcessingParams({ contrast: 999 })).toBeNull();
  });
});

// ── Media CRUD schemas ───────────────────────────────────────────────────────

describe("createMediaSchema", () => {
  const validMedia = {
    workId: "550e8400-e29b-41d4-a716-446655440000",
    type: "poster" as const,
    s3Key: "gold/works/abc/poster.webp",
  };

  it("accepts valid work media", () => {
    const result = createMediaSchema.safeParse(validMedia);
    expect(result.success).toBe(true);
  });

  it("accepts valid author media", () => {
    const result = createMediaSchema.safeParse({
      authorId: "550e8400-e29b-41d4-a716-446655440000",
      type: "poster",
      s3Key: "gold/authors/abc/poster.webp",
    });
    expect(result.success).toBe(true);
  });

  it("rejects when both workId and authorId are set", () => {
    const result = createMediaSchema.safeParse({
      ...validMedia,
      authorId: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when neither workId nor authorId is set", () => {
    const result = createMediaSchema.safeParse({
      type: "poster",
      s3Key: "gold/works/abc/poster.webp",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid media type", () => {
    const result = createMediaSchema.safeParse({ ...validMedia, type: "avatar" });
    expect(result.success).toBe(false);
  });

  it("rejects empty s3Key", () => {
    const result = createMediaSchema.safeParse({ ...validMedia, s3Key: "" });
    expect(result.success).toBe(false);
  });
});

describe("updateMediaCropSchema", () => {
  it("accepts valid crop values", () => {
    const result = updateMediaCropSchema.safeParse({ cropX: 50, cropY: 50, cropZoom: 100 });
    expect(result.success).toBe(true);
  });

  it("rejects cropX outside 0-100", () => {
    expect(updateMediaCropSchema.safeParse({ cropX: -1, cropY: 50, cropZoom: 100 }).success).toBe(false);
    expect(updateMediaCropSchema.safeParse({ cropX: 101, cropY: 50, cropZoom: 100 }).success).toBe(false);
  });

  it("rejects cropZoom below 100", () => {
    expect(updateMediaCropSchema.safeParse({ cropX: 50, cropY: 50, cropZoom: 99 }).success).toBe(false);
  });

  it("rejects cropZoom above 300", () => {
    expect(updateMediaCropSchema.safeParse({ cropX: 50, cropY: 50, cropZoom: 301 }).success).toBe(false);
  });
});
