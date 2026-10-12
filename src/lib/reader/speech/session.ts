import type { DurtalLocator, EngineEvents, ReaderEngine } from "../engine";
import type { ReaderNavigation } from "../navigation";
import { createNativeSpeechSpeaker } from "./native-speaker";
import {
  initialSpeechPlayer,
  transitionSpeechPlayer,
  type SpeechAction,
  type SpeechPlayerState,
  type SpeechCommand,
} from "./player";
import {
  parseSpeechPreferences,
  readSpeechPreferences,
  writeSpeechPreferences,
  type SpeechPreferences,
  type SpeechPreferenceStorage,
  type SpeechVoice,
} from "./voices";

export interface SpeechSnapshot {
  state: SpeechPlayerState;
  open: boolean;
  preferences: SpeechPreferences;
  voices: SpeechVoice[];
  selectionReady: boolean;
}
/** A reader owns its speech work, native callbacks and navigation leases. */
export function createReaderSpeech(options: {
  engine: ReaderEngine;
  navigation: ReaderNavigation;
  bookLanguage: string | null;
  synthesis: SpeechSynthesis;
  Utterance: typeof SpeechSynthesisUtterance;
  document: Document;
  storage: SpeechPreferenceStorage | null;
  changed(snapshot: SpeechSnapshot): void;
}) {
  let state = initialSpeechPlayer(),
    open = false,
    disposed = false;
  let preferences = options.storage
    ? readSpeechPreferences(options.storage)
    : parseSpeechPreferences(null);
  let voices: SpeechVoice[] = [];
  let selectionAnchor: string | null = null,
    preparedSelection: string | null = null;
  const locatorKey = (locator: DurtalLocator) =>
    JSON.stringify([
      locator.fileHash,
      locator.sectionIndex,
      locator.cfi ?? locator.pdf,
    ]);
  const snapshot = (): SpeechSnapshot => ({
    state,
    open,
    preferences,
    voices,
    selectionReady:
      !!state.current &&
      (state.phase === "ready" || state.phase === "paused") &&
      !!selectionAnchor &&
      preparedSelection === selectionAnchor,
  });
  let extraction = new AbortController();
  let extractionSequence = 0;
  const notify = () => {
    if (!disposed) options.changed(snapshot());
  };
  const speaker = createNativeSpeechSpeaker({
    synthesis: options.synthesis,
    Utterance: options.Utterance,
    document: options.document,
    onAction: (action) => dispatch(action),
    onVoices: (available) => {
      voices = available;
      notify();
    },
  });
  const extracting = async (
    command: Extract<SpeechCommand, { kind: "prepare" | "request-next" }>,
  ) => {
    const signal = extraction.signal;
    const request = ++extractionSequence;
    const began = performance.now();
    try {
      const target =
        command.kind === "prepare"
          ? command.target
          : {
              kind: "adjacent" as const,
              direction: "next" as const,
              locator: command.after,
            };
      const result = await options.engine.prepareSpeech?.({ target, signal });
      if (disposed || signal.aborted || request !== extractionSequence) return;
      if (command.kind === "prepare") {
        performance.clearMeasures("reader-speech-preparation");
        performance.measure("reader-speech-preparation", {
          start: began,
          end: performance.now(),
        });
      }
      if (command.kind === "request-next")
        dispatch({
          kind: "successor",
          generation: command.generation,
          after: command.after,
          segment: result?.current ?? null,
        });
      else if (result?.current) {
        preparedSelection =
          command.target.kind === "from" &&
          command.target.from !== "visible" &&
          locatorKey(command.target.from) === selectionAnchor
            ? selectionAnchor
            : null;
        dispatch({
          kind: "prepared",
          generation: command.generation,
          ...result,
          current: result.current,
          exhausted: !result.next,
        });
      } else
        dispatch({
          kind: "preparation-failed",
          generation: command.generation,
          message: "No text available here to read aloud.",
        });
    } catch (error) {
      if (!disposed && !signal.aborted && request === extractionSequence)
        dispatch({
          kind: "preparation-failed",
          generation: command.generation,
          message:
            error instanceof Error
              ? error.message
              : "The text could not be prepared.",
        });
    }
  };
  function dispatch(action: SpeechAction) {
    if (disposed) return;
    if (action.kind === "prepare") {
      preparedSelection = null;
      if (action.target.kind === "from" && action.target.from === "visible")
        selectionAnchor = null;
    }
    const transition = transitionSpeechPlayer(state, action);
    state = transition.state;
    notify();
    for (const command of transition.commands) {
      if (disposed) return;
      switch (command.kind) {
        case "cancel":
          extraction.abort();
          extraction = new AbortController();
          ++extractionSequence;
          speaker.cancel();
          options.navigation.cancelSpeech();
          break;
        case "clear":
          break; // SLN-500's independent speech decoration group is still gated.
        case "prepare":
        case "request-next":
          void extracting(command);
          break;
        case "speak":
          speaker.speak(command, preferences, options.bookLanguage);
          break;
        case "show":
        case "select": {
          const generation = state.generation;
          void options.navigation
            .speechTo(command.segment.locator)
            .then(() => {
              if (
                command.kind === "select" &&
                !disposed &&
                generation === state.generation &&
                state.current === command.segment
              )
                options.engine.selectSpeechSentence?.(command.segment.locator);
            })
            .catch(() => {
              if (
                !disposed &&
                state.generation === generation &&
                state.current === command.segment
              )
                dispatch({
                  kind: "preparation-failed",
                  generation: state.generation,
                  message: "That speech sentence could not be opened.",
                });
            });
          break;
        }
      }
    }
  }
  const playing = () =>
    state.phase === "playing" ||
    state.phase === "starting" ||
    (state.phase === "preparing" && state.autoPlay);
  return {
    prepare() {
      dispatch({ kind: "prepare", target: { kind: "from", from: "visible" } });
    },
    selection(locator: DurtalLocator | null) {
      selectionAnchor = locator ? locatorKey(locator) : null;
      if (!locator) {
        preparedSelection = null;
        notify();
        return;
      }
      if (
        state.phase === "paused" &&
        state.current &&
        locatorKey(state.current.locator) === selectionAnchor
      ) {
        preparedSelection = selectionAnchor;
        notify();
        return;
      }
      dispatch({ kind: "prepare", target: { kind: "from", from: locator } });
    },
    startSelection(locator?: DurtalLocator) {
      if (disposed) return;
      if (locator && locatorKey(locator) !== selectionAnchor) {
        open = true;
        selectionAnchor = locatorKey(locator);
        preparedSelection = null;
        dispatch({ kind: "prepare", target: { kind: "from", from: locator } });
        return;
      }
      if (!snapshot().selectionReady) return;
      open = true;
      dispatch({ kind: "play" });
    },
    toggle() {
      if (disposed || !state.current) return;
      open = true;
      dispatch({ kind: playing() ? "pause" : "play" });
    },
    action(
      action: Extract<
        SpeechAction,
        { kind: "play" | "pause" | "stop" | "skip" }
      >,
    ) {
      if (action.kind === "stop") {
        open = false;
      }
      dispatch(action);
      if (action.kind === "stop")
        dispatch({
          kind: "prepare",
          target: { kind: "from", from: "visible" },
        });
    },
    preferences(next: SpeechPreferences) {
      preferences = next;
      if (options.storage) writeSpeechPreferences(options.storage, next);
      dispatch({ kind: "restart" });
      notify();
    },
    beginNavigation() {
      dispatch({ kind: "navigation-started" });
    },
    navigationSettled() {
      if (state.phase === "preparing" && !state.preparation)
        dispatch({
          kind: "prepare",
          target: { kind: "from", from: "visible" },
          autoPlay: playing(),
        });
    },
    relocate(location: EngineEvents["relocate"]) {
      if (
        location.origin === "speech" ||
        location.origin === "layout" ||
        location.reason === "layout"
      )
        return;
      const autoPlay = playing();
      dispatch({
        kind: "prepare",
        target: { kind: "from", from: "visible" },
        autoPlay,
      });
    },
    get snapshot(): SpeechSnapshot {
      return snapshot();
    },
    destroy() {
      disposed = true;
      extraction.abort();
      speaker.destroy();
      options.navigation.cancelSpeech();
    },
  };
}
export type ReaderSpeech = ReturnType<typeof createReaderSpeech>;
