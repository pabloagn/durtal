import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { renderAuthorImage, renderImage } from "@/lib/s3/media";
import { imagePolicy } from "@/lib/media/policy";
import { DEFAULT_MONOCHROME_PARAMS } from "@/lib/validations/media";

/** A plain generated image; `orientation` writes an EXIF orientation tag. */
async function fixture(width: number, height: number, orientation?: number) {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 180, g: 40, b: 40 } } });
  return (orientation ? image.withMetadata({ orientation }) : image).jpeg().toBuffer();
}
async function dimensions(buffer: Buffer | null) {
  if (!buffer) return null;
  const { width, height, format } = await sharp(buffer).metadata();
  return [width, height, format];
}

describe("rendering images for a policy", () => {
  it("keeps a large painting whole, with a full-resolution original", async () => {
    const out = await renderImage(await fixture(6000, 3000), imagePolicy({ type: "art_object" }, "poster"));
    expect([out.width, out.height]).toEqual([4096, 2048]);
    expect(await dimensions(out.full)).toEqual([4096, 2048, "webp"]);
    expect(await dimensions(out.thumb)).toEqual([1200, 600, "webp"]);
    expect(await dimensions(out.original)).toEqual([6000, 3000, "webp"]);
  }, 30000);
  it("keeps book posters at the existing portrait sizes without an original", async () => {
    const out = await renderImage(await fixture(3000, 4500), imagePolicy({ type: "work", kind: "book" }, "poster"));
    expect(await dimensions(out.full)).toEqual([1600, 2400, "webp"]);
    expect(await dimensions(out.thumb)).toEqual([800, 1200, "webp"]);
    expect(out.original).toBeNull();
  });
  it("fits a landscape bottle photo inside the square limit", async () => {
    const out = await renderImage(await fixture(3000, 2000), imagePolicy({ type: "perfume_variant" }, "poster"));
    expect(await dimensions(out.full)).toEqual([2000, 1333, "webp"]);
    expect(await dimensions(out.thumb)).toEqual([1000, 667, "webp"]);
  });
  it("keeps a cut-out bottle transparent and whole in the perfume's square frame", async () => {
    // A tall bottle on a transparent background, as shops publish them
    const cutout = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect x="200" y="100" width="200" height="1000" fill="#7a5c3e"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    for (const owner of [{ type: "work" as const, kind: "perfume" as const }, { type: "perfume_variant" as const }]) {
      const out = await renderImage(cutout, imagePolicy(owner, "poster"));
      expect(await dimensions(out.full)).toEqual([600, 1200, "webp"]);
      const { data, info } = await sharp(out.full).raw().toBuffer({ resolveWithObject: true });
      expect(info.channels).toBe(4);
      // The corner stays see-through; the bottle stays opaque
      expect(data[3]).toBe(0);
      const middle = (600 * 600 + 300) * 4;
      expect(data[middle + 3]).toBe(255);
    }
  });
  it("never enlarges a small image", async () => {
    const out = await renderImage(await fixture(400, 300), imagePolicy({ type: "art_object" }, "poster"));
    expect(await dimensions(out.full)).toEqual([400, 300, "webp"]);
    expect(await dimensions(out.original)).toEqual([400, 300, "webp"]);
  });
  it("applies the camera orientation and drops metadata", async () => {
    const out = await renderImage(await fixture(300, 200, 6), imagePolicy({ type: "work", kind: "book" }, "poster"));
    expect(await dimensions(out.full)).toEqual([200, 300, "webp"]);
    const meta = await sharp(out.full).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });
  it("keeps an author's colour original and shows monochrome", async () => {
    const out = await renderAuthorImage(await fixture(1200, 1800), imagePolicy({ type: "author" }, "poster"), DEFAULT_MONOCHROME_PARAMS);
    const { dominant } = await sharp(out.full).stats();
    expect(dominant.r).toBe(dominant.g);
    const colour = await sharp(out.original!).stats();
    expect(colour.dominant.r).toBeGreaterThan(colour.dominant.g);
  });
});
