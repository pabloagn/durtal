// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  SpeechPlayer,
  SpeechStartButton,
} from "@/components/reader/speech-player";
import {
  initialSpeechPlayer,
  transitionSpeechPlayer,
  type SpeechPlayerState,
  type SpeechSegment,
} from "@/lib/reader/speech/player";
import {
  parseSpeechPreferences,
  speechLanguageLabel,
  type SpeechVoice,
} from "@/lib/reader/speech/voices";
let root: Root, host: HTMLElement, phone: boolean;
const action = vi.fn(),
  preferences = vi.fn(),
  height = vi.fn();
const voices: SpeechVoice[] = [
  {
    voiceURI: "it",
    name: "Italian voice",
    lang: "it-IT",
    localService: true,
    default: false,
  },
  {
    voiceURI: "en",
    name: "English voice",
    lang: "en-GB",
    localService: true,
    default: true,
  },
];
const segment: SpeechSegment = {
  text: "Hello.",
  lang: "en-GB",
  locator: {
    v: 1,
    fileHash: "a".repeat(64),
    href: "a.xhtml",
    sectionIndex: 0,
    progression: 0,
    totalProgression: 0,
  },
};
function ready() {
  const state = transitionSpeechPlayer(initialSpeechPlayer(), {
    kind: "prepare",
    target: { kind: "from", from: "visible" },
  }).state;
  return transitionSpeechPlayer(state, {
    kind: "prepared",
    generation: state.generation,
    current: segment,
  }).state;
}
const render = (
  state: SpeechPlayerState = ready(),
  options: { open?: boolean; voices?: SpeechVoice[] } = {},
) =>
  act(() =>
    root.render(
      h(SpeechPlayer, {
        open: options.open ?? true,
        state,
        voices: options.voices ?? voices,
        preferences: parseSpeechPreferences(null),
        bookLanguage: "en-GB",
        bottomInset: 48,
        onAction: action,
        onPreferences: preferences,
        onHeightChange: height,
      }),
    ),
  );
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  phone = false;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: phone,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  // Deterministic DOM test only; browser modal/top-layer and native speech checks remain separate.
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  action.mockReset();
  preferences.mockReset();
  height.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("unmounted read aloud controls", () => {
  it("shows preparation feedback with disabled Play, then enables a new trusted play action when ready", async () => {
    const preparing = transitionSpeechPlayer(initialSpeechPlayer(), {
      kind: "prepare", target: { kind: "from", from: segment.locator },
    }).state;
    render(preparing);
    expect(host.querySelector('[aria-label="Read aloud controls"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Preparing text to read aloud");
    expect(button("Play reading aloud").disabled).toBe(true);
    await click(button("Play reading aloud"));
    expect(action).not.toHaveBeenCalled();
    const prepared = transitionSpeechPlayer(preparing, { kind: "prepared",
      generation: preparing.generation, current: segment }).state;
    render(prepared);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(button("Play reading aloud").disabled).toBe(false);
    expect(action).not.toHaveBeenCalled();
    await click(button("Play reading aloud"));
    expect(action).toHaveBeenCalledExactlyOnceWith({ kind: "play" });
  });
  it("disables Start until preparation is ready, then invokes its trusted-handler callback directly", async () => {
    const start = vi.fn();
    act(() =>
      root.render(h(SpeechStartButton, { ready: false, onStart: start })),
    );
    await click(button("Read aloud"));
    expect(start).not.toHaveBeenCalled();
    act(() =>
      root.render(h(SpeechStartButton, { ready: true, onStart: start })),
    );
    await click(button("Read aloud"));
    expect(start).toHaveBeenCalledOnce();
  });
  it("names every icon control and emits navigation/play/stop intents without tracker effects", async () => {
    render();
    const controls = [...host.querySelectorAll("button")];
    for (const control of controls) {
      expect(control.getAttribute("aria-label")).toBeTruthy();
      expect(control.getAttribute("data-tooltip")).toBe(
        control.getAttribute("aria-label"),
      );
      expect(control.hasAttribute("title")).toBe(false);
    }
    await click(button("Previous sentence"));
    await click(button("Play reading aloud"));
    await click(button("Next sentence"));
    await click(button("Stop reading aloud"));
    expect(action.mock.calls.map(([intent]) => intent)).toEqual([
      { kind: "skip", direction: "previous" },
      { kind: "play" },
      { kind: "skip", direction: "next" },
      { kind: "stop" },
    ]);
    expect(
      host.querySelector<HTMLElement>("[data-speech-player]")!.style.bottom,
    ).toBe("48px");
  });
  it("offers Pause while waiting for autoplay and retains controls on a voice error", async () => {
    render({ ...ready(), phase: "preparing", autoPlay: true });
    await click(button("Pause reading aloud"));
    expect(action).toHaveBeenCalledWith({ kind: "pause" });
    render({
      ...ready(),
      phase: "paused",
      message: "Read aloud stopped: the voice failed. Try another voice.",
    });
    expect(host.textContent).toContain("the voice failed");
    expect(button("Read aloud voice")).toBeTruthy();
    render(ready(), { voices: [] });
    expect(button("Play reading aloud").disabled).toBe(true);
    expect(host.textContent).toContain("No voices available");
  });
  it("desktop rate selection has all six values and restores trigger focus after Escape", async () => {
    render();
    const trigger = button("Read aloud speed");
    await click(trigger);
    const menu = host.querySelector('[role="menu"]')!;
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].map((el) =>
        el.textContent?.replace("Selected: ", ""),
      ),
    ).toEqual(["0.75×", "1×", "1.25×", "1.5×", "1.75×", "2×"]);
    await click(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')[3]);
    expect(preferences).toHaveBeenCalledWith({
      v: 1,
      rate: 1.5,
      voiceByLang: {},
    });
    expect(action).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    await click(trigger);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    await act(async () => {});
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("phone sheet focuses the selected rate and returns focus on native cancellation", async () => {
    phone = true;
    render();
    const trigger = button("Read aloud speed");
    await click(trigger);
    const sheet = host.querySelector("dialog")!;
    expect(sheet.open).toBe(true);
    expect(sheet.querySelectorAll("button[aria-pressed]")).toHaveLength(6);
    expect(document.activeElement).toBe(
      sheet.querySelector('[aria-pressed="true"]'),
    );
    act(() => sheet.dispatchEvent(new Event("cancel", { cancelable: true })));
    await act(async () => {});
    expect(host.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("groups book voices first and remembers an explicit foreign-passage override under that passage language", async () => {
    render({ ...ready(), current: { ...segment, lang: "la" } });
    await click(button("Read aloud voice"));
    const items = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items[0].textContent).toContain("English");
    expect(items[0].textContent).toContain("Selected");
    await click(items[1]);
    expect(preferences).toHaveBeenCalledWith({
      v: 1,
      rate: 1,
      voiceByLang: { la: "it" },
    });
    expect(action).not.toHaveBeenCalled();
    expect(speechLanguageLabel("la")).toBe("Latin");
    expect(speechLanguageLabel("not a language")).toBe("this language");
  });
  it("releases the occupied player inset on close", () => {
    render();
    expect(height).toHaveBeenCalled();
    height.mockClear();
    render(ready(), { open: false });
    expect(height).toHaveBeenLastCalledWith(0);
    expect(host.querySelector("[data-speech-player]")).toBeNull();
  });
});
