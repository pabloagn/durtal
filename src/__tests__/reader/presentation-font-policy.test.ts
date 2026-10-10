import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHAR_WIDTH_EM,
  FONT_METRIC_SAMPLE,
  READER_FONT_FILES,
  READER_FONT_LICENCES,
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
  expect(css.match(/@font-face/g)).toHaveLength(36);
  expect(css.match(/font-display:block/g)).toHaveLength(36);
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
  for (const id of ["literata", "garamond", "inter"] as const) {
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
it("exports every versioned face and licence for a complete offline cache", () => {
  expect(READER_FONT_FILES).toHaveLength(36);
  expect(new Set(READER_FONT_FILES.map((file) => file.path)).size).toBe(36);
  expect(READER_FONT_LICENCES).toHaveLength(3);
  for (const family of ["literata", "eb-garamond", "inter"])
    for (const style of ["roman", "italic"]) {
      expect(
        READER_FONT_FILES.filter(
          (file) => file.family === family && file.style === style,
        ),
      ).toHaveLength(6);
    }
  for (const file of READER_FONT_FILES)
    expect(file.path).toBe(
      `/fonts/reader/v1/${file.family}/${file.family}-${file.style}-${file.subset}.woff2`,
    );
});
