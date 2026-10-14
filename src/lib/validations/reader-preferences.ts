import { z } from "zod/v4";
import { idSchema } from "./helpers";

export const DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export const deviceClassSchema = z.enum(DEVICE_CLASSES);
export type DeviceClass = z.infer<typeof deviceClassSchema>;

/** Decimal multiples are checked by Zod's decimal-safe multipleOf validator. */
const stepped = (min: number, max: number, step: number) =>
  z.number().min(min).max(max).multipleOf(step);

export const presentationSchema = z
  .object({
    font: z.enum([
      "literata",
      "garamond",
      "source-serif",
      "baskerville",
      "alegreya",
      "lora",
      "newsreader",
      "merriweather",
      "inter",
      "atkinson",
      "publisher",
    ]),
    fontSizePx: stepped(12, 40, 1),
    publisherScale: stepped(60, 250, 5),
    fontWeight: stepped(300, 600, 50),
    lineHeight: stepped(1.2, 2.4, 0.05),
    paragraphSpacingEm: stepped(0, 2, 0.25).nullable(),
    paragraphIndentEm: stepped(0, 3, 0.5).nullable(),
    letterSpacingEm: stepped(0, 0.1, 0.01),
    wordSpacingEm: stepped(0, 0.3, 0.05),
    textAlign: z.enum(["book", "start", "justify"]),
    hyphenate: z.boolean(),
    publisherStyles: z.boolean(),
    flow: z.enum(["paginated", "scrolled"]),
    spread: z.enum(["auto", "none", "both"]),
    marginPx: stepped(8, 96, 8),
    lineLength: z.enum(["narrow", "medium", "wide", "full"]),
    /** Fade crossfades a turn (SLN-660) */
    pageTurn: z.enum(["none", "slide", "fade"]),
    /** A tap or click in the page's edge strips turns it (SLN-662) */
    edgeTaps: z.boolean(),
    /** The toolbars stay up instead of hiding while reading (SLN-663) */
    pinBars: z.boolean(),
    theme: z.enum(["durtal-dark", "sepia", "paper"]),
    brightness: stepped(70, 100, 5),
    warmth: stepped(0, 100, 10),
    dimImages: z.boolean(),
    /** Fixed-format policies are applied by SLN-502; zoom stays session-local. */
    fixedFit: z.enum(["page", "width"]),
    cropMargins: z.enum(["auto", "on", "off"]),
    pdfThemePages: z.boolean(),
  })
  .strict();

export type ReaderPresentation = z.infer<typeof presentationSchema>;
export type PresentationOverride = Partial<ReaderPresentation>;

export const presentationOverrideSchema = presentationSchema
  .partial()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Change at least one reading setting",
  );

export const updateReaderPreferencesSchema = z
  .object({
    deviceClass: deviceClassSchema,
    ebookId: idSchema.nullable(),
    presentation: presentationOverrideSchema,
    /** Defaults and removal of these fields from the open book commit together. */
    clearBookOverrideId: idSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.clearBookOverrideId === undefined || value.ebookId === null,
    {
      message: "Only defaults can clear a book's overrides",
      path: ["clearBookOverrideId"],
    },
  );

export const resetReaderPreferencesSchema = z
  .object({
    deviceClass: deviceClassSchema,
    ebookId: idSchema.nullable(),
  })
  .strict();

/** The five actual choices offered by the old cookie's UI. */
export const legacyReaderSettingsSchema = z
  .object({
    fontFamily: z.enum(["sans", "serif", "system", "publisher"]),
    fontSize: z.union(
      [14, 16, 18, 20, 22, 24, 26, 28].map((n) => z.literal(n)),
    ),
    lineHeight: z.union([1.4, 1.6, 1.8, 2, 2.2, 2.4].map((n) => z.literal(n))),
    margin: z.union([4, 8, 12, 16, 20].map((n) => z.literal(n))),
    textAlign: z.enum(["left", "justify"]),
  })
  .strict();

/** Storage is forward compatible: salvage individual known fields, never throw. */
export function parseStoredPresentation(stored: unknown): PresentationOverride {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const parsed: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(presentationSchema.shape)) {
    const descriptor = Object.getOwnPropertyDescriptor(stored, name);
    // Do not invoke accessors while reading untrusted stored values.
    if (!descriptor || !("value" in descriptor)) continue;
    const result = schema.safeParse(descriptor.value);
    if (result.success) parsed[name] = result.data;
  }
  return parsed as PresentationOverride;
}
