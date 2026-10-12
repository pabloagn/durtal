import type { SpeechAction, SpeechCommand } from "./player";
import type { SpeechToken } from "./cancellation";
import type { SpeechPreferences, SpeechVoice } from "./voices";

type SpeakCommand = Extract<SpeechCommand, { kind: "speak" }>;
type SpeakerAction = Extract<
  SpeechAction,
  { kind: "started" | "ended" | "error" | "hidden" }
>;

/** Natural voices live on the server; their voice URIs carry this prefix */
export const NATURAL_VOICE_PREFIX = "natural:";
/** A natural voice reads every language: it matches any passage */
export const NATURAL_VOICE_LANG = "mul";
export const isNaturalVoice = (voice: Pick<SpeechVoice, "voiceURI">) =>
  voice.voiceURI.startsWith(NATURAL_VOICE_PREFIX);

/** 0.1 s of silence: played in the tap that starts reading, so later sentences may play */
const SILENCE =
  "data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAG" +
  "A".repeat(2136);

interface Pending {
  token: SpeechToken;
  controller: AbortController;
  url: string | null;
  started: boolean;
  rate: number;
  startTimer: ReturnType<typeof setTimeout> | null;
}
const key = (token: SpeechToken) => `${token.generation}:${token.utterance}`;

/**
 * The natural voice's speaker: each sentence's audio comes from
 * /api/reader/narration/speech and plays in one audio element. The next
 * sentence is fetched while this one plays, so reading runs on without a
 * gap. Unlike the device voices it keeps reading with the screen locked.
 */
export function createCloudSpeechSpeaker(options: {
  audio: HTMLAudioElement;
  fetch: typeof fetch;
  onAction(action: SpeakerAction): void;
  onVoices?(voices: SpeechVoice[]): void;
  /** A failure the reader should hear about, in words */
  onNotice?(message: string): void;
}) {
  const { audio } = options;
  const pending = new Map<string, Pending>();
  let generation = -1;
  let closedGeneration = -1;
  let sequence = -1;
  let disposed = false;
  let playing: string | null = null;
  let previousText: string | null = null;
  let voices: SpeechVoice[] = [];
  const emit = (action: SpeakerAction) => {
    if (!disposed) options.onAction(action);
  };

  const listing = new AbortController();
  void options
    .fetch("/api/reader/narration", { cache: "no-store", signal: listing.signal })
    .then(async (response) => {
      const body = (await response.json().catch(() => null)) as {
        available?: boolean;
        voices?: { id: string; name: string; description: string | null; default: boolean }[];
        error?: string;
      } | null;
      if (!response.ok && body?.error) options.onNotice?.(body.error);
      if (disposed || !body?.available || !Array.isArray(body.voices)) return;
      voices = body.voices.map((voice) => ({
        voiceURI: NATURAL_VOICE_PREFIX + voice.id,
        name: voice.name,
        lang: NATURAL_VOICE_LANG,
        localService: false,
        default: voice.default,
        ...(voice.description ? { description: voice.description } : {}),
      }));
      options.onVoices?.(voices);
    })
    .catch(() => {
      /* No natural voices: the device's own voices read. */
    });

  const release = (item: Pending) => {
    item.controller.abort();
    if (item.startTimer) clearTimeout(item.startTimer);
    item.startTimer = null;
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = null;
  };

  /** The oldest sentence plays once its audio is here and nothing else plays */
  const advance = () => {
    if (disposed || playing) return;
    const [id, item] = pending.entries().next().value ?? [];
    if (!id || !item?.url) return;
    playing = id;
    audio.src = item.url;
    audio.playbackRate = item.rate;
    audio.play().catch((error: unknown) => {
      if (playing !== id) return;
      fail(id, error instanceof DOMException && error.name === "NotAllowedError" ? "not-allowed" : "synthesis-failed");
    });
  };

  const fail = (id: string, error: string) => {
    const item = pending.get(id);
    if (!item) return;
    release(item);
    pending.delete(id);
    if (playing === id) {
      playing = null;
      audio.pause();
    }
    emit({ kind: "error", token: item.token, error });
  };

  const onPlaying = () => {
    const item = playing ? pending.get(playing) : null;
    if (!item || item.started) return;
    item.started = true;
    if (item.startTimer) clearTimeout(item.startTimer);
    item.startTimer = null;
    emit({ kind: "started", token: item.token });
  };
  const onEnded = () => {
    const id = playing;
    const item = id ? pending.get(id) : null;
    if (!id || !item) return;
    playing = null;
    release(item);
    pending.delete(id);
    emit({ kind: "ended", token: item.token });
    advance();
  };
  const onError = () => {
    if (playing && audio.src.startsWith("blob:")) fail(playing, "synthesis-failed");
  };
  audio.addEventListener("playing", onPlaying);
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);

  function cancel() {
    closedGeneration = Math.max(closedGeneration, generation);
    for (const item of pending.values()) release(item);
    pending.clear();
    playing = null;
    previousText = null;
    try {
      audio.pause();
    } catch {
      /* Nothing to stop. */
    }
  }

  function speak(
    command: SpeakCommand,
    preferences: SpeechPreferences,
    bookLanguage: string | null,
    voiceId: string,
  ): boolean {
    const token = command.token;
    if (
      disposed ||
      token.generation <= closedGeneration ||
      token.generation < generation ||
      (token.generation === generation && token.utterance <= sequence)
    )
      return false;
    if (token.generation > generation) {
      cancel();
      generation = token.generation;
      sequence = -1;
    }
    if (sequence < 0) {
      // The tap that starts reading lets this element play from now on (iOS
      // refuses audio started later, after the sentence arrives, otherwise)
      audio.src = SILENCE;
      audio.play().catch(() => {});
    }
    sequence = token.utterance;
    if (pending.size >= 2) {
      emit({ kind: "error", token, error: "synthesis-failed" });
      return false;
    }
    const id = key(token);
    const item: Pending = {
      token,
      controller: new AbortController(),
      url: null,
      started: false,
      rate: preferences.rate,
      startTimer: null,
    };
    pending.set(id, item);
    // A sentence that cannot be fetched and started in time is an error, never a silent stall
    item.startTimer = setTimeout(() => fail(id, "synthesis-failed"), 45_000);
    const language =
      command.segment.lang && command.segment.lang !== "und" ? command.segment.lang : bookLanguage;
    const before = previousText;
    previousText = command.segment.text;
    void options
      .fetch("/api/reader/narration/speech", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: command.segment.text, voiceId, language, previousText: before }),
        signal: item.controller.signal,
      })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "The natural voice could not read this sentence.");
        }
        return response.blob();
      })
      .then((blob) => {
        if (pending.get(id) !== item) return;
        item.url = URL.createObjectURL(blob);
        advance();
      })
      .catch((error: unknown) => {
        if (item.controller.signal.aborted || pending.get(id) !== item) return;
        options.onNotice?.(error instanceof Error ? error.message : "The natural voice could not read this sentence.");
        fail(id, "synthesis-failed");
      });
    return true;
  }

  return {
    speak,
    cancel,
    voices: () => voices,
    get pendingCount() {
      return pending.size;
    },
    destroy() {
      if (disposed) return;
      cancel();
      disposed = true;
      listing.abort();
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeAttribute("src");
    },
  };
}
