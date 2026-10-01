import { describe, it, expect } from "vitest";
import { imagePolicy } from "@/lib/media/policy";
import {
  imagePresentation,
  NATIVE_RATIO_LIMITS,
  type PresentableImage,
} from "@/lib/media/presentation";

const image = (over: Partial<PresentableImage> = {}): PresentableImage => ({
  s3Key: "gold/media/work/w/poster/f.webp",
  thumbnailS3Key: "gold/media/work/w/poster/f_thumb.webp",
  width: 1600,
  height: 2400,
  cropX: 50,
  cropY: 50,
  cropZoom: 100,
  altText: null,
  ...over,
});
const size = (p: ReturnType<typeof imagePolicy>) => [p.slot, p.fit, p.maxWidth, p.maxHeight, p.keepOriginal];

describe("image policies per domain", () => {
  it("keeps books and films portrait with a focal crop", () => {
    for (const kind of ["book", "film"] as const)
      expect(size(imagePolicy({ type: "work", kind }, "poster"))).toEqual(["portrait", "cover", 1600, 2400, false]);
  });
  it("contains perfume bottles in a square frame", () => {
    expect(size(imagePolicy({ type: "work", kind: "perfume" }, "poster"))).toEqual(["square", "contain", 2000, 2000, false]);
    expect(size(imagePolicy({ type: "perfume_variant" }, "poster"))).toEqual(["square", "contain", 2000, 2000, false]);
  });
  it("gives paintings large native frames and keeps their originals", () => {
    for (const owner of [{ type: "work" as const, kind: "painting" as const }, { type: "art_object" as const }]) {
      expect(size(imagePolicy(owner, "poster"))).toEqual(["native", "contain", 4096, 4096, true]);
      expect(size(imagePolicy(owner, "gallery"))).toEqual(["native", "contain", 4096, 4096, true]);
    }
    expect(size(imagePolicy({ type: "work", kind: "book" }, "gallery"))).toEqual(["native", "contain", 2400, 2400, false]);
  });
  it("keeps author portraits monochrome and backgrounds landscape", () => {
    expect(imagePolicy({ type: "author" }, "poster")).toMatchObject({ slot: "portrait", monochrome: true });
    expect(imagePolicy({ type: "work", kind: "painting" }, "background")).toMatchObject({ slot: "landscape", fit: "cover", maxWidth: 2560 });
    expect(imagePolicy({ type: "organization" }, "poster")).toMatchObject({ slot: "square", fit: "contain", maxWidth: 1600 });
  });
});

describe("image frames", () => {
  const book = imagePolicy({ type: "work", kind: "book" }, "poster");
  const painting = imagePolicy({ type: "art_object" }, "poster");
  const perfume = imagePolicy({ type: "perfume_variant" }, "poster");
  it("crops a book poster to its focal point", () => {
    expect(imagePresentation(book, image({ cropX: 30, cropY: 70, cropZoom: 120 }), "Book")).toEqual({
      src: "/api/s3/read?key=gold%2Fmedia%2Fwork%2Fw%2Fposter%2Ff_thumb.webp",
      aspectRatio: 2 / 3,
      objectFit: "cover",
      objectPosition: "30% 70%",
      scale: 1.2,
      alt: "Book",
      orientation: "portrait",
    });
  });
  it("shows a painting whole in its own proportions and ignores any crop", () => {
    const landscape = imagePresentation(painting, image({ width: 4000, height: 2000, cropX: 10, cropZoom: 200 }), "Painting", "full");
    expect(landscape).toMatchObject({ aspectRatio: 2, objectFit: "contain", objectPosition: "50% 50%", scale: 1, orientation: "landscape" });
    expect(landscape.src).toBe("/api/s3/read?key=gold%2Fmedia%2Fwork%2Fw%2Fposter%2Ff.webp");
    expect(imagePresentation(painting, image({ width: 10000, height: 1000 }), "Wide").aspectRatio).toBe(NATIVE_RATIO_LIMITS.max);
    expect(imagePresentation(painting, image({ width: 1000, height: 10000 }), "Tall").aspectRatio).toBe(NATIVE_RATIO_LIMITS.min);
  });
  it("contains a landscape bottle photo in a square frame", () => {
    expect(imagePresentation(perfume, image({ width: 3000, height: 2000 }), "Bottle")).toMatchObject({ aspectRatio: 1, objectFit: "contain", orientation: "landscape" });
    expect(imagePresentation(perfume, image({ width: 1000, height: 1010 }), "Bottle").orientation).toBe("square");
  });
  it("keeps the frame and alt text when the image is missing", () => {
    expect(imagePresentation(painting, null, "No image")).toMatchObject({ src: null, aspectRatio: 0.8, alt: "No image", scale: 1, orientation: null });
    expect(imagePresentation(book, null, "No cover")).toMatchObject({ src: null, aspectRatio: 2 / 3, objectFit: "cover", objectPosition: "50% 50%" });
  });
  it("prefers the stored alt text", () => {
    expect(imagePresentation(book, image({ altText: "A red cloth binding" }), "Book").alt).toBe("A red cloth binding");
  });
});
