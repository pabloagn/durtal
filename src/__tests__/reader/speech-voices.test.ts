import { describe, expect, it, vi } from "vitest";
import {
  chooseSpeechVoice,
  choosePassageVoice,
  groupSpeechVoices,
  parseSpeechPreferences,
  readSpeechPreferences,
  writeSpeechPreferences,
  rememberSpeechVoice,
  speechLanguage,
  SPEECH_RATES,
  SPEECH_STORAGE_KEY,
  type SpeechVoice,
} from "@/lib/reader/speech/voices";
const voice = (
  voiceURI: string,
  lang: string,
  localService = false,
  isDefault = false,
): SpeechVoice => ({
  voiceURI,
  name: voiceURI,
  lang,
  localService,
  default: isDefault,
});
const defaults = () => parseSpeechPreferences(null);

describe("speech voices and bounded device preferences", () => {
  it("prefers an exact tag over a local primary match, without mutating native order", () => {
    const voices = [
      voice("local-US", "en-US", true, true),
      voice("exact-GB", "en-GB"),
    ];
    expect(chooseSpeechVoice(voices, "en-GB", defaults())).toMatchObject({
      kind: "available",
      voice: voices[1],
      explicit: false,
    });
    expect(voices.map((v) => v.voiceURI)).toEqual(["local-US", "exact-GB"]);
  });
  it("prefers local voices within the tier and then the browser default", () => {
    const voices = [
      voice("remote-default", "en", false, true),
      voice("local", "en", true),
      voice("local-default", "en", true, true),
    ];
    expect(chooseSpeechVoice(voices, "en", defaults())).toMatchObject({
      voice: voices[2],
    });
    expect(
      chooseSpeechVoice(voices.slice(0, 2), "en", defaults()),
    ).toMatchObject({ voice: voices[1] });
    const remote = [voice("first", "fr"), voice("default", "fr", false, true)];
    expect(chooseSpeechVoice(remote, "fr", defaults())).toMatchObject({
      voice: remote[1],
    });
  });
  it("uses primary-language matches when no exact tag exists", () => {
    const voices = [voice("US", "en-US"), voice("local-AU", "en-AU", true)];
    expect(chooseSpeechVoice(voices, "en-GB", defaults())).toMatchObject({
      voice: voices[1],
    });
  });
  it.each(["la", "grc", "sa"])(
    "does not silently use an unrelated default for %s",
    (lang) => {
      expect(
        chooseSpeechVoice(
          [voice("English", "en", true, true)],
          lang,
          defaults(),
        ),
      ).toEqual({ kind: "missing", language: lang });
    },
  );
  it("remembers an explicit Italian voice for Latin and falls back if it disappears", () => {
    const italian = voice("Italian", "it"),
      latin = voice("Latin", "la", true);
    const preferences = rememberSpeechVoice(defaults(), "LA", italian.voiceURI);
    expect(preferences.voiceByLang).toEqual({ la: "Italian" });
    expect(chooseSpeechVoice([latin, italian], "la", preferences)).toEqual({
      kind: "available",
      voice: italian,
      explicit: true,
    });
    expect(chooseSpeechVoice([latin], "la", preferences)).toEqual({
      kind: "available",
      voice: latin,
      explicit: false,
    });
    expect(chooseSpeechVoice([], "la", preferences)).toEqual({
      kind: "missing",
      language: "la",
    });
  });
  it("chooses foreign passage voices and otherwise uses the explicit book choice", () => {
    const english = voice("English", "en"),
      french = voice("French", "fr"),
      italian = voice("Italian", "it");
    const preferences = rememberSpeechVoice(defaults(), "la", italian.voiceURI);
    expect(
      choosePassageVoice([english, french], "fr", "en", defaults()),
    ).toMatchObject({ voice: french });
    expect(
      choosePassageVoice([english, italian], "grc", "la", preferences),
    ).toMatchObject({ voice: italian, explicit: true });
    expect(choosePassageVoice([english], null, "en", defaults())).toMatchObject(
      { voice: english },
    );
  });
  it("handles missing/invalid language tags and empty voice lists", () => {
    expect(speechLanguage(" EN-gb ")).toBe("en-GB");
    expect(speechLanguage("en_US")).toBeNull();
    expect(speechLanguage("x".repeat(65))).toBeNull();
    const english = voice("English", "en", false, true);
    expect(chooseSpeechVoice([english], null, defaults())).toMatchObject({
      voice: english,
    });
    expect(chooseSpeechVoice([], null, defaults())).toEqual({
      kind: "missing",
      language: null,
    });
  });
  it("groups all languages with book and primary-language groups first", () => {
    const groups = groupSpeechVoices(
      [
        voice("French", "fr"),
        voice("US", "en-US"),
        voice("GB", "en-GB"),
        voice("Italian", "it"),
        voice("invalid", "not_valid"),
      ],
      "en-GB",
    );
    expect(groups.map((g) => g.language)).toEqual([
      "en-GB",
      "en-US",
      "fr",
      "it",
      "und",
    ]);
    expect(groups.flatMap((g) => g.voices)).toHaveLength(5);
  });
  it("round-trips the versioned key and every supported rate using injected storage", () => {
    for (const rate of SPEECH_RATES) {
      const storage = { getItem: vi.fn(), setItem: vi.fn() };
      const preferences = {
        ...rememberSpeechVoice(defaults(), "en", "uri:local"),
        rate,
      };
      expect(writeSpeechPreferences(storage, preferences)).toBe(true);
      expect(storage.setItem.mock.calls[0][0]).toBe(SPEECH_STORAGE_KEY);
      storage.getItem.mockReturnValue(storage.setItem.mock.calls[0][1]);
      expect(readSpeechPreferences(storage)).toEqual(preferences);
    }
  });
  it.each(["{", "[]", "null", '{"v":2,"rate":2}', "x".repeat(16_385)])(
    "ignores malformed/future/oversized storage",
    (raw) => {
      expect(parseSpeechPreferences(raw)).toEqual(defaults());
    },
  );
  it("normalizes valid keys, ignores invalid URIs/keys and rejects unsupported speed", () => {
    const parsed = parseSpeechPreferences(
      JSON.stringify({
        v: 1,
        rate: 1.1,
        voiceByLang: {
          "EN-us": "uri",
          en_US: "bad",
          fr: "",
          de: 4,
          it: "x".repeat(1025),
          __proto__: "bad",
        },
      }),
    );
    expect(parsed).toEqual({ v: 1, rate: 1, voiceByLang: { "en-US": "uri" } });
    expect({}.hasOwnProperty.call(parsed.voiceByLang, "__proto__")).toBe(false);
  });
  it("bounds language choices to 32 and keeps the newest explicit choice", () => {
    let preferences = defaults();
    for (let i = 0; i < 40; i++)
      preferences = rememberSpeechVoice(preferences, `en-x-${i}`, `voice:${i}`);
    expect(Object.keys(preferences.voiceByLang)).toHaveLength(32);
    expect(preferences.voiceByLang["en-x-39"]).toBe("voice:39");
    expect(preferences.voiceByLang["en-x-0"]).toBeUndefined();
    expect(
      Object.keys(
        parseSpeechPreferences(JSON.stringify(preferences)).voiceByLang,
      ),
    ).toHaveLength(32);
    expect(rememberSpeechVoice(preferences, "not_valid", "uri")).toBe(
      preferences,
    );
    expect(rememberSpeechVoice(preferences, "fr", "x".repeat(1025))).toBe(
      preferences,
    );
  });
  it("fails safely for blocked storage and oversize writes", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readSpeechPreferences(storage)).toEqual(defaults());
    expect(writeSpeechPreferences(storage, defaults())).toBe(false);
    const setItem = vi.fn();
    expect(
      writeSpeechPreferences(
        { setItem },
        { ...defaults(), voiceByLang: { en: "x".repeat(20_000) } },
      ),
    ).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("natural voices", () => {
  const george = voice("natural:george", "mul", false, true);
  const aria = voice("natural:aria", "mul");
  const samantha = voice("samantha", "en-US", true, true);
  it("reads every language with the default natural voice over a device voice", () => {
    for (const language of ["en", "fr-FR", null])
      expect(chooseSpeechVoice([samantha, aria, george], language, defaults()))
        .toEqual({ kind: "available", voice: george, explicit: false });
  });
  it("carries a chosen natural voice to other languages and groups natural voices first", () => {
    const prefs = rememberSpeechVoice(defaults(), "en", aria.voiceURI);
    expect(prefs.natural).toBeUndefined();
    expect(chooseSpeechVoice([samantha, aria, george], "de", prefs)).toMatchObject({ voice: aria, explicit: true });
    expect(groupSpeechVoices([samantha, george], "en")[0].language).toBe("mul");
  });
  it("keeps a device voice the reader picked over the natural ones, and survives a reload", () => {
    expect(rememberSpeechVoice(defaults(), "en", samantha.voiceURI).natural).toBeUndefined();
    const prefs = rememberSpeechVoice(defaults(), "en", samantha.voiceURI, true);
    expect(prefs.natural).toBe("off");
    expect(rememberSpeechVoice(prefs, "fr", "thomas").natural).toBe("off");
    expect(parseSpeechPreferences(JSON.stringify(prefs)).natural).toBe("off");
    expect(chooseSpeechVoice([samantha, george], "en", prefs)).toMatchObject({ voice: samantha, explicit: true });
    expect(rememberSpeechVoice(prefs, "en", george.voiceURI).natural).toBeUndefined();
  });
});
