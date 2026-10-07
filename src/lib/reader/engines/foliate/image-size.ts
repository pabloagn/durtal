/**
 * An image's displayed size from its first bytes (eBooks sub-issue 3), so a
 * large image in a book can be laid out at its size before its bytes
 * arrive: PNG, JPEG (with its EXIF orientation), GIF and WebP. Null when the
 * bytes do not say.
 */

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

const valid = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 && width <= 65_535 && height <= 65_535 ? { width, height } : null;

/** The EXIF orientation in an APP1 segment's data (1 when it has none) */
function exifOrientation(b: Uint8Array, start: number, end: number): number {
  if (end - start < 14 || ascii(b, start, 4) !== "Exif") return 1;
  const tiff = start + 6;
  const little = ascii(b, tiff, 2) === "II";
  const u16 = (i: number) => (little ? u16le(b, i) : u16be(b, i));
  const u32 = (i: number) => (little ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
}

function jpegSize(b: Uint8Array): ImageSize | null {
  let orientation = 1;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // Fill bytes, and markers with no length
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (marker === 0xe1) orientation = exifOrientation(b, i + 4, Math.min(b.length, i + 2 + length));
    // Start of frame: every SOFn but DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return orientation >= 5 && orientation <= 8 ? valid(height, width) : valid(width, height);
    }
    i += 2 + length;
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") return valid(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (chunk === "VP8 ") return valid(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  if (chunk === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  return null;
}

export function imageSize(b: Uint8Array): ImageSize | null {
  if (b.length >= 24 && u32be(b, 0) === 0x89504e47 && ascii(b, 12, 4) === "IHDR") return valid(u32be(b, 16), u32be(b, 20));
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b.length >= 10 && ascii(b, 0, 3) === "GIF") return valid(u16le(b, 6), u16le(b, 8));
  if (b.length >= 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return webpSize(b);
  return null;
}
