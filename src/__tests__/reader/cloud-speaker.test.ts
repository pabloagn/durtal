// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudSpeechSpeaker, isNaturalVoice } from "@/lib/reader/speech/cloud-speaker";
import { parseSpeechPreferences } from "@/lib/reader/speech/voices";
import type { SpeechSegment } from "@/lib/reader/speech/player";

// A deterministic audio element double, never evidence of real playback.
class FakeAudio extends EventTarget {
  src = "";
  playbackRate = 1;
  played: string[] = [];
  play = vi.fn(async () => {
    this.played.push(this.src);
  });
  pause = vi.fn();
  removeAttribute() {
    this.src = "";
  }
}
const segment = (text: string, lang = "en"): SpeechSegment =>
  ({ text, lang, locator: {} as SpeechSegment["locator"] });
const speak = (generation: number, utterance: number, text: string) =>
  ({ kind: "speak", token: { generation, utterance }, segment: segment(text) }) as const;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  const audio = new FakeAudio();
  const actions: unknown[] = [];
  const notices: string[] = [];
  const fetch = vi.fn(
    fetchImpl ??
      (async (url: string) =>
        url === "/api/reader/narration"
          ? Response.json({ available: true, voices: [{ id: "george", name: "George", description: "British", default: true }] })
          : new Response(new Blob(["mp3"], { type: "audio/mpeg" }))),
  );
  const onVoices = vi.fn();
  const speaker = createCloudSpeechSpeaker({
    audio: audio as unknown as HTMLAudioElement,
    fetch: fetch as unknown as typeof globalThis.fetch,
    onAction: (action) => actions.push(action),
    onVoices,
    onNotice: (message) => notices.push(message),
  });
  return { audio, actions, notices, fetch, onVoices, speaker };
}

afterEach(() => vi.restoreAllMocks());

describe("natural voice speaker", () => {
  it("lists the server's voices as natural voices for every language", async () => {
    const { onVoices } = setup();
    await flush();
    const [voices] = onVoices.mock.calls[0];
    expect(voices).toEqual([{ voiceURI: "natural:george", name: "George", lang: "mul", localService: false, default: true, description: "British" }]);
    expect(isNaturalVoice(voices[0])).toBe(true);
  });
  it("unlocks audio in the starting tap, then plays each sentence in order with the one before as context", async () => {
    const { audio, actions, fetch, speaker } = setup();
    const prefs = { ...parseSpeechPreferences(null), rate: 1.25 as const };
    expect(speaker.speak(speak(1, 0, "First."), prefs, "en", "george")).toBe(true);
    // The silent unlock plays synchronously, inside the tap
    expect(audio.played[0]).toMatch(/^data:audio\/wav/);
    expect(speaker.speak(speak(1, 1, "Second."), prefs, "en", "george")).toBe(true);
    await flush();
    const bodies = fetch.mock.calls.filter(([url]) => url === "/api/reader/narration/speech")
      .map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies).toEqual([
      { text: "First.", voiceId: "george", language: "en", previousText: null },
      { text: "Second.", voiceId: "george", language: "en", previousText: "First." },
    ]);
    expect(audio.played[1]).toMatch(/^blob:/);
    expect(audio.playbackRate).toBe(1.25);
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("ended"));
    expect(audio.played).toHaveLength(3);
    audio.dispatchEvent(new Event("playing"));
    expect(actions).toEqual([
      { kind: "started", token: { generation: 1, utterance: 0 } },
      { kind: "ended", token: { generation: 1, utterance: 0 } },
      { kind: "started", token: { generation: 1, utterance: 1 } },
    ]);
  });
  it("turns a refused sentence into a notice and an error, never a silent stall", async () => {
    const { actions, notices, speaker } = setup(async (url) =>
      url === "/api/reader/narration"
        ? Response.json({ available: true, voices: [] })
        : Response.json({ error: "The ElevenLabs account has no credits left for reading aloud." }, { status: 502 }),
    );
    speaker.speak(speak(1, 0, "Hi."), parseSpeechPreferences(null), "en", "george");
    await flush();
    expect(notices).toEqual(["The ElevenLabs account has no credits left for reading aloud."]);
    expect(actions).toEqual([{ kind: "error", token: { generation: 1, utterance: 0 }, error: "synthesis-failed" }]);
  });
  it("lets the next sentence wait behind a long one: its start deadline runs only once it is next", async () => {
    vi.useFakeTimers();
    try {
      const { audio, actions, speaker } = setup();
      const prefs = parseSpeechPreferences(null);
      speaker.speak(speak(1, 0, "A long period of Huysmans."), prefs, "en", "george");
      await vi.advanceTimersByTimeAsync(0);
      audio.dispatchEvent(new Event("playing"));
      // The player queues the next sentence as soon as this one starts
      speaker.speak(speak(1, 1, "Next."), prefs, "en", "george");
      await vi.advanceTimersByTimeAsync(90_000);
      expect(actions).toEqual([{ kind: "started", token: { generation: 1, utterance: 0 } }]);
      audio.dispatchEvent(new Event("ended"));
      audio.dispatchEvent(new Event("playing"));
      expect(actions.slice(1)).toEqual([
        { kind: "ended", token: { generation: 1, utterance: 0 } },
        { kind: "started", token: { generation: 1, utterance: 1 } },
      ]);
      // A sentence that is next and never starts still fails, never a silent stall
      speaker.speak(speak(1, 2, "Stalled."), prefs, "en", "george");
      audio.dispatchEvent(new Event("ended"));
      audio.play.mockImplementation(async () => {});
      await vi.advanceTimersByTimeAsync(45_000);
      expect(actions.at(-1)).toEqual({ kind: "error", token: { generation: 1, utterance: 2 }, error: "synthesis-failed" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("drops stale sentences after a cancel and refuses an older generation", async () => {
    const { audio, actions, speaker } = setup();
    const prefs = parseSpeechPreferences(null);
    speaker.speak(speak(1, 0, "Old."), prefs, "en", "george");
    speaker.cancel();
    await flush();
    expect(audio.played.some((src) => src.startsWith("blob:"))).toBe(false);
    expect(speaker.speak(speak(1, 1, "Late."), prefs, "en", "george")).toBe(false);
    expect(speaker.speak(speak(2, 0, "New."), prefs, "en", "george")).toBe(true);
    await flush();
    audio.dispatchEvent(new Event("playing"));
    expect(actions).toEqual([{ kind: "started", token: { generation: 2, utterance: 0 } }]);
    speaker.destroy();
    expect(audio.src).toBe("");
  });
});
