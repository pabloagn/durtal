import { describe, expect, it } from "vitest";
import {
  DEVICE_CLASSES,
  parseStoredPresentation,
  presentationSchema,
  presentationOverrideSchema,
  updateReaderPreferencesSchema,
} from "@/lib/validations/reader-preferences";
import {
  effectivePresentation,
  PRESENTATION_DEFAULTS,
  presentationFieldScope,
} from "@/lib/reader/presentation/defaults";

const numeric = [
  ["fontSizePx", 12, 40, 11, 41, 20.5],
  ["publisherScale", 60, 250, 55, 255, 102],
  ["fontWeight", 300, 600, 250, 650, 425],
  ["lineHeight", 1.2, 2.4, 1.15, 2.45, 1.27],
  ["paragraphSpacingEm", 0, 2, -0.25, 2.25, 0.1],
  ["paragraphIndentEm", 0, 3, -0.5, 3.5, 0.1],
  ["letterSpacingEm", 0, 0.1, -0.01, 0.11, 0.005],
  ["wordSpacingEm", 0, 0.3, -0.05, 0.35, 0.01],
  ["marginPx", 8, 96, 0, 104, 20],
  ["brightness", 70, 100, 65, 105, 72],
  ["warmth", 0, 100, -10, 110, 15],
] as const;

describe("presentation validation", () => {
  it.each(DEVICE_CLASSES)("has a complete valid %s default", (device) => {
    expect(presentationSchema.parse(PRESENTATION_DEFAULTS[device])).toEqual(
      PRESENTATION_DEFAULTS[device],
    );
  });
  it.each(numeric)(
    "enforces both bounds and the step for %s",
    (key, min, max, below, above, offStep) => {
      for (const value of [min, max])
        expect(
          presentationOverrideSchema.safeParse({ [key]: value }).success,
        ).toBe(true);
      for (const value of [
        below,
        above,
        offStep,
        NaN,
        Infinity,
        "20",
        undefined,
      ])
        expect(
          presentationOverrideSchema.safeParse({ [key]: value }).success,
        ).toBe(false);
    },
  );
  it("accepts decimal steps without rounding them into a different input", () => {
    expect(
      presentationOverrideSchema.parse({
        lineHeight: 1.25,
        letterSpacingEm: 0.07,
        wordSpacingEm: 0.15,
      }),
    ).toEqual({ lineHeight: 1.25, letterSpacingEm: 0.07, wordSpacingEm: 0.15 });
    expect(
      presentationOverrideSchema.safeParse({ lineHeight: 1.2500000001 })
        .success,
    ).toBe(false);
  });
  it("keeps Book's spacing distinct from zero and rejects empty/unknown patches", () => {
    expect(
      presentationOverrideSchema.parse({
        paragraphSpacingEm: null,
        paragraphIndentEm: 0,
      }),
    ).toEqual({ paragraphSpacingEm: null, paragraphIndentEm: 0 });
    for (const patch of [
      {},
      { fontSizePx: undefined },
      { brightness: null },
      { unknown: true },
      { dimImages: "false" },
      { font: "serif" },
      { flow: "continuous" },
      { theme: "light" },
    ])
      expect(presentationOverrideSchema.safeParse(patch).success).toBe(false);
    expect(presentationSchema.safeParse({ fontSizePx: 20 }).success).toBe(
      false,
    );
  });
  it("validates defaults clearing as one scoped request", () => {
    const bookId = "e181d6cb-20f9-4a30-b7cb-0783986ea477";
    const defaults = {
      deviceClass: "desktop",
      ebookId: null,
      presentation: { fontSizePx: 23 },
      clearBookOverrideId: bookId,
    };
    expect(updateReaderPreferencesSchema.safeParse(defaults).success).toBe(
      true,
    );
    for (const input of [
      { ...defaults, deviceClass: "watch" },
      { ...defaults, ebookId: bookId },
      { ...defaults, clearBookOverrideId: "book" },
      { ...defaults, extra: 1 },
    ])
      expect(updateReaderPreferencesSchema.safeParse(input).success).toBe(
        false,
      );
  });
  it("validates the shared fixed-format fields without persisting session zoom", () => {
    expect(PRESENTATION_DEFAULTS.desktop.fixedFit).toBe("page");
    expect(PRESENTATION_DEFAULTS.tablet.fixedFit).toBe("page");
    expect(PRESENTATION_DEFAULTS.phone.fixedFit).toBe("width");
    expect(
      presentationOverrideSchema.parse({
        fixedFit: "width",
        cropMargins: "off",
        pdfThemePages: false,
      }),
    ).toEqual({ fixedFit: "width", cropMargins: "off", pdfThemePages: false });
    for (const patch of [
      { fixedFit: "height" },
      { cropMargins: true },
      { pdfThemePages: 1 },
      { zoom: 2 },
    ]) {
      expect(presentationOverrideSchema.safeParse(patch).success).toBe(false);
    }
  });
});

