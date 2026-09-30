/**
 * Language codes as stored: ISO 639-1 when the language has one ("en"),
 * otherwise ISO 639-3 ("grc"). The database converts every write the same way
 * (migration 0035). This module does it in the app for values from metadata
 * sources, so forms show the right choice, and gives the English name for
 * display. Pure module, usable on server and client.
 */
import { LANGUAGES } from "@/lib/constants/languages";

const displayNames = new Intl.DisplayNames(["en"], {
  type: "language",
  fallback: "none",
});

function nameOf(code: string): string | undefined {
  try {
    return displayNames.of(code);
  } catch {
    return undefined;
  }
}

let codesByName: Map<string, string> | null = null;

/** English names of all two-letter codes and the app's language list */
function codeForName(name: string): string | null {
  if (!codesByName) {
    codesByName = new Map();
    const letters = "abcdefghijklmnopqrstuvwxyz";
    for (const a of letters) {
      for (const b of letters) {
        const label = nameOf(a + b);
        if (label && label !== a + b)
          codesByName.set(label.toLowerCase(), a + b);
      }
    }
    for (const l of LANGUAGES) codesByName.set(l.label.toLowerCase(), l.value);
  }
  return codesByName.get(name.toLowerCase()) ?? null;
}

/**
 * The stored code for a language given as a code ("en", "eng", "fre"), a
 * regional tag ("en-US", "en_GB") or an English name ("English"). Null when
 * the value is empty or not a known language.
 */
export function normalizeLanguage(
  raw: string | null | undefined,
): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^[a-z]{2,3}([-_][a-z0-9]+)*$/i.test(value)) {
    try {
      const [tag] = Intl.getCanonicalLocales(value.replace(/_/g, "-"));
      const code = new Intl.Locale(tag).language;
      if (code !== "und" && code !== "mul" && nameOf(code)) return code;
    } catch {
      // Not a valid tag: try it as a name
    }
  }
  return codeForName(value);
}

/** English name of a stored code ("en" → "English"); the code when unknown. */
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  return nameOf(code) ?? code;
}

/** Options for a language select: the app's list, plus `current` when missing. */
export function languageOptions(current?: string | null) {
  const options: { value: string; label: string }[] = LANGUAGES.map((l) => ({
    value: l.value,
    label: l.label,
  }));
  if (current && !options.some((o) => o.value === current)) {
    options.push({ value: current, label: languageName(current) ?? current });
  }
  return options;
}
