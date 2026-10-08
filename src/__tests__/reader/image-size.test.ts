import { describe, expect, it } from "vitest";
import { imageSize } from "@/lib/reader/engines/foliate/image-size";

/* SLN-492: an image's size from its first bytes, for the blanks large images show first */

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u16be = (n: number) => [n >> 8, n & 255];
const u16le = (n: number) => [n & 255, n >> 8];
const u24le = (n: number) => [n & 255, (n >> 8) & 255, n >> 16];
const u32be = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];

const png = (w: number, h: number) => bytes([0x89], "PNG\r\n\x1a\n", u32be(13), "IHDR", u32be(w), u32be(h), [8, 6, 0, 0, 0]);

/** A JPEG: SOI, an optional EXIF APP1 with an orientation, a DQT, then SOF0 */
function jpeg(w: number, h: number, orientation?: number, little = false) {
  const u16 = little ? u16le : u16be;
  const u32 = (n: number) => (little ? [...u32be(n)].reverse() : u32be(n));
  const app1 =
    orientation === undefined
      ? []
      : (() => {
          const tiff = [...(little ? "II" : "MM")].map((c) => c.charCodeAt(0)).concat(u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientation), [0, 0], u32(0));
          const data = bytes("Exif", [0, 0], tiff);
          return [0xff, 0xe1, ...u16be(data.length + 2), ...data];
        })();
  const dqt = [0xff, 0xdb, ...u16be(67), ...new Array(65).fill(1)];
  const sof = [0xff, 0xc0, ...u16be(17), 8, ...u16be(h), ...u16be(w), 3, ...new Array(9).fill(0)];
  return bytes([0xff, 0xd8], app1, dqt, sof, [0xff, 0xda]);
}

describe("imageSize", () => {
  it("reads a PNG's header", () => {
    expect(imageSize(png(1200, 1800))).toEqual({ width: 1200, height: 1800 });
  });

  it("reads a JPEG's frame past its other segments", () => {
    expect(imageSize(jpeg(2000, 3000))).toEqual({ width: 2000, height: 3000 });
  });

  it("turns a JPEG's size by its EXIF orientation", () => {
    expect(imageSize(jpeg(2000, 3000, 1))).toEqual({ width: 2000, height: 3000 });
    expect(imageSize(jpeg(2000, 3000, 6))).toEqual({ width: 3000, height: 2000 });
    expect(imageSize(jpeg(2000, 3000, 8, true))).toEqual({ width: 3000, height: 2000 });
    expect(imageSize(jpeg(2000, 3000, 3, true))).toEqual({ width: 2000, height: 3000 });
  });

  it("reads a GIF's screen size", () => {
    expect(imageSize(bytes("GIF89a", u16le(640), u16le(480), [0, 0, 0]))).toEqual({ width: 640, height: 480 });
  });

  it("reads the three kinds of WebP", () => {
    const riff = (chunk: string, body: number[]) => bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], body);
    expect(imageSize(riff("VP8X", [0, 0, 0, 0, ...u24le(799), ...u24le(599), 0, 0]))).toEqual({ width: 800, height: 600 });
    expect(imageSize(riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(320), ...u16le(240)]))).toEqual({ width: 320, height: 240 });
    const bits = (100 - 1) | ((50 - 1) << 14);
    expect(imageSize(riff("VP8L", [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >>> 24) & 255, 0, 0, 0, 0, 0]))).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("gives null when the bytes do not say", () => {
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(bytes("not an image at all, just text"))).toBeNull();
    // Cut before the JPEG's frame
    expect(imageSize(jpeg(10, 10).subarray(0, 40))).toBeNull();
    expect(imageSize(png(0, 10))).toBeNull();
  });
});
