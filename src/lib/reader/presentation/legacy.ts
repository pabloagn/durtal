import {
  legacyReaderSettingsSchema,
  type DeviceClass,
  type ReaderPresentation,
} from "@/lib/validations/reader-preferences";
import { PRESENTATION_DEFAULTS } from "./defaults";

/** Adoption accepts parsed cookie data; malformed cookies use this class's defaults. */
export function fromLegacyReaderSettings(
  legacy: unknown,
  deviceClass: DeviceClass,
): ReaderPresentation {
  const defaults = PRESENTATION_DEFAULTS[deviceClass];
  const parsed = legacyReaderSettingsSchema.safeParse(legacy);
  if (!parsed.success) return { ...defaults };
  const old = parsed.data;
  const fonts = {
    sans: "inter",
    system: "inter",
    serif: "garamond",
    publisher: "publisher",
  } as const;
  return {
    ...defaults,
    font: fonts[old.fontFamily],
    fontSizePx: old.fontSize,
    lineHeight: old.lineHeight,
    marginPx: old.margin * 4,
    textAlign: old.textAlign === "left" ? "start" : "justify",
  };
}
