/**
 * Logo cards (SLN-441): any logo becomes the same card. One fixed template, a
 * 3:2 black card with the logo in one light ink, every logo at the same visual
 * size and centred on its visual middle. Plain image processing with sharp, no
 * generative model:
 *
 * 1. Rasterize. An SVG becomes pixels here and is never stored or served as
 *    SVG (it can carry code).
 * 2. Find the background from the edge pixels. A transparent logo is judged
 *    against the backdrop it was drawn for: white behind a dark logo, black
 *    behind a light one, so inner details stay cut out.
 * 3. Make a one-channel ink mask: every pixel unlike the background is ink,
 *    with soft edges kept; parts that match the background become cut-outs.
 * 4. Trim, size by visual weight (ink area, not the bounding box) and centre
 *    on the ink's centre of mass.
 *
 * Masks stay single-channel throughout: sharp turns a resized one-channel raw
 * image into three channels unless told otherwise, which scrambles the rows.
 */

import type { LogoCardOptions } from "./logo-card-options";

export { isLogoCard, parseLogoCardOptions, type LogoCardOptions } from "./logo-card-options";

export const LOGO_CARD_WIDTH = 1200;
export const LOGO_CARD_HEIGHT = 800;
/** The card and the ink */
const CARD_RGB = { r: 0, g: 0, b: 0 };
const INK_RGB = { r: 245, g: 245, b: 245 };
/** The ink covers this share of the card, before the size switch */
const TARGET_INK_SHARE = 0.085;
/** The logo stays inside this box, so a wide wordmark keeps its margins */
const MAX_LOGO_WIDTH = 0.74;
const MAX_LOGO_HEIGHT = 0.56;
/** Rasterized logos are at most this long on their long side */
const WORK_SIZE = 1600;


interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel */
  rgba: Buffer;
}

async function rasterize(input: Buffer): Promise<Raster> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(input).metadata();
  const isSvg = meta.format === "svg";
  // An SVG is drawn at a density that gives about WORK_SIZE pixels
  const density = isSvg
    ? Math.min(
        2400,
        Math.max(72, Math.round((72 * WORK_SIZE) / Math.max(meta.width ?? 1, meta.height ?? 1))),
      )
    : undefined;
  const { data, info } = await sharp(input, density ? { density } : {})
    .rotate()
    .resize(WORK_SIZE, WORK_SIZE, { fit: "inside", withoutEnlargement: !isSvg })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, rgba: data };
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The pixels on the image's border */
function* edgePixels(width: number, height: number) {
  for (let x = 0; x < width; x++) {
    yield x;
    yield (height - 1) * width + x;
  }
  for (let y = 1; y < height - 1; y++) {
    yield y * width;
    yield y * width + width - 1;
  }
}

/**
 * The image against an opaque backdrop, and that backdrop's colour. A logo
 * with transparent edges gets white behind it when it is dark, black when it
 * is light; an opaque one keeps its own background (the edges' median).
 */
