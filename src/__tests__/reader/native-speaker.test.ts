// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeSpeechSpeaker } from "@/lib/reader/speech/native-speaker";
import {
  parseSpeechPreferences,
  rememberSpeechVoice,
} from "@/lib/reader/speech/voices";
import {
  initialSpeechPlayer,
  transitionSpeechPlayer,
  type SpeechAction,
  type SpeechCommand,
  type SpeechSegment,
} from "@/lib/reader/speech/player";

// A deterministic platform test double, never evidence of native/browser speech.
class Utterance extends EventTarget {
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  constructor(public text: string) {
    super();
  }
}
const english = {
  voiceURI: "en-local",
  name: "English",
  lang: "en",
  localService: true,
  default: true,
} as SpeechSynthesisVoice;
const french = {
  ...english,
  voiceURI: "fr-local",
  name: "French",
  lang: "fr",
  default: false,
} as SpeechSynthesisVoice;
const italian = {
  ...english,
  voiceURI: "it-local",
  name: "Italian",
  lang: "it",
  default: false,
} as SpeechSynthesisVoice;
const sentence = (text = "First sentence.", lang = "en"): SpeechSegment => ({
  text,
  lang,
  locator: {
    v: 1,
    fileHash: "a".repeat(64),
    href: "chapter.xhtml",
    sectionIndex: 0,
    progression: 0,
    totalProgression: 0,
    cfi: `epubcfi(${text})`,
    text: { highlight: text },
  },
});
const command = (
  generation: number,
  utterance: number,
  segment = sentence(),
): Extract<SpeechCommand, { kind: "speak" }> => ({
  kind: "speak",
  token: { generation, utterance },
  segment,
});
const defaults = parseSpeechPreferences(null);
const speakers: ReturnType<typeof createNativeSpeechSpeaker>[] = [];
function setup() {
  const platform = Object.assign(new EventTarget(), {
    paused: false,
    getVoices: vi.fn(() => [english] as SpeechSynthesisVoice[]),
    speak: vi.fn((_utterance: SpeechSynthesisUtterance) => {}),
    cancel: vi.fn(),
    resume: vi.fn(),
  });
  const onAction = vi.fn<(action: SpeechAction) => void>(),
    onVoices = vi.fn();
  const speaker = createNativeSpeechSpeaker({
    synthesis: platform as unknown as SpeechSynthesis,
    Utterance: Utterance as unknown as typeof SpeechSynthesisUtterance,
    document,
    onAction,
    onVoices,
  });
  speakers.push(speaker);
  const utterance = (index = platform.speak.mock.calls.length - 1) =>
    platform.speak.mock.calls[index][0];
  return { platform, speaker, onAction, onVoices, utterance };
}
const fail = (utterance: SpeechSynthesisUtterance, error: string) =>
  utterance.dispatchEvent(Object.assign(new Event("error"), { error }));
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
afterEach(() => {
  for (const speaker of speakers.splice(0)) speaker.destroy();
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("native speech driver with a deterministic platform double", () => {
  it("calls the platform synchronously with plain sentence text, a native voice, language and speed", () => {
    const s = setup();
    const order: string[] = [];
    s.platform.speak.mockImplementation(() => {
      order.push("speak");
    });
    order.push("handler");
    expect(
      s.speaker.speak(command(1, 1), { ...defaults, rate: 1.25 }, "en"),
    ).toBe(true);
    order.push("handler returned");
    expect(order).toEqual(["handler", "speak", "handler returned"]);
    expect(s.utterance()).toMatchObject({
      text: "First sentence.",
      lang: "en",
      voice: english,
      rate: 1.25,
    });
    expect(s.speaker.pendingCount).toBe(1);
  });
  it("reports start/end only from their platform callbacks and clears references/timers", () => {
    const s = setup();
    s.speaker.speak(command(1, 1), defaults, "en");
    expect(s.onAction).not.toHaveBeenCalled();
    s.utterance().dispatchEvent(new Event("start"));
    s.utterance().dispatchEvent(new Event("start"));
    expect(s.onAction.mock.calls).toEqual([
      [{ kind: "started", token: { generation: 1, utterance: 1 } }],
    ]);
    s.utterance().dispatchEvent(new Event("end"));
    expect(s.onAction).toHaveBeenLastCalledWith({
      kind: "ended",
      token: { generation: 1, utterance: 1 },
    });
    expect(s.speaker.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    s.utterance().dispatchEvent(new Event("end"));
    expect(s.onAction).toHaveBeenCalledTimes(2);
  });
  it("bounds the native queue to two and ignores duplicate/stale speak commands", () => {
    const s = setup();
    expect(s.speaker.speak(command(1, 1), defaults, "en")).toBe(true);
    expect(s.speaker.speak(command(1, 1), defaults, "en")).toBe(false);
    expect(
      s.speaker.speak(command(1, 2, sentence("Second.")), defaults, "en"),
    ).toBe(true);
    expect(
      s.speaker.speak(command(1, 3, sentence("Third.")), defaults, "en"),
    ).toBe(false);
    expect(s.speaker.pendingCount).toBe(2);
    expect(s.platform.speak).toHaveBeenCalledTimes(2);
  });
  it("does not time out a queued successor while a long sentence is still speaking", () => {
    const s = setup();
    s.speaker.speak(command(1, 1, sentence("x".repeat(1000))), defaults, "en");
    s.utterance().dispatchEvent(new Event("start"));
    s.speaker.speak(command(1, 2, sentence("Next.")), defaults, "en");
    vi.advanceTimersByTime(10_001);
    expect(s.onAction).toHaveBeenCalledTimes(1);
    s.utterance(0).dispatchEvent(new Event("end"));
    vi.advanceTimersByTime(9999);
    expect(s.onAction).toHaveBeenLastCalledWith({
      kind: "ended",
      token: { generation: 1, utterance: 1 },
    });
    vi.advanceTimersByTime(1);
    expect(s.onAction).toHaveBeenLastCalledWith({
      kind: "error",
      token: { generation: 1, utterance: 2 },
      error: "synthesis-failed",
    });
    expect(s.platform.cancel).toHaveBeenCalledTimes(1);
    expect(s.speaker.pendingCount).toBe(0);
  });
  it("a successor start retires a missing predecessor end without fabricating one", () => {
    const s = setup();
    s.speaker.speak(command(1, 1, sentence("x")), defaults, "en");
    s.utterance().dispatchEvent(new Event("start"));
    s.speaker.speak(command(1, 2, sentence("x".repeat(1000))), defaults, "en");
    s.utterance(1).dispatchEvent(new Event("start"));
    expect(s.speaker.pendingCount).toBe(1);
    vi.advanceTimersByTime(34_000);
    s.utterance(0).dispatchEvent(new Event("end"));
    expect(s.onAction.mock.calls.map(([action]) => action.kind)).toEqual([
      "started",
      "started",
    ]);
    expect(s.platform.cancel).not.toHaveBeenCalled();
  });
  it("cancels owned speech on missing callbacks instead of inventing success", () => {
    const s = setup();
    s.speaker.speak(command(1, 1), defaults, "en");
    vi.advanceTimersByTime(10_000);
    expect(s.platform.cancel).toHaveBeenCalledTimes(1);
    expect(s.onAction).toHaveBeenLastCalledWith({
      kind: "error",
      token: { generation: 1, utterance: 1 },
      error: "synthesis-failed",
    });
    expect(s.speaker.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.speaker.speak(command(1, 99), defaults, "en")).toBe(false);
  });
  it("a missing completion callback has a bounded one-shot error deadline", () => {
    const s = setup();
    s.speaker.speak(
      command(1, 1, sentence("x".repeat(100_000))),
      defaults,
      "en",
    );
    s.utterance().dispatchEvent(new Event("start"));
    vi.advanceTimersByTime(30 * 60_000 - 1);
    expect(s.onAction).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(s.onAction.mock.calls.map(([action]) => action.kind)).toEqual([
      "started",
      "error",
    ]);
    expect(s.platform.cancel).toHaveBeenCalledTimes(1);
  });
  it("detaches before native cancel emits interrupted/canceled callbacks", () => {
    const s = setup();
    s.speaker.speak(command(1, 1), defaults, "en");
    s.speaker.speak(command(1, 2, sentence("Second.")), defaults, "en");
    s.platform.cancel.mockImplementation(() => {
      fail(s.utterance(0), "interrupted");
      fail(s.utterance(1), "canceled");
    });
    s.speaker.cancel();
    expect(s.onAction).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(s.speaker.speak(command(1, 3), defaults, "en")).toBe(false);
    expect(s.speaker.speak(command(2, 3), defaults, "en")).toBe(true);
  });
  it("voice discovery refreshes and explicit/foreign passage choices use the actual voice objects", () => {
    const s = setup();
    expect(s.onVoices).toHaveBeenCalledTimes(1);
    s.platform.getVoices.mockReturnValue([english, french, italian]);
    s.platform.dispatchEvent(new Event("voiceschanged"));
    expect(s.onVoices.mock.calls[1][0]).toHaveLength(3);
    s.speaker.speak(command(1, 1, sentence("Bonjour.", "fr")), defaults, "en");
    expect(s.utterance().voice).toBe(french);
    s.speaker.cancel();
    s.speaker.speak(
      command(2, 2, sentence("Latin.", "la")),
      rememberSpeechVoice(defaults, "la", italian.voiceURI),
      "la",
    );
    expect(s.utterance().voice).toBe(italian);
  });
  it("a disappeared remembered voice falls back, and a missing book voice reports failure without speak", () => {
    const s = setup();
    s.speaker.speak(
      command(1, 1),
      rememberSpeechVoice(defaults, "en", "gone"),
      "en",
    );
    expect(s.utterance().voice).toBe(english);
    s.speaker.cancel();
    expect(
      s.speaker.speak(command(2, 2, sentence("Latin.", "la")), defaults, "la"),
    ).toBe(false);
    expect(s.platform.speak).toHaveBeenCalledTimes(1);
    expect(s.onAction).toHaveBeenLastCalledWith({
      kind: "error",
      token: { generation: 2, utterance: 2 },
      error: "voice-unavailable",
    });
  });
  it("hidden/pagehide cancel and emit Paused intent; foreground never resumes by itself", () => {
    const s = setup();
    s.speaker.speak(command(1, 1), defaults, "en");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(s.onAction).toHaveBeenLastCalledWith({ kind: "hidden" });
    expect(s.speaker.pendingCount).toBe(0);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(s.platform.speak).toHaveBeenCalledTimes(1);
    s.speaker.speak(command(2, 2), defaults, "en");
    window.dispatchEvent(new Event("pagehide"));
    expect(s.onAction).toHaveBeenCalledTimes(2);
    expect(s.speaker.pendingCount).toBe(0);
  });
  it("destroy is idempotent and removes native/doc listeners and all deadlines", () => {
    const s = setup();
    s.speaker.speak(command(1, 1), defaults, "en");
    s.speaker.destroy();
    s.speaker.destroy();
    s.platform.dispatchEvent(new Event("voiceschanged"));
    window.dispatchEvent(new Event("pagehide"));
    s.utterance().dispatchEvent(new Event("start"));
    expect(s.onAction).not.toHaveBeenCalled();
    expect(s.onVoices).toHaveBeenCalledTimes(1);
    expect(s.platform.cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(s.speaker.speak(command(2, 2), defaults, "en")).toBe(false);
  });
  it("the approved reducer and driver retry real platform failures once, then pause", () => {
    const s = setup();
    let state = initialSpeechPlayer();
    const dispatch = (action: SpeechAction) => {
      const transition = transitionSpeechPlayer(state, action);
      state = transition.state;
      for (const effect of transition.commands) {
        if (effect.kind === "cancel") s.speaker.cancel();
        if (effect.kind === "speak") s.speaker.speak(effect, defaults, "en");
      }
    };
    s.onAction.mockImplementation(dispatch);
    dispatch({ kind: "prepare", target: { kind: "from", from: "visible" } });
    dispatch({
      kind: "prepared",
      generation: state.generation,
      current: sentence(),
      exhausted: true,
    });
    dispatch({ kind: "play" });
    s.utterance().dispatchEvent(new Event("start"));
    fail(s.utterance(), "synthesis-failed");
    expect(s.platform.speak).toHaveBeenCalledTimes(2);
    s.utterance().dispatchEvent(new Event("start"));
    fail(s.utterance(), "synthesis-failed");
    expect(state.phase).toBe("paused");
    expect(s.platform.speak).toHaveBeenCalledTimes(2);
    expect(s.speaker.pendingCount).toBe(0);
  });
  it("a synchronous platform throw reports failure and releases the owned queue", () => {
    const s = setup();
    s.platform.speak.mockImplementation(() => {
      throw new Error("platform failed");
    });
    expect(s.speaker.speak(command(1, 1), defaults, "en")).toBe(false);
    expect(s.onAction).toHaveBeenLastCalledWith({
      kind: "error",
      token: { generation: 1, utterance: 1 },
      error: "synthesis-failed",
    });
    expect(s.speaker.pendingCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
