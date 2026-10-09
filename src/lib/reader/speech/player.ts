import type { DurtalLocator } from "../engine";
import {
  nextSpeechGeneration,
  sameSpeechToken,
  type SpeechToken,
} from "./cancellation";

export interface SpeechSegment {
  text: string;
  lang: string;
  locator: DurtalLocator;
}
export type SpeechPhase =
  | "stopped"
  | "preparing"
  | "ready"
  | "starting"
  | "playing"
  | "paused";
interface SpeechUtterance {
  token: SpeechToken;
  segment: SpeechSegment;
}
export interface SpeechPlayerState {
  phase: SpeechPhase;
  generation: number;
  sequence: number;
  current: SpeechSegment | null;
  previous: SpeechSegment | null;
  next: SpeechSegment | null;
  active: SpeechUtterance | null;
  queued: SpeechUtterance | null;
  started: boolean;
  exhausted: boolean;
  retry: 0 | 1;
  queuedRetry: 0 | 1;
  selectOnReady: boolean;
  autoPlay: boolean;
  preparation: SpeechPreparation | null;
  message: string | null;
}
export type SpeechPreparation =
  | { kind: "from"; from: DurtalLocator | "visible" }
  | {
      kind: "adjacent";
      locator: DurtalLocator;
      direction: "previous" | "next";
    };
/** Declarative commands only. No native API, DOM, timer, network or storage here. */
export type SpeechCommand =
  | { kind: "cancel" }
  | { kind: "clear" }
  | { kind: "prepare"; generation: number; target: SpeechPreparation }
  | { kind: "request-next"; generation: number; after: DurtalLocator }
  | { kind: "speak"; token: SpeechToken; segment: SpeechSegment }
  | { kind: "show"; segment: SpeechSegment }
  | { kind: "select"; segment: SpeechSegment };
export type SpeechAction =
  | { kind: "prepare"; target: SpeechPreparation; autoPlay?: boolean }
  | {
      kind: "prepared";
      generation: number;
      current: SpeechSegment;
      previous?: SpeechSegment | null;
      next?: SpeechSegment | null;
      exhausted?: boolean;
    }
  | { kind: "preparation-failed"; generation: number; message: string }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "hidden" }
  | { kind: "stop" }
  | { kind: "restart" }
  | { kind: "skip"; direction: "previous" | "next" }
  | {
      kind: "successor";
      generation: number;
      after: DurtalLocator;
      segment: SpeechSegment | null;
    }
  | { kind: "started"; token: SpeechToken }
  | { kind: "ended"; token: SpeechToken }
  | { kind: "error"; token: SpeechToken; error: string };
export interface SpeechTransition {
  state: SpeechPlayerState;
  commands: SpeechCommand[];
}
export const SPEECH_VOICE_FAILURE =
  "Read aloud stopped: the voice failed. Try another voice.";

export function initialSpeechPlayer(): SpeechPlayerState {
  return {
    phase: "stopped",
    generation: 0,
    sequence: 0,
    current: null,
    previous: null,
    next: null,
    active: null,
    queued: null,
    started: false,
    exhausted: false,
    retry: 0,
    queuedRetry: 0,
    selectOnReady: false,
    autoPlay: false,
    preparation: null,
    message: null,
  };
}
const live = (state: SpeechPlayerState) =>
  state.phase === "starting" || state.phase === "playing";
const activePlayback = (state: SpeechPlayerState) =>
  live(state) || (state.phase === "preparing" && state.autoPlay);
const result = (
  state: SpeechPlayerState,
  commands: SpeechCommand[] = [],
): SpeechTransition => ({ state, commands });

