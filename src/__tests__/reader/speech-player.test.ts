import { describe, expect, it } from "vitest";
import {
  initialSpeechPlayer,
  transitionSpeechPlayer,
  SPEECH_VOICE_FAILURE,
  type SpeechAction,
  type SpeechPlayerState,
  type SpeechSegment,
} from "@/lib/reader/speech/player";
import type { SpeechToken } from "@/lib/reader/speech/cancellation";

const sentence = (index: number): SpeechSegment => ({
  text: `Sentence ${index}.`,
  lang: "en",
  locator: {
    v: 1,
    fileHash: "a".repeat(64),
    href: "chapter.xhtml",
    sectionIndex: 0,
    progression: index / 10,
    totalProgression: index / 10,
    cfi: `epubcfi(${index})`,
    text: { highlight: `Sentence ${index}.` },
  },
});
function setup(next: SpeechSegment | null = sentence(2)) {
  let state = initialSpeechPlayer();
  const send = (action: SpeechAction) => {
    const transition = transitionSpeechPlayer(state, action);
    state = transition.state;
    return transition.commands;
  };
  send({ kind: "prepare", target: { kind: "from", from: "visible" } });
  send({
    kind: "prepared",
    generation: state.generation,
    current: sentence(1),
    next,
  });
  return { send, state: () => state, token: () => state.active!.token };
}
const started = () => {
  const p = setup();
  p.send({ kind: "play" });
  p.send({ kind: "started", token: p.token() });
  return p;
};

