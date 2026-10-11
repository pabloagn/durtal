// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineEvents, ReaderEngine } from "@/lib/reader/engine";
import { createReaderNavigation } from "@/lib/reader/navigation";
import {
  createReaderSpeech,
  type ReaderSpeech,
} from "@/lib/reader/speech/session";
import type { SpeechSegment } from "@/lib/reader/speech/player";
import { fakeEngine } from "./fixtures/fake-engine";
class Utterance extends EventTarget {
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  constructor(public text: string) {
    super();
  }
}
const sentence = (at: number): SpeechSegment => ({
  text: `Sentence ${at}.`,
  lang: "en",
  locator: {
    v: 1,
    fileHash: "a".repeat(64),
    href: "chapter",
    sectionIndex: 0,
    progression: at / 10,
    totalProgression: at / 10,
    cfi: `cfi${at}`,
  },
});
const relocate = (segment: SpeechSegment): EngineEvents["relocate"] => ({
  locator: segment.locator,
  chapter: "Chapter",
  reason: "jump",
  origin: "human",
  atEnd: false,
  tocItem: null,
  visibleChars: 300,
  linear: true,
  paginated: true,
});
const sessions: ReaderSpeech[] = [];
afterEach(() => {
  for (const session of sessions) session.destroy();
  sessions.length = 0;
  vi.useRealTimers();
});
function setup() {
  const fake = fakeEngine();
  const engine: ReaderEngine = fake.engine;
  let first = 1;
  const prepare = vi.fn<NonNullable<ReaderEngine["prepareSpeech"]>>(
    async ({ target }) => {
      const at =
        target.kind === "adjacent"
          ? Number(target.locator.cfi!.slice(3)) + 1
          : first;
      return { current: sentence(at), previous: null, next: sentence(at + 1) };
    },
  );
  engine.prepareSpeech = prepare;
  const commits = vi.fn();
  let session: ReaderSpeech;
  const nav = createReaderNavigation({
    engine,
    commit: commits,
    paint: async () => {},
    beforeHuman: () => session.beginNavigation(),
    afterHuman: () => session.navigationSettled(),
  });
  fake.engine.goTo.mockImplementation(async (target, owner) => {
    if (!("v" in target)) return;
    const location = {
      ...relocate({ text: "", lang: "en", locator: target }),
      navigationId: owner?.id,
      origin: owner?.origin,
    };
    fake.emit("relocate", location);
    nav.relocate(location);
  });
  nav.start(relocate(sentence(1)));
  const platform = Object.assign(new EventTarget(), {
    paused: false,
    getVoices: () =>
      [
        {
          voiceURI: "en",
          name: "English",
          lang: "en",
          default: true,
          localService: true,
        },
      ] as SpeechSynthesisVoice[],
    speak: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
  });
  session = createReaderSpeech({
    engine,
    navigation: nav,
    bookLanguage: "en",
    synthesis: platform as unknown as SpeechSynthesis,
    Utterance: Utterance as unknown as typeof SpeechSynthesisUtterance,
    document,
    storage: null,
    changed: () => {},
  });
  sessions.push(session);
  return {
    engine,
    session,
    nav,
    platform,
    prepare,
    commits,
    landing: (at: number) => {
      first = at;
      session.relocate(relocate(sentence(at)));
    },
    utterance: (at = platform.speak.mock.calls.length - 1) =>
      platform.speak.mock.calls[at][0] as Utterance,
  };
}
const settle = async () => {
  for (let n = 0; n < 8; n++) await Promise.resolve();
};
describe("reader speech session ownership", () => {
  it("opens preparation feedback for a fast changed-selection action and waits for a fresh trusted Play", async () => {
    const s = setup();
    s.session.selection(sentence(1).locator);
    await settle();
    let release!: (value: Awaited<ReturnType<NonNullable<ReaderEngine["prepareSpeech"]>>>) => void;
    s.prepare.mockImplementationOnce(() => new Promise(done => { release = done; }));
    s.session.startSelection(sentence(2).locator);
    expect(s.session.snapshot).toMatchObject({ open: true, selectionReady: false,
      state: { phase: "preparing", autoPlay: false } });
    expect(s.platform.speak).not.toHaveBeenCalled();
    release({ current: sentence(2), previous: sentence(1), next: sentence(3) });
    await settle();
    expect(s.session.snapshot).toMatchObject({ open: true, selectionReady: true, state: { phase: "ready" } });
    expect(s.platform.speak).not.toHaveBeenCalled();
    s.session.action({ kind: "play" });
    expect(s.platform.speak).toHaveBeenCalledOnce();
    expect(s.utterance().text).toBe("Sentence 2.");
  });
  it("Stop closes fast-selection preparation feedback and rejects its late completion", async () => {
    const s = setup();
    s.session.selection(sentence(1).locator);
    await settle();
    let release!: (value: Awaited<ReturnType<NonNullable<ReaderEngine["prepareSpeech"]>>>) => void;
    s.prepare.mockImplementationOnce(() => new Promise(done => { release = done; }));
    s.session.startSelection(sentence(2).locator);
    const pending = s.prepare.mock.lastCall![0];
    expect(s.session.snapshot.open).toBe(true);
    s.session.action({ kind: "stop" });
    expect(pending.signal.aborted).toBe(true);
    release({ current: sentence(2), previous: sentence(1), next: sentence(3) });
    await settle();
    expect(s.session.snapshot.open).toBe(false);
    expect(s.session.snapshot.state.current?.text).not.toBe("Sentence 2.");
    expect(s.platform.speak).not.toHaveBeenCalled();
  });
  it("reprepares an action-time paragraph instead of playing the previously prepared word", async () => {
    const s = setup();
    s.session.selection(sentence(1).locator);
    await settle();
    expect(s.session.snapshot.selectionReady).toBe(true);
    s.prepare.mockResolvedValueOnce({ current: sentence(2), previous: sentence(1), next: sentence(3) });
    s.session.startSelection(sentence(2).locator);
    expect(s.platform.speak).not.toHaveBeenCalled();
    expect(s.prepare.mock.lastCall![0]).toMatchObject({ target: { kind: "from", from: sentence(2).locator } });
    await settle();
    expect(s.session.snapshot.selectionReady).toBe(true);
    s.session.startSelection(sentence(2).locator);
    expect(s.utterance().text).toBe("Sentence 2.");
  });
  it("prepares real text without opening or speaking, and first Start speaks synchronously", async () => {
    const s = setup();
    s.session.prepare();
    await settle();
    expect(s.session.snapshot.state.phase).toBe("ready");
    expect(s.session.snapshot.open).toBe(false);
    expect(s.platform.speak).not.toHaveBeenCalled();
    s.session.toggle();
    expect(s.platform.speak).toHaveBeenCalledOnce();
    expect(s.utterance().text).toBe("Sentence 1.");
    expect(s.session.snapshot.open).toBe(true);
  });
  it("human navigation cancels immediately, rejects old native callbacks, then resumes newly prepared landing text", async () => {
    const s = setup();
    s.session.prepare();
    await settle();
    s.session.toggle();
    const old = s.utterance();
    old.dispatchEvent(new Event("start"));
    s.session.beginNavigation();
    expect(s.platform.cancel).toHaveBeenCalled();
    expect(s.session.snapshot.state).toMatchObject({
      phase: "preparing",
      autoPlay: true,
      active: null,
    });
    const count = s.platform.speak.mock.calls.length;
    old.dispatchEvent(new Event("end"));
    expect(s.platform.speak).toHaveBeenCalledTimes(count);
    s.landing(4);
    await settle();
    expect(s.utterance().text).toBe("Sentence 4.");
    expect(s.session.snapshot.state.phase).toBe("starting");
  });
  it("paused manual navigation prepares without speaking and canceled extraction stays inert", async () => {
    const s = setup();
    let release!: (
      value: Awaited<ReturnType<NonNullable<ReaderEngine["prepareSpeech"]>>>,
    ) => void;
    s.prepare.mockImplementationOnce(
      () => new Promise((done) => (release = done)),
    );
    s.session.prepare();
    const request = s.prepare.mock.calls[0][0];
    s.session.beginNavigation();
    expect(request.signal.aborted).toBe(true);
    s.landing(4);
    await settle();
    release({ current: sentence(1), previous: null, next: null });
    await settle();
    expect(s.session.snapshot.state.current?.text).toBe("Sentence 4.");
    expect(s.platform.speak).not.toHaveBeenCalled();
  });
  it("settled failed navigation reprepares the restored location, and disposal rejects late work", async () => {
    const s = setup();
    s.session.prepare();
    await settle();
    s.session.toggle();
    s.session.beginNavigation();
    s.session.navigationSettled();
    await settle();
    expect(s.utterance().text).toBe("Sentence 1.");
    s.session.destroy();
    const count = s.platform.speak.mock.calls.length;
    s.utterance().dispatchEvent(new Event("start"));
    s.session.toggle();
    await settle();
    expect(s.platform.speak).toHaveBeenCalledTimes(count);
  });
});