describe("stored presentation recovery", () => {
  it("salvages valid fields independently, including null and false", () => {
    expect(
      parseStoredPresentation({
        fontSizePx: 22,
        lineHeight: 9,
        dimImages: false,
        paragraphIndentEm: null,
        future: 123,
      }),
    ).toEqual({ fontSizePx: 22, dimImages: false, paragraphIndentEm: null });
    for (const malformed of [null, undefined, [], "garbage", 4])
      expect(parseStoredPresentation(malformed)).toEqual({});
    expect(parseStoredPresentation(Object.create({ fontSizePx: 22 }))).toEqual(
      {},
    );
    const accessor = Object.defineProperty({}, "fontSizePx", {
      get: () => {
        throw new Error("Never run");
      },
    });
    expect(parseStoredPresentation(accessor)).toEqual({});
  });
  it("layers by scope regardless of row order, without changing saved/default values", () => {
    const rows = [
      {
        deviceClass: "desktop" as const,
        ebookId: "book",
        presentation: { fontSizePx: 25, theme: "sepia", lineHeight: 8 },
      },
      {
        deviceClass: "phone" as const,
        ebookId: null,
        presentation: { fontSizePx: 14 },
      },
      {
        deviceClass: "desktop" as const,
        ebookId: null,
        presentation: { fontSizePx: 22, lineHeight: 1.7 },
      },
    ];
    const before = JSON.stringify(rows);
    expect(effectivePresentation("desktop", rows)).toEqual({
      ...PRESENTATION_DEFAULTS.desktop,
      fontSizePx: 25,
      theme: "sepia",
      lineHeight: 1.7,
    });
    expect(effectivePresentation("tablet", rows)).toEqual(
      PRESENTATION_DEFAULTS.tablet,
    );
    expect(presentationFieldScope("fontSizePx", "desktop", rows)).toBe("book");
    expect(presentationFieldScope("lineHeight", "desktop", rows)).toBeNull();
    expect(
      presentationFieldScope("publisherScale", "desktop", rows),
    ).toBeNull();
    expect(JSON.stringify(rows)).toBe(before);
    expect(PRESENTATION_DEFAULTS.desktop.fontSizePx).toBe(20);
  });
  it("carries a laptop's settings from when it was classed as a tablet, under the desktop's own (SLN-686)", () => {
    const rows = [
      { deviceClass: "tablet" as const, ebookId: null, presentation: { marginPx: 64, theme: "paper" } },
      { deviceClass: "tablet" as const, ebookId: "book", presentation: { fontSizePx: 26 } },
      { deviceClass: "desktop" as const, ebookId: null, presentation: { theme: "sepia" } },
    ];
    expect(effectivePresentation("desktop", rows)).toEqual({
      ...PRESENTATION_DEFAULTS.desktop, marginPx: 64, fontSizePx: 26, theme: "sepia",
    });
    expect(effectivePresentation("phone", rows)).toEqual(PRESENTATION_DEFAULTS.phone);
  });
});
