import { describe, expect, it } from "vitest";
import { editionImage } from "@/lib/utils/edition-image";

const poster = {
  s3Key: "gold/poster.jpg",
  thumbnailS3Key: "gold/poster-thumb.jpg",
  cropX: 30,
  cropY: null,
  cropZoom: 120,
};

describe("edition image", () => {
  it("prefers the edition's own thumbnail, then its cover", () => {
    expect(
      editionImage({ coverS3Key: "c.jpg", thumbnailS3Key: "t.jpg" }, poster),
    ).toEqual({ key: "t.jpg", crop: null, source: "edition" });
    expect(
      editionImage({ coverS3Key: "c.jpg", thumbnailS3Key: null }, poster)?.key,
    ).toBe("c.jpg");
  });

  it("falls back to the book poster with its crop", () => {
    expect(
      editionImage({ coverS3Key: null, thumbnailS3Key: null }, poster),
    ).toEqual({
      key: "gold/poster-thumb.jpg",
      crop: { x: 30, y: 50, zoom: 120, brightness: 100, contrast: 100 },
      source: "poster",
    });
  });

  it("has no image without a cover or a poster", () => {
    expect(
      editionImage({ coverS3Key: null, thumbnailS3Key: null }, null),
    ).toBeNull();
  });
});
