import { expect, it } from "vitest";
import {
  FONT_METRIC_SAMPLE,
  READER_FONT_FILES,
  READER_FONT_LICENCES,
  readingFontStack,
} from "@/lib/reader/presentation/fonts";

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
