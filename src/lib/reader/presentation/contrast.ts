/** CSS colour math operates on encoded sRGB, while contrast uses linear light. */
type RGB = readonly [number, number, number];
export interface ColourFilter {
  brightness: number;
  warmth: number;
}
const NO_FILTER: ColourFilter = { brightness: 100, warmth: 0 };
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const linear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const encoded = (value: number) =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

function rgb(hex: string): RGB {
  if (/^#[\da-f]{3}$/i.test(hex))
    hex = `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
  if (!/^#[\da-f]{6}$/i.test(hex))
    throw new TypeError("Expected an opaque hexadecimal sRGB colour");
  return [1, 3, 5].map(
    (start) => parseInt(hex.slice(start, start + 2), 16) / 255,
  ) as unknown as RGB;
}
const hexOf = (value: RGB) =>
  `#${value
    .map((channel) =>
      Math.round(clamp(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const luminance = (value: RGB) =>
  0.2126 * linear(value[0]) +
  0.7152 * linear(value[1]) +
  0.0722 * linear(value[2]);

export function contrastRatio(a: string, b: string): number {
  const first = luminance(rgb(a));
  const second = luminance(rgb(b));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** CSS brightness(b) then sepia(0.4w), in the same order as the image filter. */
export function filterColour(
  hex: string,
  brightness: number,
  warmth: number,
): string {
  if (
    !Number.isFinite(brightness) ||
    brightness < 70 ||
    brightness > 100 ||
    !Number.isFinite(warmth) ||
    warmth < 0 ||
    warmth > 100
  )
    throw new RangeError("Brightness must be 70–100 and warmth 0–100");
  const [r, g, b] = rgb(hex).map((channel) => (channel * brightness) / 100);
  const amount = (0.4 * warmth) / 100;
  return hexOf([
    (1 - 0.607 * amount) * r + 0.769 * amount * g + 0.189 * amount * b,
    0.349 * amount * r + (1 - 0.314 * amount) * g + 0.168 * amount * b,
    0.272 * amount * r + 0.534 * amount * g + (1 - 0.869 * amount) * b,
  ]);
}

/** Match a translucent decoration's actual composited background in sRGB. */
export function compositeColour(
  foreground: string,
  background: string,
  opacity: number,
): string {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    throw new RangeError("Opacity must be between 0 and 1");
  const under = rgb(background);
  return hexOf(
    rgb(foreground).map(
      (channel, index) => opacity * channel + (1 - opacity) * under[index],
    ) as unknown as RGB,
  );
}

interface OKLCH {
  lightness: number;
  chroma: number;
  hue: number;
}

/** Hue/chroma allow rubrics to retain their meaning without retaining failing ink. */
export function colourInOKLCH(hex: string): OKLCH {
  const [r, g, b] = rgb(hex).map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    chroma: Math.hypot(a, bb),
    hue: Math.atan2(bb, a),
  };
}

function fromOKLCH({ lightness, chroma, hue }: OKLCH): RGB {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encoded(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encoded(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encoded(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Reduce chroma into gamut at fixed hue, rather than clipping RGB and shifting hue. */
function inGamut(colour: OKLCH): string {
  const valid = (channels: RGB) =>
    channels.every((channel) => channel >= 0 && channel <= 1);
  const original = fromOKLCH(colour);
  if (valid(original)) return hexOf(original);
  let low = 0;
  let high = colour.chroma;
  for (let i = 0; i < 24; i++) {
    const chroma = (low + high) / 2;
    if (valid(fromOKLCH({ ...colour, chroma }))) low = chroma;
    else high = chroma;
  }
  return hexOf(fromOKLCH({ ...colour, chroma: low }));
}

/** Returns unfiltered ink. Check contrast on exactly the filtered colours displayed. */
export function fitContrast(
  ink: string,
  background: string,
  text: string,
  filter: ColourFilter = NO_FILTER,
): string {
  const displayedBackground = filterColour(
    background,
    filter.brightness,
    filter.warmth,
  );
  const passes = (colour: string) =>
    contrastRatio(
      filterColour(colour, filter.brightness, filter.warmth),
      displayedBackground,
    ) >= 4.5;
  if (!passes(text))
    throw new RangeError("The theme's text does not meet 4.5:1 contrast");
  const source = colourInOKLCH(ink);
  if (source.chroma < 0.03) return text;
  if (passes(ink)) return ink;
  const target = colourInOKLCH(text).lightness;
  // Walk toward the theme's ink, preserving hue. Quantized sRGB need not be monotonic.
  for (let step = 1; step <= 256; step++) {
    const candidate = inGamut({
      ...source,
      lightness: source.lightness + ((target - source.lightness) * step) / 256,
    });
    if (passes(candidate)) return candidate;
  }
  // A saturated hue can still fail at the target's lightness. Retain its hue while
  // reducing chroma; the neutral theme ink is the final safe limit.
  for (let step = 1; step <= 256; step++) {
    const candidate = inGamut({
      ...source,
      lightness: target,
      chroma: source.chroma * (1 - step / 256),
    });
    if (passes(candidate)) return candidate;
  }
  return text;
}

/** Keep the page's text unchanged when a filtered selection/highlight is too dark. */
export function fitBackgroundContrast(
  fill: string,
  background: string,
  text: string,
  filter: ColourFilter = NO_FILTER,
  opacity = 1,
): string {
  const displayedText = filterColour(text, filter.brightness, filter.warmth);
  const displayedBackground = filterColour(
    background,
    filter.brightness,
    filter.warmth,
  );
  const passes = (colour: string) =>
    contrastRatio(
      displayedText,
      compositeColour(
        filterColour(colour, filter.brightness, filter.warmth),
        displayedBackground,
        opacity,
      ),
    ) >= 4.5;
  if (!passes(background))
    throw new RangeError("The theme's text does not meet 4.5:1 contrast");
  if (passes(fill)) return fill;
  const source = colourInOKLCH(fill);
  const target = colourInOKLCH(background).lightness;
  for (let step = 1; step <= 256; step++) {
    const candidate = inGamut({
      ...source,
      lightness: source.lightness + ((target - source.lightness) * step) / 256,
    });
    if (passes(candidate)) return candidate;
  }
  for (let step = 1; step <= 256; step++) {
    const candidate = inGamut({
      ...source,
      lightness: target,
      chroma: source.chroma * (1 - step / 256),
    });
    if (passes(candidate)) return candidate;
  }
  return background;
}
