import {
  lookupSettingsSchema,
  lookupSourceSchema,
  type LookupSettings,
  type LookupSource,
} from "@/lib/validations/reader-lookup";

const LEGACY_DEFAULT_SOURCES: readonly LookupSource[] = [
  {
    language: "la",
    name: "Logeion",
    url: "https://logeion.uchicago.edu/{word}",
  },
  {
    language: "la",
    name: "Perseus Word Study",
    url: "https://www.perseus.tufts.edu/hopper/morph?l={word}&la=la",
  },
  {
    language: "grc",
    name: "Logeion",
    url: "https://logeion.uchicago.edu/{word}",
  },
  {
    language: "grc",
    name: "Perseus Word Study",
    url: "https://www.perseus.tufts.edu/hopper/morph?l={word}&la=greek",
  },
  {
    language: "he",
    name: "Sefaria",
    url: "https://www.sefaria.org/search?q={word}",
  },
  { language: "es", name: "RAE", url: "https://dle.rae.es/{word}" },
  {
    language: "fr",
    name: "CNRTL",
    url: "https://www.cnrtl.fr/definition/{word}",
  },
  { language: "de", name: "DWDS", url: "https://www.dwds.de/wb/{word}" },
];

export const DEFAULT_LOOKUP_SOURCES: readonly LookupSource[] = [
  {
    language: "en",
    name: "Merriam-Webster",
    url: "https://www.merriam-webster.com/dictionary/{word}",
  },
  {
    language: "en",
    name: "Wiktionary",
    url: "https://en.wiktionary.org/wiki/{word}",
  },
  ...LEGACY_DEFAULT_SOURCES,
];

const sameSources = (a: readonly LookupSource[], b: readonly LookupSource[]) =>
  a.length === b.length &&
  a.every(
    (source, index) =>
      source.language === b[index].language &&
      source.name === b[index].name &&
      source.url === b[index].url,
  );

/**
 * Settings saved before the English sources (version 1) that still hold the
 * untouched first defaults take the current ones (SLN-687). Version 2 is kept
 * as saved, so removing the English sources stays removed.
 */
export function withCurrentDefaults(settings: LookupSettings): LookupSettings {
  if (settings.v === 2) return settings;
  return {
    ...settings,
    v: 2,
    sources: sameSources(settings.sources, LEGACY_DEFAULT_SOURCES)
      ? DEFAULT_LOOKUP_SOURCES.map((source) => ({ ...source }))
      : settings.sources,
  };
}

export function defaultLookupSettings(): LookupSettings {
  return {
    v: 2,
    sources: DEFAULT_LOOKUP_SOURCES.map((source) => ({ ...source })),
    translateTo: "en",
  };
}

/** Used for both obsolete stored preferences and the optional local offline copy. */
export function lookupSettings(value: unknown): LookupSettings {
  const parsed = lookupSettingsSchema.safeParse(value);
  return parsed.success
    ? withCurrentDefaults(parsed.data)
    : defaultLookupSettings();
}

export function sourcesForLanguage(
  sources: readonly LookupSource[],
  language: string,
) {
  return sources.filter(
    (source) => source.language === language || source.language === "*",
  );
}

/** Templates are navigations, never input to a server fetch. Validate again at the boundary. */
export function lookupSourceUrl(source: LookupSource, word: string): string {
  const parsed = lookupSourceSchema.parse(source);
  const result = parsed.url.replaceAll("{word}", encodeURIComponent(word));
  const url = new URL(result);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid lookup source URL");
  return result;
}
