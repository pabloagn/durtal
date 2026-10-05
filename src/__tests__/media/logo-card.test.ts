import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  LOGO_CARD_HEIGHT,
  LOGO_CARD_WIDTH,
  LogoCardError,
  renderLogoCard,
} from "@/lib/media/logo-card";

/** Logos drawn like the examples in SLN-441, as SVG */
const svg = (body: string, w = 400, h = 400, bg?: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${
      bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ""
    }${body}</svg>`,
  );
/** Penguin-like: an orange oval, a black body, a white belly */
const penguin = (bg?: string) =>
  svg(
    `<ellipse cx="200" cy="200" rx="150" ry="190" fill="#f37021"/>
     <ellipse cx="200" cy="215" rx="90" ry="150" fill="#111"/>
     <ellipse cx="200" cy="245" rx="50" ry="100" fill="#fff"/>`,
    400,
    400,
    bg,
  );
/** NYRB-like: white letters on dark grey */
const nyrb = svg(
  `<rect x="60" y="140" width="60" height="120" fill="#fff"/><rect x="150" y="140" width="60" height="120" fill="#fff"/>
   <rect x="240" y="140" width="60" height="120" fill="#fff"/><rect x="330" y="140" width="40" height="120" fill="#fff"/>`,
  430,
  400,
  "#333333",
);
/** New Directions-like: a black disc with a white drawing in it */
const disc = svg(
  `<circle cx="200" cy="200" r="180" fill="#000"/>
   <path d="M120 260 L200 120 L280 260 Z" fill="none" stroke="#fff" stroke-width="14"/>`,
  400,
  400,
  "#ffffff",
);
/** A wide wordmark and a round emblem */
const wordmark = svg(`<rect x="20" y="80" width="1160" height="40" fill="#000"/>`, 1200, 200, "#fff");
const emblem = svg(`<circle cx="200" cy="200" r="120" fill="#000"/>`, 400, 400, "#fff");

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[(Math.round(y) * info.width + Math.round(x)) * info.channels];
  let ink = 0;
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const v = data[(y * info.width + x) * info.channels];
      ink += v / 255;
      if (v > 64) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  return { info, at, ink, box: { x0, y0, x1, y1 } };
}

describe("logo cards (SLN-441)", () => {
  it("makes one template: a 3:2 black card with the logo in light ink", async () => {
    const card = await pixels(await renderLogoCard(penguin("#ffffff")));
    expect([card.info.width, card.info.height]).toEqual([LOGO_CARD_WIDTH, LOGO_CARD_HEIGHT]);
    expect(card.at(5, 5)).toBe(0);
    // The orange and black become ink
    expect(card.at(card.box.x0 + 8, (card.box.y0 + card.box.y1) / 2)).toBeGreaterThan(200);
  });

  it("cuts out an inner detail that matches the background (Penguin's belly)", async () => {
    const card = await pixels(await renderLogoCard(penguin("#ffffff")));
    const midX = (card.box.x0 + card.box.x1) / 2;
    // The belly sits below the middle of the logo
    const bellyY = card.box.y0 + (card.box.y1 - card.box.y0) * 0.64;
    expect(card.at(midX, bellyY)).toBeLessThan(40);
  });

  it("judges a transparent logo against the right backdrop, so the belly stays cut out", async () => {
    const card = await pixels(await renderLogoCard(penguin()));
    const midX = (card.box.x0 + card.box.x1) / 2;
    const bellyY = card.box.y0 + (card.box.y1 - card.box.y0) * 0.64;
    expect(card.at(midX, bellyY)).toBeLessThan(40);
  });

  it("takes the light letters of a logo on a dark background as ink (NYRB)", async () => {
    const card = await pixels(await renderLogoCard(nyrb));
    expect(card.ink).toBeGreaterThan(1000);
    expect(card.at(5, 5)).toBe(0);
  });

  it("gives a wide wordmark and a round emblem the same visual weight, centred", async () => {
    const wide = await pixels(await renderLogoCard(wordmark));
    const round = await pixels(await renderLogoCard(emblem));
    // The wordmark stops at the width limit; it never takes more ink than the emblem
    expect(round.ink).toBeGreaterThan(0.07 * LOGO_CARD_WIDTH * LOGO_CARD_HEIGHT);
    expect(round.ink).toBeLessThan(0.1 * LOGO_CARD_WIDTH * LOGO_CARD_HEIGHT);
    expect(wide.box.x1 - wide.box.x0).toBeLessThanOrEqual(0.75 * LOGO_CARD_WIDTH);
    expect(wide.ink).toBeLessThanOrEqual(round.ink * 1.05);
    for (const card of [wide, round]) {
      expect(Math.abs((card.box.x0 + card.box.x1) / 2 - LOGO_CARD_WIDTH / 2)).toBeLessThan(4);
      expect(Math.abs((card.box.y0 + card.box.y1) / 2 - LOGO_CARD_HEIGHT / 2)).toBeLessThan(4);
    }
  });

  it("badge: keeps the drawing in a disc, with no faint ring, at full size", async () => {
    const plain = await pixels(await renderLogoCard(disc));
    const badge = await pixels(await renderLogoCard(disc, { badge: true }));
    // The disc is gone: its middle was ink, and is now the drawing's empty inside
    const at = (card: typeof plain, fy: number) =>
      card.at((card.box.x0 + card.box.x1) / 2, card.box.y0 + (card.box.y1 - card.box.y0) * fy);
    expect(at(plain, 0.5)).toBeGreaterThan(200);
    // The triangle's inside, at its centroid
    expect(at(badge, 0.66)).toBeLessThan(40);
    // No ring: nothing lights up near the card's edges of the old disc
    let ring = 0;
    for (let x = 0; x < LOGO_CARD_WIDTH; x += 2) ring += badge.at(x, 10) + badge.at(x, LOGO_CARD_HEIGHT - 10);
    expect(ring).toBe(0);
    // The drawing is sized as itself, not as the disc
    expect(badge.box.y1 - badge.box.y0).toBeGreaterThan(0.4 * LOGO_CARD_HEIGHT);
  });

  it("switches: bigger and smaller, invert, keep colours, emblem only", async () => {
    const normal = await pixels(await renderLogoCard(emblem));
    const bigger = await pixels(await renderLogoCard(emblem, { size: 1 }));
    const smaller = await pixels(await renderLogoCard(emblem, { size: -1 }));
    expect(bigger.ink).toBeGreaterThan(normal.ink);
    expect(smaller.ink).toBeLessThan(normal.ink);
    const coloured = await sharp(await renderLogoCard(penguin("#ffffff"), { keepColours: true }))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { data, info } = coloured;
    let orange = 0;
    for (let i = 0; i < info.width * info.height; i++)
      if (data[i * 3] > 200 && data[i * 3 + 1] > 80 && data[i * 3 + 1] < 140 && data[i * 3 + 2] < 70) orange++;
    expect(orange).toBeGreaterThan(1000);
    const withWords = svg(
      `<circle cx="200" cy="150" r="100" fill="#000"/><rect x="20" y="300" width="360" height="30" fill="#000"/>`,
      400,
      400,
      "#fff",
    );
    const emblemOnly = await pixels(await renderLogoCard(withWords, { emblemOnly: true }));
    const whole = await pixels(await renderLogoCard(withWords));
    expect(emblemOnly.box.x1 - emblemOnly.box.x0).toBeLessThan(whole.box.x1 - whole.box.x0);
  });

  it("keeps a drawn background a background when its last row is half transparent", async () => {
    // Black letters on white, the border softened as a rasterized SVG can leave it
    const { data, info } = await sharp(svg(`<rect x="100" y="150" width="400" height="80" fill="#000"/>`, 600, 400, "#fff"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let x = 0; x < info.width; x++) data[((info.height - 1) * info.width + x) * 4 + 3] = 100;
    for (let y = 0; y < info.height; y++) data[(y * info.width + info.width - 1) * 4 + 3] = 100;
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    const card = await pixels(await renderLogoCard(png));
    // The bar is the ink, not the white around it
    expect((card.box.x1 - card.box.x0) / (card.box.y1 - card.box.y0)).toBeGreaterThan(4);
  });

  it("refuses an image with no logo", async () => {
    await expect(renderLogoCard(svg("", 200, 200, "#ffffff"))).rejects.toBeInstanceOf(LogoCardError);
  });

  it("reads PNG and JPG too", async () => {
    const png = await sharp(penguin("#ffffff")).png().toBuffer();
    const jpg = await sharp(penguin("#ffffff")).flatten({ background: "#fff" }).jpeg().toBuffer();
    for (const file of [png, jpg]) {
      const card = await pixels(await renderLogoCard(file));
      expect(card.ink).toBeGreaterThan(1000);
    }
  });
});
