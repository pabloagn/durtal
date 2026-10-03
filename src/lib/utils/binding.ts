/**
 * Bindings (task 0184). Sources send free text ("Mass Market Paperback",
 * "Leather Bound", "Kindle Edition"); the edition stores one of
 * BINDING_TYPES. Pure module.
 */
import { BINDING_TYPES, type BindingType } from "@/lib/types/index";

/** Formats that are not a printed binding: these never set one */
const NOT_PRINTED = /\b(kindle|e-?book|digital|online|audio\w*|cd|mp3|cassette|dvd|vinyl|unknown|calendar|map|cards?|poster)\b/i;

/** Checked in order: the first rule that matches decides */
const RULES: [RegExp, BindingType][] = [
  [/\b(spiral|ring|comb|wire-?o)\b/i, "spiral"],
  [/\bleather\w*\b/i, "leather"],
  [/\bcloth\w*\b/i, "cloth"],
  [/\b(board ?books?|boards)\b/i, "boards"],
  [/\b(wraps|wrappers?)\b/i, "wrappers"],
  [/\b(saddle[- ]?stitch\w*|stapled?|staple[- ]bound|pamphlet)\b/i, "saddle_stitch"],
  [/\b(hard ?(cover|back|bound)|library binding|textbook binding|turtleback)\b/i, "hardcover"],
  [/\b(paper ?back|soft ?(cover|back|bound)|mass market|bunko)\b/i, "paperback"],
];

/**
 * The stored binding for a source's text, or null when the text is empty,
 * names a format that is not a printed binding, or is not known.
 */
export function normalizeBinding(
  raw: string | null | undefined,
): BindingType | null {
  const text = raw?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return null;
  const code = text.replace(/[\s-]+/g, "_");
  if ((BINDING_TYPES as readonly string[]).includes(code))
    return code as BindingType;
  if (NOT_PRINTED.test(text)) return null;
  return RULES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** "saddle_stitch" → "Saddle stitch" */
export function bindingLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const text = code.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