it("prepares an explicit selection without speaking and starts that prepared sentence directly", async () => {
  const s = setup();
  let release!: (
    value: Awaited<ReturnType<NonNullable<ReaderEngine["prepareSpeech"]>>>,
  ) => void;
  s.prepare.mockImplementationOnce(
    () => new Promise((done) => (release = done)),
  );
  s.session.selection(sentence(4).locator);
  expect(s.session.snapshot.selectionReady).toBe(false);
  s.session.startSelection();
  expect(s.platform.speak).not.toHaveBeenCalled();
  release({ current: sentence(4), previous: null, next: null });
  await settle();
  expect(s.session.snapshot.selectionReady).toBe(true);
  s.session.startSelection();
  expect(s.platform.speak).toHaveBeenCalledOnce();
  expect(s.utterance().text).toBe("Sentence 4.");
});
it("pausing selects the sentence only after its owned navigation settles", async () => {
  const s = setup();
  const selected = vi.fn(() => true);
  s.engine.selectSpeechSentence = selected;
  s.session.prepare();
  await settle();
  s.session.toggle();
  s.utterance().dispatchEvent(new Event("start"));
  await settle();
  s.session.action({ kind: "pause" });
  expect(selected).not.toHaveBeenCalled();
  await settle();
  expect(selected).toHaveBeenCalledWith(sentence(1).locator);
});
it("replaced selection preparation and stale paused-selection effects cannot change the new intent", async () => {
  const s = setup();
  const selected = vi.fn(() => true);
  s.engine.selectSpeechSentence = selected;
  s.session.prepare();
  await settle();
  s.session.toggle();
  s.session.action({ kind: "pause" });
  s.session.selection(sentence(4).locator);
  await settle();
  expect(selected).not.toHaveBeenCalled();
  expect(s.session.snapshot.selectionReady).toBe(true);
  s.session.selection(null);
  expect(s.session.snapshot.selectionReady).toBe(false);
});
