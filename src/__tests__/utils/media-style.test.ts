import { describe, it, expect } from "vitest";
import {
  DEFAULT_MEDIA_CROP,
  mediaCrop,
  mediaFilter,
  mediaImageStyle,
} from "@/lib/utils/media-style";
import { updateMediaCropSchema } from "@/lib/validations/media";

// ── mediaCrop ──────────────────────────────────────────────────────────────────

describe("mediaCrop", () => {
  it("maps a media row", () => {
    expect(
      mediaCrop({ cropX: 30, cropY: 70, cropZoom: 150, brightness: 120, contrast: 90 }),
    ).toEqual({ x: 30, y: 70, zoom: 150, brightness: 120, contrast: 90 });
  });

  it("fills missing or null fields with defaults", () => {
    expect(mediaCrop({})).toEqual(DEFAULT_MEDIA_CROP);
    expect(mediaCrop({ cropX: null, brightness: null })).toEqual(DEFAULT_MEDIA_CROP);
  });
});

// ── mediaFilter ────────────────────────────────────────────────────────────────

describe("mediaFilter", () => {
  it("is undefined when brightness and contrast are unchanged or missing", () => {
    expect(mediaFilter(DEFAULT_MEDIA_CROP)).toBeUndefined();
    expect(mediaFilter({ x: 50, y: 50, zoom: 100 })).toBeUndefined();
    expect(mediaFilter(null)).toBeUndefined();
  });

  it("builds the CSS filter", () => {
    expect(mediaFilter({ ...DEFAULT_MEDIA_CROP, brightness: 120 })).toBe("brightness(120%) contrast(100%)");
    expect(mediaFilter({ ...DEFAULT_MEDIA_CROP, contrast: 80 })).toBe("brightness(100%) contrast(80%)");
  });
});

// ── mediaImageStyle ────────────────────────────────────────────────────────────

describe("mediaImageStyle", () => {
  it("is undefined for no crop or default values", () => {
    expect(mediaImageStyle(null)).toBeUndefined();
    expect(mediaImageStyle(undefined)).toBeUndefined();
    expect(mediaImageStyle(DEFAULT_MEDIA_CROP)).toBeUndefined();
    expect(mediaImageStyle({ x: 50, y: 50, zoom: 100 })).toBeUndefined();
  });

  it("applies only the crop when brightness and contrast are unchanged", () => {
    expect(mediaImageStyle({ ...DEFAULT_MEDIA_CROP, x: 20, zoom: 150 })).toEqual({
      objectPosition: "20% 50%",
      transform: "scale(1.5)",
      transformOrigin: "20% 50%",
    });
  });

  it("applies only the filter when the crop is default", () => {
    expect(mediaImageStyle({ ...DEFAULT_MEDIA_CROP, brightness: 130, contrast: 110 })).toEqual({
      filter: "brightness(130%) contrast(110%)",
    });
  });

  it("applies both", () => {
    expect(mediaImageStyle({ x: 40, y: 60, zoom: 120, brightness: 90, contrast: 140 })).toEqual({
      objectPosition: "40% 60%",
      transform: "scale(1.2)",
      transformOrigin: "40% 60%",
      filter: "brightness(90%) contrast(140%)",
    });
  });
});

// ── updateMediaCropSchema: brightness / contrast ──────────────────────────────

describe("updateMediaCropSchema brightness and contrast", () => {
  const crop = { cropX: 50, cropY: 50, cropZoom: 100 };

  it("keeps working without the new fields", () => {
    expect(updateMediaCropSchema.safeParse(crop).success).toBe(true);
  });

  it("accepts values from 0 to 200", () => {
    expect(updateMediaCropSchema.safeParse({ ...crop, brightness: 0, contrast: 200 }).success).toBe(true);
    expect(updateMediaCropSchema.safeParse({ ...crop, brightness: 125.5, contrast: 75 }).success).toBe(true);
  });

  it("rejects values outside 0-200", () => {
    expect(updateMediaCropSchema.safeParse({ ...crop, brightness: -1 }).success).toBe(false);
    expect(updateMediaCropSchema.safeParse({ ...crop, contrast: 201 }).success).toBe(false);
  });
});