function flatten({ width, height, rgba }: Raster) {
  // Transparent when nearly all the border is see-through: a drawn background
  // can leave a soft, half-transparent last row, which does not count
  let clear = 0;
  let edges = 0;
  for (const i of edgePixels(width, height)) {
    if (rgba[i * 4 + 3] < 128) clear++;
    edges++;
  }
  const transparent = clear / edges > 0.75;
  const rgb = new Float32Array(width * height * 3);
  let backdrop: [number, number, number];
  if (transparent) {
    // The logo's own lightness, weighted by how opaque each pixel is
    let lum = 0;
    let weight = 0;
    for (let i = 0; i < width * height; i++) {
      const a = rgba[i * 4 + 3] / 255;
      lum += a * luminance(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      weight += a;
    }
    const dark = weight === 0 || lum / weight < 128;
    backdrop = dark ? [255, 255, 255] : [0, 0, 0];
    for (let i = 0; i < width * height; i++) {
      const a = rgba[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgba[i * 4 + c] * a + backdrop[c] * (1 - a);
    }
  } else {
    // The background: the median of the opaque border pixels
    const channels: number[][] = [[], [], []];
    for (const i of edgePixels(width, height))
      if (rgba[i * 4 + 3] >= 128)
        for (let c = 0; c < 3; c++) channels[c].push(rgba[i * 4 + c]);
    backdrop = channels.map((values) => {
      values.sort((a, b) => a - b);
      return values[values.length >> 1];
    }) as [number, number, number];
    // A half-transparent pixel shows the background through it
    for (let i = 0; i < width * height; i++) {
      const a = rgba[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = rgba[i * 4 + c] * a + backdrop[c] * (1 - a);
    }
  }
  return { rgb, backdrop };
}

/** Ink: how unlike the backdrop each pixel is, 0..255, soft edges kept */
function inkMask(width: number, height: number, rgb: Float32Array, backdrop: number[]) {
  const mask = new Uint8Array(width * height);
  const low = 28;
  const high = 84;
  for (let i = 0; i < width * height; i++) {
    const d = Math.max(
      Math.abs(rgb[i * 3] - backdrop[0]),
      Math.abs(rgb[i * 3 + 1] - backdrop[1]),
      Math.abs(rgb[i * 3 + 2] - backdrop[2]),
    );
    mask[i] = d <= low ? 0 : d >= high ? 255 : Math.round(((d - low) / (high - low)) * 255);
  }
  return mask;
}

/** Pixels over `threshold` reachable from the border, through such pixels */
function floodFromBorder(mask: Uint8Array, width: number, height: number, test: (v: number) => boolean) {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (const i of edgePixels(width, height))
    if (test(mask[i]) && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (!seen[n] && test(mask[n])) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return seen;
}

/**
 * A badge (a disc with a drawing in it): the drawing becomes the ink. The
 * disc's outside and its whole soft edge go with the background, so no faint
 * ring is left to be sized as if the disc were still there.
 */
function badgeMask(mask: Uint8Array, width: number, height: number) {
  // Everything the disc does not fully cover, reached from the border
  const outside = floodFromBorder(mask, width, height, (v) => v < 250);
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 255 - mask[i];
  return out;
}

/** The largest shape and everything inside its box: the emblem */
function emblemBox(mask: Uint8Array, width: number, height: number) {
  const label = new Int32Array(width * height).fill(-1);
  let best = { area: 0, x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] < 128 || label[start] !== -1) continue;
    const id = next++;
    const stack = [start];
    label[start] = id;
    let area = 0;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (mask[n] >= 128 && label[n] === -1) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    // The emblem is the shape with the largest box, not the most ink
    const box = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (box > (best.x1 - best.x0 + 1) * (best.y1 - best.y0 + 1) || best.area === 0)
      best = { area, x0, y0, x1, y1 };
  }
  return best;
}

/** The ink's bounding box, ignoring faint specks */
function inkBox(mask: Uint8Array, width: number, height: number) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[y * width + x] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** A one-channel image resized; it stays one channel */
async function resizeMask(mask: Uint8Array, width: number, height: number, w: number, h: number) {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error("A logo mask lost its single channel");
  return new Uint8Array(data);
}

export class LogoCardError extends Error {}

/**
 * The card for a logo, as a PNG. Throws LogoCardError when the file holds no
 * logo (a blank image, or one the background swallows whole).
 */
export async function renderLogoCard(input: Buffer, options: LogoCardOptions = {}): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const raster = await rasterize(input);
  const { width, height } = raster;
  const { rgb, backdrop } = flatten(raster);
  let mask = inkMask(width, height, rgb, backdrop);
  if (options.invert) mask = mask.map((v) => 255 - v);
  if (options.badge) mask = badgeMask(mask, width, height);

  let box = inkBox(mask, width, height);
  if (!box) throw new LogoCardError("No logo was found in this image");
  if (options.emblemOnly) {
    const emblem = emblemBox(mask, width, height);
    box = { x0: emblem.x0, y0: emblem.y0, x1: emblem.x1, y1: emblem.y1 };
  }
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;

  // Visual weight: the ink's area and centre of mass inside the box
  let ink = 0;
  let cx = 0;
  let cy = 0;
  const cropped = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const v = mask[(box.y0 + y) * width + box.x0 + x];
      cropped[y * bw + x] = v;
      ink += v / 255;
      cx += (v / 255) * (x + 0.5);
      cy += (v / 255) * (y + 0.5);
    }
  if (ink < 4) throw new LogoCardError("No logo was found in this image");
  cx /= ink;
  cy /= ink;

  const target =
    TARGET_INK_SHARE * LOGO_CARD_WIDTH * LOGO_CARD_HEIGHT *
    (options.size === 1 ? 1.3 : options.size === -1 ? 0.75 : 1);
  const scale = Math.min(
    Math.sqrt(target / ink),
    (MAX_LOGO_WIDTH * LOGO_CARD_WIDTH) / bw,
    (MAX_LOGO_HEIGHT * LOGO_CARD_HEIGHT) / bh,
  );
  const w = Math.max(1, Math.round(bw * scale));
  const h = Math.max(1, Math.round(bh * scale));
  const alpha = await resizeMask(cropped, bw, bh, w, h);

  // The centre of mass on the card's centre, the box kept inside the margins
  const margin = (1 - MAX_LOGO_WIDTH) / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const left = Math.round(
    clamp(LOGO_CARD_WIDTH / 2 - cx * scale, margin * LOGO_CARD_WIDTH, LOGO_CARD_WIDTH * (1 - margin) - w),
  );
  const top = Math.round(
    clamp(
      LOGO_CARD_HEIGHT / 2 - cy * scale,
      ((1 - MAX_LOGO_HEIGHT) / 2) * LOGO_CARD_HEIGHT,
      LOGO_CARD_HEIGHT * (1 - (1 - MAX_LOGO_HEIGHT) / 2) - h,
    ),
  );

  // The logo layer: one ink, or its own colours, with the mask as alpha
  const layer = Buffer.alloc(w * h * 4);
  let colours: Buffer | null = null;
  if (options.keepColours) {
    const crop = Buffer.alloc(bw * bh * 3);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++)
        for (let c = 0; c < 3; c++)
          crop[(y * bw + x) * 3 + c] = Math.round(rgb[((box.y0 + y) * width + box.x0 + x) * 3 + c]);
    colours = await sharp(crop, { raw: { width: bw, height: bh, channels: 3 } })
      .resize(w, h, { fit: "fill" })
      .raw()
      .toBuffer();
  }
  for (let i = 0; i < w * h; i++) {
    layer[i * 4] = colours ? colours[i * 3] : INK_RGB.r;
    layer[i * 4 + 1] = colours ? colours[i * 3 + 1] : INK_RGB.g;
    layer[i * 4 + 2] = colours ? colours[i * 3 + 2] : INK_RGB.b;
    layer[i * 4 + 3] = alpha[i];
  }

  return sharp({
    create: { width: LOGO_CARD_WIDTH, height: LOGO_CARD_HEIGHT, channels: 3, background: CARD_RGB },
  })
    .composite([{ input: layer, raw: { width: w, height: h, channels: 4 }, left, top }])
    .png()
    .toBuffer();
}

/**
 * The logo as received, kept beside its card so the switches can run again:
 * always pixels (an SVG is rasterized, never kept as SVG), lossless WebP like
 * every stored image, at most WORK_SIZE on its long side.
 */
export async function logoOriginal(input: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const { width, height, rgba } = await rasterize(input);
  return sharp(rgba, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toBuffer();
}
