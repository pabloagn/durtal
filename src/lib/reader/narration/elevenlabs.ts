import "server-only";
import {
  NarrationError,
  type NarrationAudio,
  type NarrationProvider,
  type NarrationRequest,
  type NarrationVoice,
} from "./provider";

const API = "https://api.elevenlabs.io";
/** George: a warm British storyteller, one of ElevenLabs' own voices */
export const ELEVENLABS_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";
/** The most natural ElevenLabs model for long reading */
export const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";
/** Only these models take a language code; the others detect it themselves */
const LANGUAGE_MODELS = new Set(["eleven_turbo_v2_5", "eleven_flash_v2_5"]);
const AUDIO_LIMIT = 8 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

interface ElevenLabsVoice {
  voice_id?: unknown;
  name?: unknown;
  category?: unknown;
  labels?: Record<string, unknown> | null;
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function describe(labels: Record<string, unknown> | null | undefined): string | null {
  if (!labels) return null;
  const parts = ["accent", "description", "descriptive", "age"]
    .map((key) => labels[key])
    .filter((value): value is string => typeof value === "string" && !!value.trim())
    .map((value) => value.trim().replace(/_/g, " "));
  return parts.length ? capitalise(parts.join(", ")) : null;
}

/** Narration voices first, then the rest by name */
function rank(voice: ElevenLabsVoice): number {
  const use = voice.labels?.use_case;
  return typeof use === "string" && /narrat|audiobook|story/i.test(use) ? 0 : 1;
}

/** What a failed ElevenLabs answer means to the reader */
function refusal(status: number): NarrationError {
  if (status === 401 || status === 403)
    return new NarrationError("The ElevenLabs key was refused. Check ELEVENLABS_API_KEY and its permissions.", 502);
  if (status === 402)
    return new NarrationError("The ElevenLabs account has no credits left for reading aloud.", 502);
  if (status === 429)
    return new NarrationError("ElevenLabs is busy or the account's limit is reached. Try again shortly.", 429);
  if (status === 404) return new NarrationError("That ElevenLabs voice is no longer available.", 404);
  if (status === 422 || status === 400)
    return new NarrationError("ElevenLabs could not read this sentence.", 422);
  return new NarrationError("ElevenLabs did not answer. Try again shortly.", 502);
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    throw new NarrationError("The narration was too large.", 502);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new NarrationError("The narration was too large.", 502);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

/** ElevenLabs over its REST API, with plain fetch: no SDK */
export function createElevenLabsProvider(options: {
  apiKey: string;
  voiceId?: string;
  modelId?: string;
  fetch?: typeof fetch;
}): NarrationProvider {
  const request = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const model = options.modelId || ELEVENLABS_DEFAULT_MODEL;
  const preferred = options.voiceId || ELEVENLABS_DEFAULT_VOICE;
  const call = async (path: string, init: RequestInit, signal: AbortSignal) => {
    try {
      return await request(`${API}${path}`, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        headers: { ...init.headers, "xi-api-key": options.apiKey },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new NarrationError("ElevenLabs could not be reached.", 502);
    }
  };
  return {
    id: `elevenlabs:${model}`,
    label: "ElevenLabs",
    async voices(signal) {
      const response = await call("/v1/voices", { headers: { Accept: "application/json" } }, signal);
      if (!response.ok) throw refusal(response.status);
      const body = (await response.json().catch(() => null)) as { voices?: unknown } | null;
      const listed = Array.isArray(body?.voices) ? (body.voices as ElevenLabsVoice[]) : [];
      const voices = listed
        .filter(
          (voice): voice is ElevenLabsVoice & { voice_id: string; name: string } =>
            typeof voice.voice_id === "string" &&
            /^[A-Za-z0-9_-]{1,64}$/.test(voice.voice_id) &&
            typeof voice.name === "string",
        )
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
      const chosen = voices.some((voice) => voice.voice_id === preferred)
        ? preferred
        : voices[0]?.voice_id;
      return voices.slice(0, 100).map(
        (voice): NarrationVoice => ({
          id: voice.voice_id,
          name: voice.name.split(" - ")[0].trim().slice(0, 80) || voice.voice_id,
          description: describe(voice.labels)?.slice(0, 120) ?? null,
          default: voice.voice_id === chosen,
        }),
      );
    },
    async speak({ text, voiceId, language, previousText, signal }: NarrationRequest): Promise<NarrationAudio> {
      const languageCode = language?.split("-")[0].toLowerCase();
      const response = await call(
        `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text,
            model_id: model,
            ...(previousText ? { previous_text: previousText } : {}),
            ...(languageCode && LANGUAGE_MODELS.has(model) ? { language_code: languageCode } : {}),
          }),
        },
        signal,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw refusal(response.status);
      }
      const contentType = response.headers.get("content-type") ?? "audio/mpeg";
      if (!/^audio\//i.test(contentType)) {
        await response.body?.cancel().catch(() => {});
        throw new NarrationError("ElevenLabs answered without audio.", 502);
      }
      return { bytes: await readBounded(response, AUDIO_LIMIT), contentType: "audio/mpeg" };
    },
  };
}
