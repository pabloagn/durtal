/** Header-only dimensions, before passing untrusted bytes to a native decoder. */
export function rasterHeader(bytes: Uint8Array): { width: number; height: number; format: "png" | "jpeg" | "webp" } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length >= 33 && ascii(1, 3) === "PNG" && bytes[0] === 137 && ascii(12, 4) === "IHDR") {
    if (view.getUint32(8) !== 13 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) throw new Error("Unsupported PNG header");
    return { width: view.getUint32(16), height: view.getUint32(20), format: "png" };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2, markers = 0; at + 4 <= bytes.length && markers++ < 10_000;) {
      if (bytes[at++] !== 0xff) throw new Error("Malformed JPEG marker");
      while (at < bytes.length && bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (at + 2 > bytes.length) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) throw new Error("JPEG header truncated");
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || bytes[at + 2] !== 8 || bytes[at + 7] < 1 || bytes[at + 7] > 4
          || length !== 8 + 3 * bytes[at + 7]) throw new Error("Unsupported JPEG frame");
        return { width: view.getUint16(at + 5), height: view.getUint16(at + 3), format: "jpeg" };
      }
      at += length;
    }
    throw new Error("JPEG bounded frame header missing");
  }
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error("WebP RIFF length differs");
    let outer: { width: number; height: number } | null = null;
    let frame: { width: number; height: number } | null = null;
    let count = 0;
    for (let at = 12; at < bytes.length;) {
      if (++count > 10_000 || at + 8 > bytes.length) throw new Error("WebP chunk directory exceeds its bound");
      const kind = ascii(at, 4); const length = view.getUint32(at + 4, true); const payload = at + 8;
      const end = payload + length; const padded = end + (length & 1);
      if (padded > bytes.length || length & 1 && bytes[end] !== 0) throw new Error("WebP chunk truncated");
      if (kind === "VP8X") {
        if (outer || at !== 12 || length !== 10 || bytes[payload] & 0xc3 || bytes[payload + 1] || bytes[payload + 2] || bytes[payload + 3])
          throw new Error("Animated or malformed WebP is outside the bounded cover profile");
        const little24 = (offset: number) => bytes[offset] | bytes[offset + 1] << 8 | bytes[offset + 2] << 16;
        outer = { width: little24(payload + 4) + 1, height: little24(payload + 7) + 1 };
      } else if (kind === "VP8 " || kind === "VP8L") {
        if (frame) throw new Error("WebP has more than one image frame");
        if (kind === "VP8 " && length >= 10 && !(bytes[payload] & 1) && bytes[payload + 3] === 0x9d
          && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
          const width = view.getUint16(payload + 6, true); const height = view.getUint16(payload + 8, true);
          if (width & 0xc000 || height & 0xc000) throw new Error("WebP frame uses unsupported scaling");
          frame = { width, height };
        } else if (kind === "VP8L" && length >= 5 && bytes[payload] === 0x2f) {
          const packed = view.getUint32(payload + 1, true);
          if (packed >>> 29) throw new Error("Unsupported lossless WebP version");
          frame = { width: (packed & 0x3fff) + 1, height: (packed >>> 14 & 0x3fff) + 1 };
        } else throw new Error("WebP frame header is malformed");
      } else if (!["ALPH", "ICCP", "EXIF", "XMP "].includes(kind)) throw new Error("WebP chunk type is outside the bounded cover profile");
      at = padded;
    }
    if (!frame || outer && (frame.width !== outer.width || frame.height !== outer.height)) throw new Error("WebP frame dimensions differ from its canvas");
    return { ...frame, format: "webp" };
  }
  throw new Error("Cover codec is outside the bounded raster profile");
}
