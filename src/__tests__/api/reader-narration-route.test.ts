import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElevenLabsProvider, ELEVENLABS_DEFAULT_VOICE } from "@/lib/reader/narration/elevenlabs";
import { createNarrationRoutes, narrationProviderFromEnv } from "@/lib/reader/narration/server";
import { NarrationError, parseNarrationBody, type NarrationProvider } from "@/lib/reader/narration/provider";

const endpoint = "http://localhost:3110/api/reader/narration";
const headers = { host: "localhost:3110", "sec-fetch-site": "same-origin" };
const speech = (body: unknown, extra: Record<string, string> = {}) =>
  new Request(`${endpoint}/speech`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { ...headers, "content-type": "application/json", ...extra },
  });
const audio = (text = "mp3") => new Response(text, { headers: { "Content-Type": "audio/mpeg" } });

function fakeProvider(overrides: Partial<NarrationProvider> = {}): NarrationProvider {
  return {
    id: "fake",
    label: "Fake",
    voices: vi.fn(async () => [{ id: "v1", name: "One", description: null, default: true }]),
    speak: vi.fn(async ({ text }) => ({ bytes: new TextEncoder().encode(`audio:${text}`), contentType: "audio/mpeg" })),
    ...overrides,
  };
}

describe("narration request body", () => {
  it("accepts one sentence with a voice and drops a malformed language", () => {
    expect(parseNarrationBody({ text: " Hello. ", voiceId: "abc_1", language: "fr-FR", previousText: "Before." }))
      .toEqual({ text: "Hello.", voiceId: "abc_1", language: "fr-FR", previousText: "Before." });
    expect(parseNarrationBody({ text: "Hi", voiceId: "abc", language: "<script>" })?.language).toBeNull();
  });
  it("refuses empty text, an oversized sentence and an unsafe voice id", () => {
    expect(parseNarrationBody({ text: " ", voiceId: "abc" })).toBeNull();
    expect(parseNarrationBody({ text: "x".repeat(4001), voiceId: "abc" })).toBeNull();
    expect(parseNarrationBody({ text: "Hi", voiceId: "../voices" })).toBeNull();
    expect(parseNarrationBody(["Hi"])).toBeNull();
  });
});

describe("ElevenLabs provider", () => {
  it("sends the key only to ElevenLabs and asks for MP3 with the sentence before", async () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => audio());
    const provider = createElevenLabsProvider({ apiKey: "sk_test", fetch });
    const result = await provider.speak({ text: "Hello.", voiceId: "voice1", language: "en", previousText: "Before.", signal: new AbortController().signal });
    expect(new TextDecoder().decode(result.bytes)).toBe("mp3");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice1?output_format=mp3_44100_128");
    expect((init!.headers as Record<string, string>)["xi-api-key"]).toBe("sk_test");
    expect(JSON.parse(init!.body as string)).toEqual({ text: "Hello.", model_id: "eleven_multilingual_v2", previous_text: "Before." });
  });
  it("passes a language code only to the models that take one", async () => {
    const fetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => audio());
    const provider = createElevenLabsProvider({ apiKey: "k", modelId: "eleven_flash_v2_5", fetch });
    await provider.speak({ text: "Bonjour.", voiceId: "v", language: "fr-FR", previousText: null, signal: new AbortController().signal });
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({ model_id: "eleven_flash_v2_5", language_code: "fr" });
  });
  it.each([
    [401, /key was refused/],
    [402, /no credits/],
    [429, /busy/],
    [404, /no longer available/],
  ])("explains an ElevenLabs %i", async (status, message) => {
    const provider = createElevenLabsProvider({ apiKey: "k", fetch: async () => new Response("{}", { status }) });
    await expect(provider.speak({ text: "Hi", voiceId: "v", language: null, previousText: null, signal: new AbortController().signal }))
      .rejects.toThrow(message);
  });
  it("refuses an answer that is not audio", async () => {
    const provider = createElevenLabsProvider({ apiKey: "k", fetch: async () => Response.json({ detail: "x" }) });
    await expect(provider.speak({ text: "Hi", voiceId: "v", language: null, previousText: null, signal: new AbortController().signal }))
      .rejects.toThrow(/without audio/);
  });
  it("lists narration voices first and marks the default", async () => {
    const provider = createElevenLabsProvider({
      apiKey: "k",
      fetch: async () => Response.json({ voices: [
        { voice_id: "a1", name: "Aria", labels: { accent: "american", use_case: "conversational" } },
        { voice_id: ELEVENLABS_DEFAULT_VOICE, name: "George - warm", labels: { accent: "british", description: "warm", use_case: "narration" } },
        { voice_id: "bad id!", name: "Broken" },
      ] }),
    });
    const voices = await provider.voices(new AbortController().signal);
    expect(voices.map((voice) => voice.id)).toEqual([ELEVENLABS_DEFAULT_VOICE, "a1"]);
    expect(voices[0]).toMatchObject({ name: "George", description: "British, warm", default: true });
    expect(voices[1].default).toBe(false);
  });
});

describe("narration routes", () => {
  it("has no provider without a key, so the reader keeps device voices", async () => {
    const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
    expect(narrationProviderFromEnv(env({}))).toBeNull();
    expect(narrationProviderFromEnv(env({ ELEVENLABS_API_KEY: "  " }))).toBeNull();
    expect(narrationProviderFromEnv(env({ ELEVENLABS_API_KEY: "k" }))?.label).toBe("ElevenLabs");
    const routes = createNarrationRoutes(() => null);
    expect(await (await routes.GET(new Request(endpoint, { headers }))).json()).toEqual({ available: false });
    expect((await routes.POST(speech({ text: "Hi", voiceId: "v" }))).status).toBe(503);
  });
  it("lists voices without the key and caches them", async () => {
    const provider = fakeProvider();
    const routes = createNarrationRoutes(() => provider);
    const body = await (await routes.GET(new Request(endpoint, { headers }))).json();
    expect(body).toEqual({ available: true, provider: "Fake", voices: [{ id: "v1", name: "One", description: null, default: true }] });
    await routes.GET(new Request(endpoint, { headers }));
    expect(provider.voices).toHaveBeenCalledTimes(1);
  });
  it("returns one sentence's audio and does not pay for the same sentence twice", async () => {
    const provider = fakeProvider();
    const routes = createNarrationRoutes(() => provider);
    for (let i = 0; i < 2; i++) {
      const response = await routes.POST(speech({ text: "Hello.", voiceId: "v1" }));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("audio/mpeg");
      expect(await response.text()).toBe("audio:Hello.");
    }
    expect(provider.speak).toHaveBeenCalledTimes(1);
  });
  it("refuses another site, non-JSON and malformed bodies before calling the provider", async () => {
    const provider = fakeProvider();
    const routes = createNarrationRoutes(() => provider);
    expect((await routes.POST(speech({ text: "Hi", voiceId: "v" }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await routes.POST(speech({ text: "Hi", voiceId: "v" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await routes.POST(speech("{not json"))).status).toBe(400);
    expect((await routes.GET(new Request(endpoint, { headers: { ...headers, "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect(provider.speak).not.toHaveBeenCalled();
  });
  it("passes on a provider refusal with its status and safe message", async () => {
    const routes = createNarrationRoutes(() => fakeProvider({
      speak: async () => { throw new NarrationError("The ElevenLabs account has no credits left for reading aloud.", 502); },
    }));
    const response = await routes.POST(speech({ text: "Hi", voiceId: "v" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The ElevenLabs account has no credits left for reading aloud." });
  });
});
