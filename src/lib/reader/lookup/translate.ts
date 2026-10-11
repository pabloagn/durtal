import { MAX_TRANSLATION_CHARACTERS } from "./candidates";

export type TranslatorAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

/** Only policy: the eventual browser adapter supplies actual feature detection and availability. */
export function translationMode(
  source: string,
  target: string,
  available: TranslatorAvailability | null,
) {
  if (source === target) return "same-language" as const;
  if (available === "available") return "device" as const;
  if (available === "downloadable" || available === "downloading")
    return "download" as const;
  return "links" as const;
}

/** Verified provider language sets are supplied by the later integration, not inferred from keys. */
export function translationLinks(input: {
  source: string;
  target: string;
  text: string;
  deeplLanguages: ReadonlySet<string>;
  googleLanguages: ReadonlySet<string>;
}) {
  const { source, target, text } = input;
  if (!/^[a-z]{2,3}$/.test(source) || !/^[a-z]{2,3}$/.test(target))
    throw new Error("Invalid translation language");
  if (!text.trim() || text.length > MAX_TRANSLATION_CHARACTERS)
    return { deepl: null, google: null };
  const encoded = encodeURIComponent(text);
  return {
    deepl:
      input.deeplLanguages.has(source) && input.deeplLanguages.has(target)
        ? `https://www.deepl.com/translator#${encodeURIComponent(source)}/${encodeURIComponent(target)}/${encoded}`
        : null,
    google: input.googleLanguages.has(target)
      ? `https://translate.google.com/?sl=${input.googleLanguages.has(source) ? encodeURIComponent(source) : "auto"}&tl=${encodeURIComponent(target)}&text=${encoded}&op=translate`
      : null,
  };
}
