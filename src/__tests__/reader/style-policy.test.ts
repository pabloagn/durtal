import { expect, it } from "vitest";
import {
  adaptTypographyDeclaration,
  fontSizeInEm,
} from "@/lib/reader/presentation/style-policy";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";

it.each([
  ["12pt", "1em"],
  ["10px", "0.625em"],
  ["24PX", "1.5em"],
  [" 9pt ", "0.75em"],
  [".5px", "0.03125em"],
  ["1.5em", "1.5em"],
  ["120%", "120%"],
  ["calc(1rem + 2px)", "calc(1rem + 2px)"],
  ["var(--size)", "var(--size)"],
])("converts absolute %s into proportional %s", (original, expected) => {
  expect(fontSizeInEm(original)).toBe(expected);
});
it("keeps publisher, inline and protected drop-cap sizes untouched", () => {
  const p = { ...PRESENTATION_DEFAULTS.desktop };
  expect(adaptTypographyDeclaration("font-size", "12pt", p)).toBe("1em");
  expect(
    adaptTypographyDeclaration("font-size", "12pt", {
      ...p,
      publisherStyles: true,
    }),
  ).toBe("12pt");
  expect(
    adaptTypographyDeclaration("font-size", "48px", p, { inline: true }),
  ).toBe("48px");
  expect(
    adaptTypographyDeclaration("font-size", "48px", p, {
      protectedTypography: true,
    }),
  ).toBe("48px");
  // Both outputs derive from the same baseline; toggling never uses the 1em result.
  expect(
    adaptTypographyDeclaration("font-size", "12pt", {
      ...p,
      publisherStyles: true,
    }),
  ).toBe("12pt");
});
it.each(["left", "start", "justify", " LEFT "])(
  "rewrites body alignment %s without moving centred titles",
  (alignment) => {
    expect(
      adaptTypographyDeclaration("text-align", alignment, {
        ...PRESENTATION_DEFAULTS.desktop,
        textAlign: "start",
      }),
    ).toBe("start");
    expect(
      adaptTypographyDeclaration("text-align", alignment, {
        ...PRESENTATION_DEFAULTS.desktop,
        textAlign: "book",
      }),
    ).toBe(alignment);
  },
);
it.each(["center", "right", "end", "var(--alignment)"])(
  "preserves exceptional alignment %s",
  (alignment) => {
    expect(
      adaptTypographyDeclaration("text-align", alignment, {
        ...PRESENTATION_DEFAULTS.desktop,
      }),
    ).toBe(alignment);
  },
);
it.each([
  "font-feature-settings",
  "font-variant-caps",
  "font-kerning",
  "font-synthesis",
  "float",
])("preserves the book's %s", (property) => {
  expect(
    adaptTypographyDeclaration(property, "original", {
      ...PRESENTATION_DEFAULTS.desktop,
    }),
  ).toBe("original");
});