describe("pure speech player lifecycle", () => {
  it("prepares without speaking and yields the real first speak command synchronously on play", () => {
    const p = setup();
    expect(p.state().phase).toBe("ready");
    const commands = p.send({ kind: "play" });
    expect(commands).toEqual([
      { kind: "cancel" },
      { kind: "speak", token: p.token(), segment: sentence(1) },
    ]);
    expect(p.state().queued).toBeNull();
    const start = p.send({ kind: "started", token: p.token() });
    expect(start.map((command) => command.kind)).toEqual(["show", "speak"]);
    expect(p.state().queued?.segment).toEqual(sentence(2));
  });
  it("does not speak before preparation or authorize autoplay on a first open", () => {
    const state = transitionSpeechPlayer(initialSpeechPlayer(), {
      kind: "prepare",
      target: { kind: "from", from: "visible" },
      autoPlay: true,
    }).state;
    expect(transitionSpeechPlayer(state, { kind: "play" }).commands).toEqual(
      [],
    );
    const ready = transitionSpeechPlayer(state, {
      kind: "prepared",
      generation: state.generation,
      current: sentence(1),
    });
    expect(ready.state.phase).toBe("ready");
    expect(ready.commands).toEqual([]);
  });
  it("keeps exactly one queued successor over repeated start and extraction callbacks", () => {
    const p = started();
    const queued = p.state().queued;
    expect(p.send({ kind: "started", token: p.token() })).toEqual([]);
    expect(
      p.send({
        kind: "successor",
        generation: p.state().generation,
        after: sentence(1).locator,
        segment: sentence(3),
      }),
    ).toEqual([]);
    expect(p.state().queued).toBe(queued);
  });
  it("pause cancels; resume replays the same sentence; late end/error cannot advance it", () => {
    const p = started();
    const old = p.token();
    expect(p.send({ kind: "pause" })).toEqual([
      { kind: "cancel" },
      { kind: "select", segment: sentence(1) },
    ]);
    const paused = p.state();
    expect(p.send({ kind: "ended", token: old })).toEqual([]);
    expect(
      p.send({ kind: "error", token: old, error: "synthesis-failed" }),
    ).toEqual([]);
    expect(p.state()).toBe(paused);
    expect(
      p.send({ kind: "play" }).find((command) => command.kind === "speak"),
    ).toMatchObject({ segment: sentence(1) });
    expect(p.token()).not.toEqual(old);
  });
  it("hidden preparation and playback cannot resume themselves", () => {
    const p = started();
    p.send({
      kind: "prepare",
      target: { kind: "from", from: "visible" },
      autoPlay: true,
    });
    const generation = p.state().generation;
    p.send({ kind: "hidden" });
    expect(
      p.send({ kind: "prepared", generation, current: sentence(3) }),
    ).toEqual([]);
    expect(p.state().phase).toBe("stopped");
    const playing = started();
    playing.send({ kind: "hidden" });
    expect(playing.state().phase).toBe("paused");
    expect(playing.state().active).toBeNull();
  });
  it("a manual navigation invalidates old work and resumes only the newly prepared page", () => {
    const p = started();
    const token = p.token(),
      generation = p.state().generation;
    p.send({
      kind: "prepare",
      target: { kind: "from", from: sentence(4).locator },
      autoPlay: true,
    });
    expect(
      p.send({
        kind: "successor",
        generation,
        after: sentence(1).locator,
        segment: sentence(2),
      }),
    ).toEqual([]);
    expect(p.send({ kind: "ended", token })).toEqual([]);
    const commands = p.send({
      kind: "prepared",
      generation: p.state().generation,
      current: sentence(4),
    });
    expect(commands[0]).toMatchObject({ kind: "speak", segment: sentence(4) });
    expect(p.state().previous).toBeNull();
  });
  it("promotes a native queued start arriving before the old end without a duplicate speak", () => {
    const p = started();
    const old = p.token(),
      queued = p.state().queued!.token;
    expect(
      p.send({ kind: "started", token: queued }).map((c) => c.kind),
    ).toEqual(["show", "request-next"]);
    expect(p.state().current).toEqual(sentence(2));
    expect(p.send({ kind: "ended", token: old })).toEqual([]);
    expect(p.send({ kind: "started", token: queued })).toEqual([]);
  });
  it("promotes an already spoken queued utterance on end without speaking it twice", () => {
    const p = started();
    const queued = p.state().queued!.token;
    const commands = p.send({ kind: "ended", token: p.token() });
    expect(commands.map((c) => c.kind)).toEqual(["request-next"]);
    expect(p.token()).toEqual(queued);
    expect(p.state().previous).toEqual(sentence(1));
    p.send({ kind: "started", token: queued });
    expect(p.state().phase).toBe("playing");
  });
  it("late extraction chains after end and EOF stops once without retaining ranges", () => {
    const p = setup(null);
    const play = p.send({ kind: "play" });
    expect(play.filter((c) => c.kind === "request-next")).toHaveLength(1);
    p.send({ kind: "started", token: p.token() });
    const old = p.token();
    expect(p.send({ kind: "ended", token: old })).toEqual([]);
    expect(p.state().phase).toBe("preparing");
    const next = p.send({
      kind: "successor",
      generation: p.state().generation,
      after: sentence(1).locator,
      segment: sentence(2),
    });
    expect(next[0]).toMatchObject({ kind: "speak", segment: sentence(2) });
    p.send({ kind: "started", token: p.token() });
    p.send({
      kind: "successor",
      generation: p.state().generation,
      after: sentence(2).locator,
      segment: null,
    });
    const last = p.token();
    expect(p.send({ kind: "ended", token: last })).toEqual([
      { kind: "cancel" },
      { kind: "clear" },
    ]);
    expect(p.state().phase).toBe("stopped");
    expect([
      p.state().current,
      p.state().previous,
      p.state().next,
      p.state().active,
      p.state().queued,
    ]).toEqual([null, null, null, null, null]);
    expect(p.send({ kind: "ended", token: last })).toEqual([]);
  });
  it("a repeated preparation response cannot replace speech waiting for its successor", () => {
    const p = started();
    p.send({
      kind: "prepare",
      target: { kind: "from", from: "visible" },
      autoPlay: true,
    });
    const generation = p.state().generation;
    p.send({ kind: "prepared", generation, current: sentence(4) });
    p.send({ kind: "started", token: p.token() });
    p.send({ kind: "ended", token: p.token() });
    const waiting = p.state();
    expect(
      p.send({ kind: "prepared", generation, current: sentence(1) }),
    ).toEqual([]);
    expect(p.state()).toBe(waiting);
  });
  it("navigation while waiting at a section boundary preserves playback intent", () => {
    const p = setup(null);
    p.send({ kind: "play" });
    p.send({ kind: "started", token: p.token() });
    p.send({ kind: "ended", token: p.token() });
    const oldGeneration = p.state().generation;
    p.send({
      kind: "prepare",
      target: { kind: "from", from: sentence(4).locator },
      autoPlay: true,
    });
    expect(p.state().autoPlay).toBe(true);
    expect(
      p.send({
        kind: "successor",
        generation: oldGeneration,
        after: sentence(1).locator,
        segment: sentence(2),
      }),
    ).toEqual([]);
    expect(
      p.send({
        kind: "prepared",
        generation: p.state().generation,
        current: sentence(4),
      })[0],
    ).toMatchObject({ kind: "speak", segment: sentence(4) });
  });
  it("a previous command can supersede a slow section-boundary request", () => {
    const p = started();
    p.send({ kind: "ended", token: p.token() });
    p.send({ kind: "started", token: p.token() });
    p.send({ kind: "ended", token: p.token() });
    expect(p.state().phase).toBe("preparing");
    expect(
      p
        .send({ kind: "skip", direction: "previous" })
        .find((c) => c.kind === "speak"),
    ).toMatchObject({ segment: sentence(1) });
  });
  it("retries a failed active sentence once, then pauses with the voice failure message", () => {
    const p = started();
    const old = p.token();
    const retry = p.send({
      kind: "error",
      token: old,
      error: "voice-unavailable",
    });
    expect(retry.find((c) => c.kind === "speak")).toMatchObject({
      segment: sentence(1),
    });
    expect(p.state().retry).toBe(1);
    expect(
      p.send({ kind: "error", token: old, error: "voice-unavailable" }),
    ).toEqual([]);
    p.send({ kind: "started", token: p.token() });
    p.send({ kind: "error", token: p.token(), error: "voice-unavailable" });
    expect(p.state()).toMatchObject({
      phase: "paused",
      message: SPEECH_VOICE_FAILURE,
      current: sentence(1),
    });
  });
  it.each(["canceled", "interrupted"])(
    "does not retry a current %s error",
    (error) => {
      const p = started();
      expect(
        p.send({ kind: "error", token: p.token(), error }).map((c) => c.kind),
      ).toEqual(["cancel", "select"]);
      expect(p.state().phase).toBe("paused");
      expect(p.state().message).toBeNull();
    },
  );
  it("retries a failed queued sentence without interrupting current speech", () => {
    const p = started();
    const active = p.token(),
      oldQueued = p.state().queued!.token;
    const retry = p.send({
      kind: "error",
      token: oldQueued,
      error: "synthesis-failed",
    });
    expect(retry).toHaveLength(1);
    expect(retry[0]).toMatchObject({ kind: "speak", segment: sentence(2) });
    expect(p.token()).toEqual(active);
    expect(
      p.send({ kind: "error", token: oldQueued, error: "synthesis-failed" }),
    ).toEqual([]);
    p.send({
      kind: "error",
      token: p.state().queued!.token,
      error: "synthesis-failed",
    });
    expect(p.state()).toMatchObject({
      phase: "paused",
      current: sentence(2),
      next: null,
      message: SPEECH_VOICE_FAILURE,
    });
    expect(
      p.send({ kind: "play" }).filter((c) => c.kind === "speak"),
    ).toHaveLength(1);
  });
  it("carries a queued retry count into the active sentence", () => {
    const p = started();
    p.send({
      kind: "error",
      token: p.state().queued!.token,
      error: "synthesis-failed",
    });
    const queued = p.state().queued!.token;
    p.send({ kind: "ended", token: p.token() });
    p.send({ kind: "started", token: queued });
    const commands = p.send({
      kind: "error",
      token: queued,
      error: "synthesis-failed",
    });
    expect(commands.some((c) => c.kind === "speak")).toBe(false);
    expect(p.state().message).toBe(SPEECH_VOICE_FAILURE);
  });
  it("previous/next while paused select sentences without starting speech", () => {
    const p = started();
    p.send({ kind: "pause" });
    expect(
      p.send({ kind: "skip", direction: "next" }).map((c) => c.kind),
    ).toEqual(["cancel", "select", "request-next"]);
    expect(p.state().current).toEqual(sentence(2));
    expect(
      p.send({ kind: "skip", direction: "previous" }).map((c) => c.kind),
    ).toEqual(["cancel", "select"]);
    expect(p.state()).toMatchObject({
      phase: "paused",
      current: sentence(1),
      next: sentence(2),
    });
  });
  it("reconstructs previous-section speech on demand and selects it when paused", () => {
    const p = setup();
    const commands = p.send({ kind: "skip", direction: "previous" });
    expect(commands[1]).toMatchObject({
      kind: "prepare",
      target: { kind: "adjacent", direction: "previous" },
    });
    const previous = sentence(0);
    expect(
      p.send({
        kind: "prepared",
        generation: p.state().generation,
        current: previous,
        next: sentence(1),
      }),
    ).toEqual([{ kind: "select", segment: previous }]);
    expect(p.state().phase).toBe("paused");
  });
  it.each(["ready", "playing"])(
    "a second skip supersedes adjacency preparation while %s",
    (phase) => {
      const p = phase === "playing" ? started() : setup();
      p.send({ kind: "skip", direction: "previous" });
      const generation = p.state().generation;
      p.send({ kind: "skip", direction: "next" });
      expect(p.state().preparation).toBeNull();
      expect(p.state().current).toEqual(sentence(2));
      expect(
        p.send({ kind: "prepared", generation, current: sentence(0) }),
      ).toEqual([]);
      p.send({
        kind: "successor",
        generation: p.state().generation,
        after: sentence(2).locator,
        segment: sentence(3),
      });
      expect(p.state().next).toEqual(sentence(3));
    },
  );
  it("reconfiguration replays current speech and invalidates both old utterances", () => {
    const p = started();
    const active = p.token(),
      queued = p.state().queued!.token;
    expect(
      p.send({ kind: "restart" }).find((c) => c.kind === "speak"),
    ).toMatchObject({ segment: sentence(1) });
    expect(p.send({ kind: "started", token: queued })).toEqual([]);
    expect(p.send({ kind: "ended", token: active })).toEqual([]);
  });
  it("identifies PDF sentences by quote/context and rects, not just their page", () => {
    const p = setup(null);
    const pdf = (text: string, rect: number) => ({
      ...sentence(1),
      text,
      locator: {
        ...sentence(1).locator,
        cfi: undefined,
        pdf: {
          page: 1,
          rects: [[rect, 0, 10, 10] as [number, number, number, number]],
        },
        text: { highlight: text },
      },
    });
    p.send({ kind: "prepare", target: { kind: "from", from: "visible" } });
    p.send({
      kind: "prepared",
      generation: p.state().generation,
      current: pdf("first", 0),
    });
    const state = p.state();
    expect(
      p.send({
        kind: "successor",
        generation: state.generation,
        after: pdf("other", 20).locator,
        segment: sentence(2),
      }),
    ).toEqual([]);
    expect(p.state()).toBe(state);
  });
  it("failures invalidate extraction and do not retain a native callback token", () => {
    const p = started();
    const generation = p.state().generation,
      token = p.token();
    p.send({
      kind: "preparation-failed",
      generation,
      message: "Text unavailable",
    });
    expect(p.state()).toMatchObject({
      phase: "paused",
      active: null,
      queued: null,
      message: "Text unavailable",
    });
    expect(p.send({ kind: "ended", token })).toEqual([]);
    expect(
      p.send({
        kind: "successor",
        generation,
        after: sentence(1).locator,
        segment: sentence(2),
      }),
    ).toEqual([]);
  });
  it("stays pure and cannot output tracker activity or completion commands", () => {
    const state: SpeechPlayerState = initialSpeechPlayer();
    Object.freeze(state);
    const action: SpeechAction = {
      kind: "prepare",
      target: { kind: "from", from: "visible" },
    };
    const first = transitionSpeechPlayer(state, action);
    expect(transitionSpeechPlayer(state, action)).toEqual(first);
    expect(first.commands.map((c) => c.kind)).toEqual([
      "cancel",
      "clear",
      "prepare",
    ]);
    const stale: SpeechToken = { generation: 0, utterance: 0 };
    expect(
      transitionSpeechPlayer(first.state, { kind: "started", token: stale })
        .commands,
    ).toEqual([]);
  });
});
