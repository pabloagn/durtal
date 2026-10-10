import { expect, it } from "vitest";
import { fromLegacyReaderSettings } from "@/lib/reader/presentation/legacy";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import {
  DEVICE_CLASSES,
  presentationSchema,
} from "@/lib/validations/reader-preferences";

const old = {
  fontFamily: "serif",
  fontSize: 22,
  lineHeight: 1.8,
  margin: 12,
  textAlign: "left",
};
it.each([
  ["sans", "inter"],
  ["system", "inter"],
  ["serif", "garamond"],
  ["publisher", "publisher"],
])("adopts %s as %s", (fontFamily, expected) => {
  const presentation = fromLegacyReaderSettings(
    { ...old, fontFamily },
    "desktop",
  );
  expect(presentation).toEqual({
    ...PRESENTATION_DEFAULTS.desktop,
    font: expected,
    fontSizePx: 22,
    lineHeight: 1.8,
    marginPx: 48,
    textAlign: "start",
  });
  expect(presentationSchema.safeParse(presentation).success).toBe(true);
});
it.each([4, 8, 12, 16, 20])(
  "maps the old %d percent margin into pixels",
  (margin) => {
    expect(
      fromLegacyReaderSettings(
        { ...old, margin, textAlign: "justify" },
        "phone",
      ),
    ).toMatchObject({
      marginPx: margin * 4,
      textAlign: "justify",
      spread: "none",
      lineLength: "full",
    });
  },
);
it.each(DEVICE_CLASSES)(
  "uses %s defaults for malformed cookies",
  (deviceClass) => {
    for (const value of [
      null,
      "{broken",
      [],
      {},
      { ...old, fontSize: 19 },
      { ...old, lineHeight: 9 },
      { ...old, fontFamily: "Literata" },
      { ...old, margin: 13 },
    ]) {
      expect(fromLegacyReaderSettings(value, deviceClass)).toEqual(
        PRESENTATION_DEFAULTS[deviceClass],
      );
      expect(fromLegacyReaderSettings(value, deviceClass)).not.toBe(
        PRESENTATION_DEFAULTS[deviceClass],
      );
    }
  },
);
