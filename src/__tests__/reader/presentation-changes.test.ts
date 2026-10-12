import { expect, it } from "vitest";
import { presentationChangeKind } from "@/lib/reader/presentation/changes";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";

it("distinguishes unchanged values, paint-only colour changes and combined reflow", () => {
  const p = { ...PRESENTATION_DEFAULTS.desktop };
  expect(presentationChangeKind(p, { ...p })).toBe("none");
  expect(
    presentationChangeKind(p, {
      ...p,
      theme: "paper",
      brightness: 70,
      warmth: 100,
      dimImages: true,
    }),
  ).toBe("colour");
  expect(
    presentationChangeKind(p, { ...p, theme: "paper", fontSizePx: 21 }),
  ).toBe("layout");
  expect(presentationChangeKind(p, { ...p, flow: "scrolled" })).toBe("layout");
  expect(presentationChangeKind(p, { ...p, publisherScale: 110 })).toBe(
    "layout",
  );
});
