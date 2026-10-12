import "server-only";
import { createHash } from "node:crypto";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { createElevenLabsProvider } from "./elevenlabs";
import {
  NARRATION_LIMITS,
  NarrationError,
  parseNarrationBody,
  type NarrationProvider,
  type NarrationVoice,
} from "./provider";

const NO_STORE = { "Cache-Control": "no-store" };
const VOICES_TTL_MS = 60 * 60_000;
/** Sentences heard again (a step back, a reopened page) are not paid for twice */
const AUDIO_CACHE_ENTRIES = 300;
const AUDIO_CACHE_BYTES = 48 * 1024 * 1024;

/** The configured provider, or null when no key is set: the reader then uses device voices */
export function narrationProviderFromEnv(env: NodeJS.ProcessEnv = process.env): NarrationProvider | null {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;
  return createElevenLabsProvider({
    apiKey,
    voiceId: env.ELEVENLABS_VOICE_ID?.trim() || undefined,
    modelId: env.ELEVENLABS_MODEL_ID?.trim() || undefined,
  });
}

class AudioCache {
  #entries = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  #bytes = 0;
  get(key: string) {
    const entry = this.#entries.get(key);
    if (entry) {
      this.#entries.delete(key);
      this.#entries.set(key, entry);
    }
    return entry;
  }
  put(key: string, entry: { bytes: Uint8Array<ArrayBuffer>; contentType: string }) {
    if (entry.bytes.byteLength > AUDIO_CACHE_BYTES / 4) return;
    const old = this.#entries.get(key);
    if (old) this.#bytes -= old.bytes.byteLength;
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#bytes += entry.bytes.byteLength;
    while (this.#entries.size > AUDIO_CACHE_ENTRIES || this.#bytes > AUDIO_CACHE_BYTES) {
      const [oldest, value] = this.#entries.entries().next().value!;
      this.#entries.delete(oldest);
      this.#bytes -= value.bytes.byteLength;
    }
  }
}

function failure(error: unknown, signal: AbortSignal): Response {
  if (signal.aborted) return new Response(null, { status: 499, headers: NO_STORE });
  const status = error instanceof NarrationError ? error.status : 502;
  const message =
    error instanceof NarrationError ? error.message : "The narration service failed.";
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/**
 * The two narration routes. Same-origin only (the app's API guard); the
 * provider's key never leaves the server.
 */
export function createNarrationRoutes(provider: () => NarrationProvider | null) {
  let voices: { provider: string; at: number; value: NarrationVoice[] } | null = null;
  const cache = new AudioCache();
  return {
    async GET(req: Request): Promise<Response> {
      const refused = crossOriginRefusal(req);
      if (refused) return refused;
      const active = provider();
      if (!active) return Response.json({ available: false }, { headers: NO_STORE });
      try {
        if (!voices || voices.provider !== active.id || Date.now() - voices.at > VOICES_TTL_MS)
          voices = { provider: active.id, at: Date.now(), value: await active.voices(req.signal) };
        return Response.json(
          { available: true, provider: active.label, voices: voices.value },
          { headers: NO_STORE },
        );
      } catch (error) {
        return failure(error, req.signal);
      }
    },
    async POST(req: Request): Promise<Response> {
      const refused = crossOriginRefusal(req);
      if (refused) return refused;
      const active = provider();
      if (!active)
        return Response.json({ error: "Natural voices are not set up." }, { status: 503, headers: NO_STORE });
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? ""))
        return Response.json({ error: "Send JSON." }, { status: 415, headers: NO_STORE });
      let body: ReturnType<typeof parseNarrationBody> = null;
      try {
        const raw = await req.text();
        if (raw.length <= NARRATION_LIMITS.requestBytes) body = parseNarrationBody(JSON.parse(raw));
      } catch {
        body = null;
      }
      if (!body)
        return Response.json({ error: "That text cannot be read aloud." }, { status: 400, headers: NO_STORE });
      const key = createHash("sha256")
        .update(JSON.stringify([active.id, body.voiceId, body.language, body.previousText, body.text]))
        .digest("hex");
      try {
        let audio = cache.get(key);
        if (!audio) {
          audio = await active.speak({ ...body, signal: req.signal });
          cache.put(key, audio);
        }
        return new Response(audio.bytes, {
          status: 200,
          headers: {
            ...NO_STORE,
            "Content-Type": audio.contentType,
            "Content-Length": String(audio.bytes.byteLength),
          },
        });
      } catch (error) {
        return failure(error, req.signal);
      }
    },
  };
}
