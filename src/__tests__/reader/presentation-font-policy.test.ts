import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAR_WIDTH_EM,
  FONT_METRIC_SAMPLE,
  READER_FONT_FILES,
  READER_FONT_LICENCES,
  READER_FONT_PREVIEWS,
  READER_FONTS,
  readerFontPreviewCSS,
  readingFontStack,
  fontFaceCSS,
  readerLatinFace,
  readerFontCapabilityNote,
} from "@/lib/reader/presentation/fonts";
import metrics from "@/lib/reader/presentation/font-metrics.json";

it("names reading families separately from publisher and host fonts", () => {
  expect(readingFontStack("literata")).toBe(
    '"Durtal Literata", Georgia, serif',
  );
  expect(readingFontStack("garamond")).toBe(
    '"Durtal EB Garamond", Georgia, serif',
  );
  expect(readingFontStack("inter")).toBe(
    '"Durtal Inter", system-ui, sans-serif',
  );
  expect(readingFontStack("publisher")).toBeNull();
  expect(FONT_METRIC_SAMPLE.length).toBeGreaterThan(100);
});

it("ships every immutable asset with matching WOFF2 bytes and SHA-256", () => {
  for (const file of READER_FONT_FILES) {
    const data = readFileSync(resolve("public", file.path.slice(1)));
    expect(data.subarray(0, 4).toString()).toBe("wOF2");
    expect(data.length).toBe(file.bytes);
    expect(createHash("sha256").update(data).digest("hex")).toBe(file.sha256);
  }
});
it("uses absolute origin URLs and the actual shipped weight ranges", () => {
  const css = fontFaceCSS("https://reader.example/");
  expect(css.match(/@font-face/g)).toHaveLength(READER_FONT_FILES.length);
  expect(css.match(/font-display:block/g)).toHaveLength(READER_FONT_FILES.length);
  for (const file of READER_FONT_FILES) {
    expect(css).toContain(`url("https://reader.example${file.path}")`);
    expect(css).toContain(
      `font-weight:${file.axes.wght.min} ${file.axes.wght.max}`,
    );
    expect(css).toContain(`unicode-range:${file.unicodeRange}`);
  }
  for (const origin of [
    "data:text/css,body{}",
    "javascript:alert(1)",
    "file:///tmp/",
    "https://user:secret@reader.example",
    "https://reader.example/path",
    "https://reader.example/?x=1",
    "https://reader.example/#x",
  ])
    expect(() => fontFaceCSS(origin)).toThrow();
});
it("binds measured advances to the actual shipped Latin roman file", () => {
  expect(metrics.sample).toBe(FONT_METRIC_SAMPLE);
  const ids = Object.keys(READER_FONTS).filter((id) => id !== "publisher") as (keyof typeof CHAR_WIDTH_EM)[];
  expect(Object.keys(metrics.fonts).sort()).toEqual([...ids].sort());
  for (const id of ids) {
    const face = READER_FONT_FILES.find(
      (file) =>
        file.id === id && file.style === "roman" && file.subset === "latin",
    )!;
    expect(readerLatinFace(id)).toBe(face.path);
    expect(metrics.fonts[id].assetSha256).toBe(face.sha256);
    expect(CHAR_WIDTH_EM[id]).toBe(
      metrics.fonts[id].widthPx /
        [...FONT_METRIC_SAMPLE].length /
        metrics.fontSizePx,
    );
    expect(CHAR_WIDTH_EM[id]).toBeGreaterThan(0);
  }
  expect(readerLatinFace("publisher")).toBeNull();
});
it("reports the actual source limitations without changing the requested control value", () => {
  expect(readerFontCapabilityNote("garamond", 300)).toContain("use 400");
  expect(readerFontCapabilityNote("garamond", 400)).toBeNull();
  expect(readerFontCapabilityNote("inter", 400)).toContain(
    "no native small caps",
  );
  expect(readerFontCapabilityNote("publisher", 300)).toBeNull();
  expect(readerFontCapabilityNote("baskerville", 300)).toBe(
    "Baskerville starts at weight 400. Lower weights use 400.",
  );
  expect(readerFontCapabilityNote("source-serif", 300)).toBeNull();
  for (const family of ["literata", "eb-garamond"])
    for (const style of ["roman", "italic"])
      expect(
        READER_FONT_FILES.find(
          (file) =>
            file.family === family &&
            file.style === style &&
            file.subset === "latin",
        )!.features,
      ).toEqual(expect.arrayContaining(["smcp", "c2sc", "onum", "liga"]));
});
// Families with fewer than 32 characters of a script ship no file for it.
const SCRIPTS: Record<string, string[]> = {
  literata: ["latin", "latin-ext", "greek", "greek-ext", "cyrillic", "cyrillic-ext"],
  "eb-garamond": ["latin", "latin-ext", "greek", "greek-ext", "cyrillic", "cyrillic-ext"],
  inter: ["latin", "latin-ext", "greek", "greek-ext", "cyrillic", "cyrillic-ext"],
  "source-serif-4": ["latin", "latin-ext", "greek", "cyrillic", "cyrillic-ext"],
  alegreya: ["latin", "latin-ext", "greek", "greek-ext", "cyrillic", "cyrillic-ext"],
  "cyreal-serif": ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  "sorkin-serif": ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  newsreader: ["latin", "latin-ext"],
  baskerville: ["latin", "latin-ext"],
  "atkinson-hyperlegible": ["latin", "latin-ext"],
};
it("exports every versioned face and licence for a complete offline cache", () => {
  const total = Object.values(SCRIPTS).reduce((sum, scripts) => sum + scripts.length * 2, 0);
  expect(READER_FONT_FILES).toHaveLength(total);
  expect(new Set(READER_FONT_FILES.map((file) => file.path)).size).toBe(total);
  expect(READER_FONT_LICENCES).toHaveLength(10);
  for (const [family, scripts] of Object.entries(SCRIPTS))
    for (const style of ["roman", "italic"]) {
      expect(
        READER_FONT_FILES.filter(
          (file) => file.family === family && file.style === style,
        ).map((file) => file.subset).sort(),
      ).toEqual([...scripts].sort());
    }
  for (const file of READER_FONT_FILES)
    expect(file.path).toBe(
      `/fonts/reader/v1/${file.family}/${file.family}-${file.style}-${file.subset}.woff2`,
    );
});
it("never ships a Reserved Font Name as a modified font's name", () => {
  const reserved = /lora|merriweather|libre.?baskerville/i;
  for (const font of Object.values(READER_FONTS)) expect(`${font.label} ${font.family}`).not.toMatch(reserved);
  for (const file of [...READER_FONT_FILES, ...READER_FONT_PREVIEWS])
    expect(`${file.cssFamily} ${file.path}`).not.toMatch(reserved);
});
it("previews each family's name from a small file of only its letters", () => {
  const ids = Object.values(READER_FONTS).filter((font) => font.family).map((font) => font.id);
  expect(READER_FONT_PREVIEWS.map((preview) => preview.id).sort()).toEqual([...ids].sort());
  const css = readerFontPreviewCSS("https://reader.example");
  for (const preview of READER_FONT_PREVIEWS) {
    const font = READER_FONTS[preview.id as keyof typeof READER_FONTS];
    expect(preview.text).toBe(font.label);
    expect(preview.cssFamily).toBe(font.family);
    expect(preview.bytes).toBeLessThan(8_000);
    const data = readFileSync(resolve("public", preview.path.slice(1)));
    expect(createHash("sha256").update(data).digest("hex")).toBe(preview.sha256);
    expect(css).toContain(`url("https://reader.example${preview.path}")`);
  }
});