/** Identity includes the range, not just its page: PDF sentences share a page. */
function sameSentence(a: DurtalLocator, b: DurtalLocator): boolean {
  return (
    a.fileHash === b.fileHash &&
    a.sectionIndex === b.sectionIndex &&
    a.href === b.href &&
    a.cfi === b.cfi &&
    a.pdf?.page === b.pdf?.page &&
    JSON.stringify(a.pdf?.rects) === JSON.stringify(b.pdf?.rects) &&
    a.text?.highlight === b.text?.highlight &&
    a.text?.before === b.text?.before &&
    a.text?.after === b.text?.after &&
    a.progression === b.progression
  );
}
function begin(
  state: SpeechPlayerState,
  invalidate: boolean,
): SpeechTransition {
  if (!state.current) return result(state);
  const generation = invalidate
    ? nextSpeechGeneration(state.generation)
    : state.generation;
  const sequence = nextSpeechGeneration(state.sequence);
  const active = {
    token: { generation, utterance: sequence },
    segment: state.current,
  };
  return result(
    {
      ...state,
      phase: "starting",
      generation,
      sequence,
      active,
      queued: null,
      started: false,
      autoPlay: false,
      preparation: null,
      selectOnReady: false,
      queuedRetry: 0,
      message: null,
    },
    [
      ...(invalidate ? [{ kind: "cancel" } as const] : []),
      { kind: "speak", ...active },
      ...(!state.next && !state.exhausted
        ? [
            {
              kind: "request-next",
              generation,
              after: state.current.locator,
            } as const,
          ]
        : []),
    ],
  );
}
function enqueue(state: SpeechPlayerState): SpeechTransition {
  if (!state.next || state.queued || !state.started || !state.active)
    return result(state);
  const sequence = nextSpeechGeneration(state.sequence);
  const queued = {
    token: { generation: state.generation, utterance: sequence },
    segment: state.next,
  };
  return result({ ...state, sequence, queued }, [{ kind: "speak", ...queued }]);
}
function pause(
  state: SpeechPlayerState,
  message: string | null = null,
): SpeechTransition {
  if (!live(state) && state.phase !== "preparing") return result(state);
  const current = state.current;
  return result(
    {
      ...state,
      phase: current ? "paused" : "stopped",
      generation: nextSpeechGeneration(state.generation),
      active: null,
      queued: null,
      started: false,
      autoPlay: false,
      preparation: null,
      queuedRetry: 0,
      message,
    },
    [
      { kind: "cancel" },
      ...(current ? [{ kind: "select", segment: current } as const] : []),
    ],
  );
}
function stop(state: SpeechPlayerState): SpeechTransition {
  return result(
    {
      ...initialSpeechPlayer(),
      generation: nextSpeechGeneration(state.generation),
      sequence: state.sequence,
    },
    [{ kind: "cancel" }, { kind: "clear" }],
  );
}

