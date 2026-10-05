import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderLogoCard } from "@/lib/media/logo-card";

const svg = (body: string, w: number, h: number, bg: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`,
  );

async function measure(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let peak = 0;
  let x0 = info.width, x1 = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const v = data[(y * info.width + x) * info.channels];
      peak = Math.max(peak, v);
      if (v > 64) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    }
  return { peak, width: x1 - x0 };
}

describe("logo cards, review fixes (SLN-441)", () => {
  it("turns a dark logo on black into full ink, as bright as a white one", async () => {
    const disc = (fill: string) => svg(`<circle cx="200" cy="200" r="120" fill="${fill}"/>`, 400, 400, "#000");
    const white = await measure(await renderLogoCard(disc("#fff")));
    const dark = await measure(await renderLogoCard(disc("#2a2a2a")));
    expect(dark.peak).toBe(white.peak);
  });

  it("makes a wide wordmark held by the width cap smaller with Smaller", async () => {
    const wordmark = svg(`<rect x="20" y="80" width="1160" height="40" fill="#000"/>`, 1200, 200, "#fff");
    const normal = await measure(await renderLogoCard(wordmark));
    const smaller = await measure(await renderLogoCard(wordmark, { size: -1 }));
    const bigger = await measure(await renderLogoCard(wordmark, { size: 1 }));
    expect(smaller.width).toBeLessThan(normal.width * 0.9);
    // Bigger stops at the cap
    expect(Math.abs(bigger.width - normal.width)).toBeLessThanOrEqual(2);
  });
});
