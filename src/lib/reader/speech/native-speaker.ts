import type { SpeechAction, SpeechCommand, SpeechSegment } from "./player";
import type { SpeechToken } from "./cancellation";
import {
  choosePassageVoice,
  type SpeechPreferences,
  type SpeechVoice,
} from "./voices";

type SpeakCommand = Extract<SpeechCommand, { kind: "speak" }>;
type NativeAction = Extract<
  SpeechAction,
  { kind: "started" | "ended" | "error" | "hidden" }
>;
interface PendingUtterance {
  utterance: SpeechSynthesisUtterance;
  detach(): void;
  startDeadline(): void;
}
const key = (token: SpeechToken) => `${token.generation}:${token.utterance}`;
const metadata = (voices: readonly SpeechSynthesisVoice[]): SpeechVoice[] =>
  voices.map((voice) => ({
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
    default: voice.default,
  }));

/** One speaker per reader session. The platform objects are passed from its client effect. */
export function createNativeSpeechSpeaker(options: {
  synthesis: SpeechSynthesis;
  Utterance: typeof SpeechSynthesisUtterance;
  document: Document;
  onAction(action: NativeAction): void;
  onVoices?(voices: SpeechVoice[]): void;
}) {
  const { synthesis, Utterance, document: doc } = options;
  const pending = new Map<string, PendingUtterance>();
  let generation = -1;
  let closedGeneration = -1;
  let sequence = -1;
  let disposed = false;
  const emit = (action: NativeAction) => {
    if (!disposed) options.onAction(action);
  };
  const voices = () => {
    try {
      return synthesis.getVoices();
    } catch {
      return [];
    }
  };
  const voiceChange = () => {
    if (!disposed) options.onVoices?.(metadata(voices()));
  };

  function cancel() {
    closedGeneration = Math.max(closedGeneration, generation);
    const owned = pending.size > 0;
    // Native cancel can dispatch errors synchronously; detach before it does.
    for (const item of pending.values()) item.detach();
    pending.clear();
    if (owned) {
      try {
        synthesis.cancel();
      } catch {
        /* The reducer already invalidated this generation. */
      }
    }
  }
  const hidden = () => {
    cancel();
    emit({ kind: "hidden" });
  };
  const visibility = () => {
    if (doc.visibilityState === "hidden") hidden();
  };
  synthesis.addEventListener("voiceschanged", voiceChange);
  doc.addEventListener("visibilitychange", visibility);
  doc.defaultView?.addEventListener("pagehide", hidden);
  voiceChange();

  function speak(
    command: SpeakCommand,
    preferences: SpeechPreferences,
    bookLanguage: string | null,
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
      // A replacement cannot leave utterances from the former session queued.
      cancel();
      generation = token.generation;
      sequence = -1;
    }
    sequence = token.utterance;
    if (doc.visibilityState === "hidden") {
      hidden();
      return false;
    }
    if (pending.size >= 2) {
      emit({ kind: "error", token, error: "synthesis-failed" });
      return false;
    }
    const available = voices();
    const choice = choosePassageVoice(
      metadata(available),
      command.segment.lang,
      bookLanguage,
      preferences,
    );
    if (choice.kind === "missing") {
      emit({ kind: "error", token, error: "voice-unavailable" });
      return false;
    }
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = new Utterance(command.segment.text);
    } catch {
      emit({ kind: "error", token, error: "synthesis-unavailable" });
      return false;
    }
    utterance.voice =
      available.find((voice) => voice.voiceURI === choice.voice.voiceURI) ??
      null;
    utterance.lang = command.segment.lang;
    utterance.rate = preferences.rate;
    const id = key(token);
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let endTimer: ReturnType<typeof setTimeout> | null = null;
    let started = false;
    const clearTimers = () => {
      if (startTimer !== null) clearTimeout(startTimer);
      if (endTimer !== null) clearTimeout(endTimer);
      startTimer = endTimer = null;
    };
    const detach = () => {
      clearTimers();
      utterance.removeEventListener("start", onStart);
      utterance.removeEventListener("end", onEnd);
      utterance.removeEventListener("error", onError);
    };
    const finish = (action: NativeAction) => {
      if (!pending.has(id)) return;
      detach();
      pending.delete(id);
      emit(action);
      pending.values().next().value?.startDeadline();
    };
    const onStart = () => {
      if (started || !pending.has(id)) return;
      started = true;
      // Native queue advancement is stronger than a missing predecessor end callback.
      // Retire its handlers/deadline without fabricating an end event.
      for (const [previousId, previous] of pending) {
        if (previousId === id) break;
        previous.detach();
        pending.delete(previousId);
      }
      if (startTimer !== null) clearTimeout(startTimer);
      startTimer = null;
      // A one-shot deadline prevents missing native callbacks from leaving a false Playing state.
      endTimer = setTimeout(
        expire,
        completionDeadlineMs(command.segment, preferences.rate),
      );
      emit({ kind: "started", token });
    };
    const onEnd = () => finish({ kind: "ended", token });
    const onError = (event: Event) =>
      finish({
        kind: "error",
        token,
        error: (event as SpeechSynthesisErrorEvent).error || "synthesis-failed",
      });
    const expire = () => {
      if (!pending.has(id)) return;
      cancel();
      emit({ kind: "error", token, error: "synthesis-failed" });
    };
    const startDeadline = () => {
      if (!started && startTimer === null)
        startTimer = setTimeout(expire, 10_000);
    };
    utterance.addEventListener("start", onStart);
    utterance.addEventListener("end", onEnd);
    utterance.addEventListener("error", onError);
    pending.set(id, { utterance, detach, startDeadline });
    // A queued successor waits behind the current utterance. Only an empty queue
    // can be expected to start immediately; its successor gets its own deadline on start.
    if (pending.size === 1) startDeadline();
    try {
      if (synthesis.paused) synthesis.resume();
      synthesis.speak(utterance); // No promise/timer between the trusted handler and this call.
      return true;
    } catch {
      expire();
      return false;
    }
  }
  return {
    speak,
    cancel,
    voices: () => metadata(voices()),
    get pendingCount() {
      return pending.size;
    },
    destroy() {
      if (disposed) return;
      cancel();
      disposed = true;
      synthesis.removeEventListener("voiceschanged", voiceChange);
      doc.removeEventListener("visibilitychange", visibility);
      doc.defaultView?.removeEventListener("pagehide", hidden);
    },
  };
}

/** Missing native completion eventually becomes a visible error, never a fabricated end. */
function completionDeadlineMs(segment: SpeechSegment, rate: number): number {
  return Math.min(
    30 * 60_000,
    Math.max(
      30_000,
      Math.ceil(segment.text.length / (3 * rate)) * 1000 + 30_000,
    ),
  );
}
