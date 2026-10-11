/** Browser-independent voice metadata. Native voices are resolved by URI later. */
export interface SpeechVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type SpeechRate = (typeof SPEECH_RATES)[number];
export const SPEECH_STORAGE_KEY = "durtal-reader-speech";
const MAX_RECORD_CHARS = 16_384;
const MAX_LANGUAGES = 32;
const MAX_URI_CHARS = 1024;

export interface SpeechPreferences {
  v: 1;
  voiceByLang: Record<string, string>;
  rate: SpeechRate;
}
export interface SpeechPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type VoiceChoice =
  | { kind: "available"; voice: SpeechVoice; explicit: boolean }
  | { kind: "missing"; language: string | null };

export function speechLanguage(tag: string | null | undefined): string | null {
  if (!tag || tag.length > 64) return null;
  try {
    return Intl.getCanonicalLocales(tag.trim())[0] ?? null;
  } catch {
    return null;
  }
}
const emptyPreferences = (): SpeechPreferences => ({
  v: 1,
  voiceByLang: {},
  rate: 1,
});
export function isSpeechRate(value: unknown): value is SpeechRate {
  return SPEECH_RATES.some((rate) => rate === value);
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Malformed, oversized and future-version records never enter player state. */
export function parseSpeechPreferences(raw: string | null): SpeechPreferences {
  if (!raw || raw.length > MAX_RECORD_CHARS) return emptyPreferences();
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.v !== 1) return emptyPreferences();
    const voiceByLang: Record<string, string> = {};
    if (record(value.voiceByLang)) {
      for (const [tag, uri] of Object.entries(value.voiceByLang)) {
        if (Object.keys(voiceByLang).length === MAX_LANGUAGES) break;
        const lang = speechLanguage(tag);
        if (
          lang &&
          typeof uri === "string" &&
          uri.length > 0 &&
          uri.length <= MAX_URI_CHARS
        )
          voiceByLang[lang] = uri;
      }
    }
    return {
      v: 1,
      voiceByLang,
      rate: isSpeechRate(value.rate) ? value.rate : 1,
    };
  } catch {
    return emptyPreferences();
  }
}

/** Injected storage only: this module never reads a browser global. */
export function readSpeechPreferences(
  storage: Pick<SpeechPreferenceStorage, "getItem">,
): SpeechPreferences {
  try {
    return parseSpeechPreferences(storage.getItem(SPEECH_STORAGE_KEY));
  } catch {
    return emptyPreferences();
  }
}
export function writeSpeechPreferences(
  storage: Pick<SpeechPreferenceStorage, "setItem">,
  preferences: SpeechPreferences,
): boolean {
  try {
    const raw = JSON.stringify(preferences);
    if (raw.length > MAX_RECORD_CHARS) return false;
    storage.setItem(
      SPEECH_STORAGE_KEY,
      JSON.stringify(parseSpeechPreferences(raw)),
    );
    return true;
  } catch {
    return false;
  }
}

/** Remember an explicit cross-language choice under the passage/book language. */
export function rememberSpeechVoice(
  preferences: SpeechPreferences,
  language: string,
  voiceURI: string,
): SpeechPreferences {
  const lang = speechLanguage(language);
  if (!lang || !voiceURI || voiceURI.length > MAX_URI_CHARS) return preferences;
  const voiceByLang = { ...preferences.voiceByLang };
  delete voiceByLang[lang];
  voiceByLang[lang] = voiceURI;
  const entries = Object.entries(voiceByLang).slice(-MAX_LANGUAGES);
  return { ...preferences, voiceByLang: Object.fromEntries(entries) };
}

/** Local service and browser default only break ties inside a language tier. */
function preferred(voices: SpeechVoice[]): SpeechVoice | undefined {
  return (
    voices.find((voice) => voice.localService && voice.default) ??
    voices.find((voice) => voice.localService) ??
    voices.find((voice) => voice.default) ??
    voices[0]
  );
}
export function chooseSpeechVoice(
  voices: readonly SpeechVoice[],
  language: string | null,
  preferences: SpeechPreferences,
): VoiceChoice {
  const lang = speechLanguage(language);
  const remembered = lang ? preferences.voiceByLang[lang] : undefined;
  const explicit = remembered
    ? voices.find((voice) => voice.voiceURI === remembered)
    : undefined;
  if (explicit) return { kind: "available", voice: explicit, explicit: true };
  if (!lang) {
    const voice =
      voices.find((candidate) => candidate.default) ?? preferred([...voices]);
    return voice
      ? { kind: "available", voice, explicit: false }
      : { kind: "missing", language: null };
  }
  const exact = voices.filter((voice) => speechLanguage(voice.lang) === lang);
  const primary = lang.split("-")[0];
  const family = voices.filter(
    (voice) => speechLanguage(voice.lang)?.split("-")[0] === primary,
  );
  const voice = preferred(exact) ?? preferred(family);
  return voice
    ? { kind: "available", voice, explicit: false }
    : { kind: "missing", language: lang };
}

/** A foreign passage without its own voice falls back to the book's choice. */
export function choosePassageVoice(
  voices: readonly SpeechVoice[],
  passageLanguage: string | null,
  bookLanguage: string | null,
  preferences: SpeechPreferences,
): VoiceChoice {
  const lang = speechLanguage(passageLanguage);
  if (lang) {
    const choice = chooseSpeechVoice(voices, lang, preferences);
    if (choice.kind === "available") return choice;
  }
  return chooseSpeechVoice(voices, bookLanguage, preferences);
}

export interface SpeechVoiceGroup {
  language: string;
  voices: SpeechVoice[];
}
export function groupSpeechVoices(
  voices: readonly SpeechVoice[],
  bookLanguage: string | null,
): SpeechVoiceGroup[] {
  const groups = new Map<string, SpeechVoice[]>();
  for (const voice of voices) {
    const language = speechLanguage(voice.lang) ?? "und";
    const group = groups.get(language) ?? [];
    group.push(voice);
    groups.set(language, group);
  }
  const book = speechLanguage(bookLanguage);
  const primary = book?.split("-")[0];
  const rank = (tag: string) =>
    tag === book ? 0 : tag.split("-")[0] === primary ? 1 : 2;
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([language, members]) => ({ language, voices: members }));
}

/** The UI is English; unfamiliar or unsupported tags keep a truthful tag label. */
export function speechLanguageLabel(language: string | null): string {
  const tag = speechLanguage(language);
  if (!tag || tag === "und") return "this language";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
