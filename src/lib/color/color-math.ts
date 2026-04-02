/**
 * Pure math utilities for color space conversion and perceptual distance.
 * No external dependencies — all conversions are standard illuminant D65.
 */

// ── RGB ↔ HSL ───────────────────────────────────────────────────────────────

/** Convert RGB [0-255] to HSL [0-360, 0-100, 0-100]. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s * 100, l * 100];
}

/** Convert HSL [0-360, 0-100, 0-100] to RGB [0-255]. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  s /= 100;
  l /= 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// ── RGB → Lab (via XYZ, D65 illuminant) ─────────────────────────────────────

/** Convert RGB [0-255] to CIE Lab. */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  // Linearize sRGB
  let rl = r / 255;
  let gl = g / 255;
  let bl = b / 255;

  rl = rl > 0.04045 ? ((rl + 0.055) / 1.055) ** 2.4 : rl / 12.92;
  gl = gl > 0.04045 ? ((gl + 0.055) / 1.055) ** 2.4 : gl / 12.92;
  bl = bl > 0.04045 ? ((bl + 0.055) / 1.055) ** 2.4 : bl / 12.92;

  // RGB to XYZ (D65)
  let x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  let y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.0;
  let z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;

  // XYZ to Lab
  const epsilon = 0.008856;
  const kappa = 903.3;

  x = x > epsilon ? x ** (1 / 3) : (kappa * x + 16) / 116;
  y = y > epsilon ? y ** (1 / 3) : (kappa * y + 16) / 116;
  z = z > epsilon ? z ** (1 / 3) : (kappa * z + 16) / 116;

  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// ── Perceptual color distance ───────────────────────────────────────────────

/** CIE76 delta-E: Euclidean distance in Lab space. */
export function deltaE(
  rgb1: [number, number, number],
  rgb2: [number, number, number],
): number {
  const [l1, a1, b1] = rgbToLab(...rgb1);
  const [l2, a2, b2] = rgbToLab(...rgb2);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// ── HSL clamping for design-language conformance ────────────────────────────

export interface ClampOptions {
  minSaturation: number;  // HSL S floor (0-100)
  maxSaturation: number;  // HSL S ceiling (0-100)
  minLightness: number;   // HSL L floor (0-100)
  maxLightness: number;   // HSL L ceiling (0-100)
}

export const DURTAL_CLAMP: ClampOptions = {
  minSaturation: 12,
  maxSaturation: 65,
  minLightness: 18,
  maxLightness: 45,
};

/** Clamp an RGB color's saturation and lightness to the given bounds. */
export function clampColor(
  rgb: [number, number, number],
  opts: ClampOptions = DURTAL_CLAMP,
): [number, number, number] {
  const [h, s, l] = rgbToHsl(...rgb);
  const cs = Math.max(opts.minSaturation, Math.min(opts.maxSaturation, s));
  const cl = Math.max(opts.minLightness, Math.min(opts.maxLightness, l));
  return hslToRgb(h, cs, cl);
}

// ── Hex utilities ───────────────────────────────────────────────────────────

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")
  );
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
