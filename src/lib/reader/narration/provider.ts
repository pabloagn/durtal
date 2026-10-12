/**
 * Natural narration for the reader's Read aloud: a voice service on the
 * server that turns one sentence into audio. The browser never talks to the
 * service or sees its key; it asks /api/reader/narration (list the voices)
 * and /api/reader/narration/speech (one sentence's audio). ElevenLabs is the
 * first provider; another is one more implementation of this interface.
 */

/** A voice as the browser sees it: no provider internals */
export interface NarrationVoice {
  /** The provider's voice id */
  id: string;
  name: string;
  /** A short description from the provider, such as "British, warm, middle aged" */
  description: string | null;
  /** The voice the reader starts with */
  default: boolean;
}

export interface NarrationRequest {
  text: string;
  voiceId: string;
  /** The book's or passage's language tag, when known */
  language: string | null;
  /** The sentence read just before, so the voice carries its intonation on */
  previousText: string | null;
  signal: AbortSignal;
}

export interface NarrationAudio {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export interface NarrationProvider {
  /** A stable id, part of every cache key */
  id: string;
  /** What the voice menu calls the provider */
  label: string;
  voices(signal: AbortSignal): Promise<NarrationVoice[]>;
  speak(request: NarrationRequest): Promise<NarrationAudio>;
}

/** A refusal the route passes on with its status; the message is safe to show */
export class NarrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NarrationError";
  }
}

/** One request is one sentence (the reader splits text by sentence) */
export const NARRATION_LIMITS = Object.freeze({
  textChars: 4000,
  previousChars: 1000,
  voiceIdChars: 64,
  languageChars: 35,
  requestBytes: 24_000,
});

/** The speech request body, checked before any provider call */
export function parseNarrationBody(value: unknown):
  | { text: string; voiceId: string; language: string | null; previousText: string | null }
  | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body.voiceId === "string" ? body.voiceId : "";
  if (!text || text.length > NARRATION_LIMITS.textChars) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(voiceId)) return null;
  const language =
    typeof body.language === "string" &&
    body.language.length <= NARRATION_LIMITS.languageChars &&
    /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(body.language)
      ? body.language
      : null;
  const previousText =
    typeof body.previousText === "string" && body.previousText.trim()
      ? body.previousText.trim().slice(-NARRATION_LIMITS.previousChars)
      : null;
  return { text, voiceId, language, previousText };
}