/** Preparation must complete before a first trusted activation dispatches play. */
export function transitionSpeechPlayer(
  state: SpeechPlayerState,
  action: SpeechAction,
): SpeechTransition {
  switch (action.kind) {
    case "prepare": {
      const generation = nextSpeechGeneration(state.generation);
      return result(
        {
          ...initialSpeechPlayer(),
          phase: "preparing",
          generation,
          sequence: state.sequence,
          autoPlay: action.autoPlay === true && activePlayback(state),
          preparation: action.target,
        },
        [
          { kind: "cancel" },
          { kind: "clear" },
          { kind: "prepare", generation, target: action.target },
        ],
      );
    }
    case "prepared": {
      if (
        action.generation !== state.generation ||
        state.phase !== "preparing" ||
        !state.preparation
      )
        return result(state);
      const ready: SpeechPlayerState = {
        ...state,
        phase: "ready",
        preparation: null,
        current: action.current,
        previous: action.previous ?? null,
        next: action.next ?? null,
        exhausted: action.exhausted === true && !action.next,
      };
      if (state.autoPlay) return begin(ready, false);
      return state.selectOnReady
        ? result({ ...ready, phase: "paused", selectOnReady: false }, [
            { kind: "select", segment: action.current },
          ])
        : result(ready);
    }
    case "preparation-failed":
      if (action.generation !== state.generation) return result(state);
      return result(
        {
          ...state,
          generation: nextSpeechGeneration(state.generation),
          phase: state.current ? "paused" : "stopped",
          autoPlay: false,
          preparation: null,
          active: null,
          queued: null,
          started: false,
          message: action.message,
        },
        [
          { kind: "cancel" },
          ...(state.current
            ? [{ kind: "select", segment: state.current } as const]
            : []),
        ],
      );
    case "play":
      return state.phase === "ready" || state.phase === "paused"
        ? begin({ ...state, retry: 0 }, true)
        : result(state);
    case "pause":
    case "hidden":
      return pause(state);
    case "stop":
      return stop(state);
    case "restart":
      return live(state) ? begin({ ...state, retry: 0 }, true) : result(state);
    case "skip": {
      if (!state.current || state.phase === "stopped") return result(state);
      const segment = action.direction === "next" ? state.next : state.previous;
      if (action.direction === "next" && state.exhausted && !segment)
        return stop(state);
      if (!segment) {
        const generation = nextSpeechGeneration(state.generation);
        return result(
          {
            ...state,
            phase: "preparing",
            generation,
            active: null,
            queued: null,
            started: false,
            autoPlay: activePlayback(state),
            selectOnReady: !activePlayback(state),
            preparation: {
              kind: "adjacent",
              locator: state.current.locator,
              direction: action.direction,
            },
            message: null,
          },
          [
            { kind: "cancel" },
            {
              kind: "prepare",
              generation,
              target: {
                kind: "adjacent",
                locator: state.current.locator,
                direction: action.direction,
              },
            },
          ],
        );
      }
      const moved: SpeechPlayerState = {
        ...state,
        current: segment,
        previous: action.direction === "next" ? state.current : null,
        next: action.direction === "previous" ? state.current : null,
        exhausted: false,
        retry: 0,
        queuedRetry: 0,
        preparation: null,
        active: null,
        queued: null,
        started: false,
        message: null,
      };
      if (activePlayback(state)) return begin(moved, true);
      const generation = nextSpeechGeneration(state.generation);
      return result({ ...moved, phase: "paused", generation }, [
        { kind: "cancel" },
        { kind: "select", segment },
        ...(!moved.next
          ? [
              {
                kind: "request-next",
                generation,
                after: segment.locator,
              } as const,
            ]
          : []),
      ]);
    }
    case "successor": {
      if (
        action.generation !== state.generation ||
        !state.current ||
        !sameSentence(action.after, state.current.locator) ||
        state.next ||
        state.queued ||
        state.preparation
      )
        return result(state);
      if (!action.segment) {
        if (state.phase === "preparing" && state.autoPlay) return stop(state);
        return result({ ...state, exhausted: true });
      }
      if (state.phase === "preparing" && state.autoPlay) {
        return begin(
          {
            ...state,
            current: action.segment,
            previous: state.current,
            next: null,
            exhausted: false,
            retry: 0,
          },
          false,
        );
      }
      return enqueue({ ...state, next: action.segment, exhausted: false });
    }
    case "started": {
      if (sameSpeechToken(state.queued?.token ?? null, action.token)) {
        // A native engine may dispatch successor start before predecessor end.
        const queued = state.queued!;
        const moved: SpeechPlayerState = {
          ...state,
          phase: "playing",
          current: queued.segment,
          previous: state.current,
          next: null,
          active: queued,
          queued: null,
          started: true,
          exhausted: false,
          retry: state.queuedRetry,
          queuedRetry: 0,
        };
        return result(moved, [
          { kind: "show", segment: queued.segment },
          {
            kind: "request-next",
            generation: state.generation,
            after: queued.segment.locator,
          },
        ]);
      }
      if (
        !sameSpeechToken(state.active?.token ?? null, action.token) ||
        state.started
      )
        return result(state);
      const started = enqueue({ ...state, phase: "playing", started: true });
      return result(started.state, [
        { kind: "show", segment: state.current! },
        ...started.commands,
      ]);
    }
    case "ended": {
      if (!sameSpeechToken(state.active?.token ?? null, action.token))
        return result(state);
      if (state.queued) {
        const queued = state.queued;
        return result(
          {
            ...state,
            phase: "starting",
            current: queued.segment,
            previous: state.current,
            next: null,
            active: queued,
            queued: null,
            started: false,
            exhausted: false,
            retry: state.queuedRetry,
            queuedRetry: 0,
          },
          [
            {
              kind: "request-next",
              generation: state.generation,
              after: queued.segment.locator,
            },
          ],
        );
      }
      if (state.next)
        return begin(
          {
            ...state,
            current: state.next,
            previous: state.current,
            next: null,
            active: null,
            started: false,
            retry: 0,
          },
          false,
        );
      if (state.exhausted) return stop(state);
      // Late extraction is allowed to finish, with only one outstanding request.
      return result({
        ...state,
        phase: "preparing",
        active: null,
        queued: null,
        started: false,
        autoPlay: true,
      });
    }
    case "error": {
      if (sameSpeechToken(state.queued?.token ?? null, action.token)) {
        if (action.error === "interrupted" || action.error === "canceled")
          return pause(state);
        if (state.queuedRetry === 1)
          return pause(
            {
              ...state,
              current: state.queued!.segment,
              previous: state.current,
              next: null,
              exhausted: false,
              retry: 1,
            },
            SPEECH_VOICE_FAILURE,
          );
        // Retry the queued sentence without interrupting the one still speaking.
        return enqueue({ ...state, queued: null, queuedRetry: 1 });
      }
      if (!sameSpeechToken(state.active?.token ?? null, action.token))
        return result(state);
      if (action.error === "interrupted" || action.error === "canceled")
        return pause(state);
      if (state.retry === 1) return pause(state, SPEECH_VOICE_FAILURE);
      return begin({ ...state, retry: 1 }, true);
    }
  }
}
