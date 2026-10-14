import { expect, it } from "vitest";
import { paginatorAttributes } from "@/lib/reader/presentation/layout";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import type { ReadingFontMetrics } from "@/lib/reader/presentation/fonts";
import type { ReaderPresentation } from "@/lib/validations/reader-preferences";

// Synthetic inputs exercise the policy; these are not measurements of shipped assets.
const fontMetrics: ReadingFontMetrics = {
  literata: 0.48, garamond: 0.45, "source-serif": 0.46, baskerville: 0.5, alegreya: 0.42,
  lora: 0.47, newsreader: 0.43, merriweather: 0.49, inter: 0.52, atkinson: 0.47,
};
const attributes = (
  patch: Partial<ReaderPresentation> = {},
  width = 1440,
  height = 900,
  reducedMotion = false,
) =>
  paginatorAttributes(
    { ...PRESENTATION_DEFAULTS.desktop, ...patch },
    { width, height },
    { fontMetrics, reducedMotion },
  );

it.each([
  [999, 820, "1"],
  [1000, 820, "2"],
  [1180, 820, "2"],
  [768, 1024, "1"],
  [1100, 1100, "1"],
  [1000, 1400, "1"],
])("auto spreads at %d × %d use %s columns", (width, height, count) => {
  expect(attributes({}, width, height)["max-column-count"]).toBe(count);
});
it("follows explicit spread, scroll and reduced-motion choices", () => {
  expect(attributes({ spread: "none" })["max-column-count"]).toBe("1");
  expect(attributes({ spread: "both" }, 768, 1024)["max-column-count"]).toBe(
    "2",
  );
  expect(attributes({ spread: "both", flow: "scrolled" })).toMatchObject({
    flow: "scrolled",
    "max-column-count": "1",
    animated: false,
  });
  expect(attributes().animated).toBe(true);
  expect(attributes({}, 1440, 900, true).animated).toBe(false);
  expect(attributes({ pageTurn: "none" }).animated).toBe(false);
  expect(attributes()["turn-style"]).toBe("slide");
  // Fade crossfades a turn; reduced motion still swaps at once (SLN-660)
  expect(attributes({ pageTurn: "fade" })).toMatchObject({ animated: true, "turn-style": "fade" });
  expect(attributes({ pageTurn: "fade" }, 1440, 900, true).animated).toBe(false);
});
it.each([
  ["literata", "634px"],
  ["garamond", "594px"],
  ["inter", "686px"],
  ["publisher", "660px"],
] as const)(
  "sizes medium lines using %s's supplied advance",
  (font, expected) => {
    expect(attributes({ font })["max-inline-size"]).toBe(expected);
  },
);
it("uses scale for publisher styles and enforces minimum margins/gap", () => {
  expect(
    attributes({ publisherStyles: true, publisherScale: 150, fontSizePx: 40 })[
      "max-inline-size"
    ],
  ).toBe("792px");
  expect(
    attributes({ lineLength: "narrow", fontSizePx: 30 })["max-inline-size"],
  ).toBe("792px");
  expect(attributes({ lineLength: "wide" })["max-inline-size"]).toBe("768px");
  expect(attributes({ lineLength: "full", marginPx: 16 })).toMatchObject({
    "max-inline-size": "4000px",
    "margin-left": "16px",
    "margin-right": "16px",
    "column-gap": "32px",
  });
});
it("refuses invented/missing metrics or an invalid reading area", () => {
  expect(() =>
    paginatorAttributes(
      { ...PRESENTATION_DEFAULTS.desktop },
      { width: 1440, height: 900 },
      { reducedMotion: false, fontMetrics: { ...fontMetrics, literata: NaN } },
    ),
  ).toThrow(RangeError);
  expect(() => attributes({}, 0)).toThrow(RangeError);
});
