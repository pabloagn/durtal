// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let changeUnderHold: typeof import("@/vendor/foliate-js/page-hold.js").changeUnderHold;
/** A fresh module, which finds again whether frames run inside an update */
async function load(framesInUpdate: boolean, frameMs = 1) {
  vi.resetModules();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    framesInUpdate ? setTimeout(() => callback(0), frameMs) : 0);
  ({ changeUnderHold } = await import("@/vendor/foliate-js/page-hold.js"));
}

type Animated = { pseudo: string; keyframes: Keyframe[]; duration: number };

/** A View Transition whose pseudo elements hold one endless animation each */
function mockTransitions() {
  const html = document.documentElement;
  const started: Animated[] = [];
  const cancelled: string[] = [];
  let classesAtReady: string[] = [];
  let resolveFinished = () => {};
  const order: string[] = [];
  const skipped: boolean[] = [];
  const holds = ["::view-transition-old(root)", "::view-transition-old(foliate-hold)"].map((pseudo) => ({
    effect: { pseudoElement: pseudo },
    cancel: () => {
      cancelled.push(pseudo);
      resolveFinished();
    },
  }));
  Object.assign(document, {
    startViewTransition: vi.fn((update: () => Promise<void>) => {
      classesAtReady = [...html.classList];
      const ready = Promise.resolve().then(update).then(() => { order.push("ready"); });
      return {
        ready,
        finished: new Promise<void>((resolve) => { resolveFinished = resolve; }),
        skipTransition: () => { skipped.push(true); resolveFinished(); },
      };
    }),
  });
  html.getAnimations = (() => holds) as unknown as typeof html.getAnimations;
  html.animate = ((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    started.push({ pseudo: options.pseudoElement!, keyframes, duration: Number(options.duration) });
    return {} as Animation;
  }) as typeof html.animate;
  return { started, cancelled, order, skipped, classes: () => classesAtReady };
}

beforeEach(() => load(false));

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
  document.documentElement.className = "";
  document.body.innerHTML = "";
});

describe("a page change under a held snapshot (SLN-660)", () => {
  it("just changes the page where there are no View Transitions", async () => {
    const change = vi.fn(async (held: boolean) => held);
    await expect(changeUnderHold(document.body, change, { turn: "slide", duration: 250 })).resolves.toBe(false);
    expect(change).toHaveBeenCalledWith(false);
  });

  it("holds the book for a jump, then fades it once the page is ready", async () => {
    const mock = mockTransitions();
    const host = document.createElement("div");
    document.body.append(host);
    let heldDuringChange = false;
    await changeUnderHold(host, async (held) => {
      heldDuringChange = held && mock.cancelled.length === 0 && host.style.viewTransitionName === "foliate-hold";
    }, { duration: 180 });
    expect(heldDuringChange).toBe(true);
    expect(mock.classes()).toEqual(["foliate-hold", "foliate-hold-book"]);
    expect(mock.started).toEqual([{ pseudo: "::view-transition-old(foliate-hold)", keyframes: [{ opacity: 1 }, { opacity: 0 }], duration: 180 }]);
    expect(mock.cancelled).toContain("::view-transition-old(foliate-hold)");
    expect(document.documentElement.className).toBe("");
    expect(host.style.viewTransitionName).toBe("");
  });

  it.each([
    ["forward", 1, false, "::view-transition-old(foliate-hold)", "translateX(-100%)"],
    ["forward, right to left", 1, true, "::view-transition-old(foliate-hold)", "translateX(100%)"],
    ["back", -1, false, "::view-transition-new(foliate-hold)", "translateX(-100%)"],
    ["back, right to left", -1, true, "::view-transition-new(foliate-hold)", "translateX(100%)"],
  ])("slides a turn %s on the book only", async (_label, direction, rtl, pseudo, away) => {
    const mock = mockTransitions();
    const host = document.createElement("div");
    document.body.append(host);
    let named = "";
    await changeUnderHold(host, async () => { named = host.style.viewTransitionName; }, { turn: "slide", forward: direction > 0, rtl, duration: 250 });
    expect(named).toBe("foliate-hold");
    expect(mock.classes()).toEqual(["foliate-hold", "foliate-hold-book"]);
    expect(mock.started).toHaveLength(1);
    expect(mock.started[0].pseudo).toBe(pseudo);
    expect(mock.started[0].keyframes.map((frame) => frame.transform)).toEqual(direction > 0 ? ["none", away] : [away, "none"]);
    expect(host.style.viewTransitionName).toBe("");
  });

  it("swaps at once with no animation, with reduced motion or Instant turns", async () => {
    const mock = mockTransitions();
    await changeUnderHold(document.body, async () => {}, { turn: "slide", duration: 0 });
    expect(mock.started).toEqual([]);
    expect(mock.cancelled).toContain("::view-transition-old(foliate-hold)");
  });

  it("lets go without moving when the page did not change", async () => {
    const mock = mockTransitions();
    await changeUnderHold(document.body, async () => false, { turn: "slide", duration: 250 });
    expect(mock.started).toEqual([]);
  });

  it("runs a change that comes during another hold without one", async () => {
    mockTransitions();
    let inner: boolean | undefined;
    await changeUnderHold(document.body, async () => {
      await changeUnderHold(document.body, async (held) => { inner = held; });
    }, { duration: 180 });
    expect(inner).toBe(false);
  });

  it("changes the page after the snapshot where no frames run inside the update (Chromium, Firefox)", async () => {
    const mock = mockTransitions();
    await changeUnderHold(document.body, async () => { mock.order.push("change"); }, { duration: 180 });
    expect(mock.order).toEqual(["ready", "change"]);
  });

  it("changes the page inside the update where frames run there (WebKit), and fades the book the first time", async () => {
    await load(true);
    const mock = mockTransitions();
    let held: boolean | undefined;
    let nameAtChange: string | undefined;
    await changeUnderHold(document.body, async (isHeld) => {
      held = isHeld;
      nameAtChange = document.body.style.viewTransitionName;
      mock.order.push("change");
    }, { turn: "slide", forward: false, duration: 250 });
    expect(mock.order).toEqual(["change", "ready"]);
    expect(held).toBe(true);
    // The book was named before frames were known to run there: its name
    // goes before the change, so the new page is taken with the screen, and
    // the old book fades, a slide included
    expect(nameAtChange).toBe("");
    expect(mock.started).toEqual([{ pseudo: "::view-transition-old(foliate-hold)", keyframes: [{ opacity: 1 }, { opacity: 0 }], duration: 250 }]);
    expect(mock.skipped).toEqual([]);
  });

  it("finds frames inside the update on a busy page whose frames take 150 ms (WebKit)", async () => {
    await load(true, 150);
    const mock = mockTransitions();
    await changeUnderHold(document.body, async () => { mock.order.push("change"); }, { duration: 180 });
    expect(mock.order).toEqual(["change", "ready"]);
  });

  it("holds the whole screen in WebKit once it is known, and slides a turn either way", async () => {
    await load(true);
    let mock = mockTransitions();
    await changeUnderHold(document.body, async () => {}, { duration: 180 });
    mock = mockTransitions();
    await changeUnderHold(document.body, async () => {}, { turn: "slide", forward: true, duration: 250 });
    expect(mock.classes()).toEqual(["foliate-hold", "foliate-hold-whole"]);
    expect(mock.started).toEqual([{ pseudo: "::view-transition-old(root)", keyframes: [{ transform: "none" }, { transform: "translateX(-100%)" }], duration: 250 }]);
    expect(mock.skipped).toEqual([]);
    mock = mockTransitions();
    await changeUnderHold(document.body, async () => {}, { turn: "slide", forward: false, duration: 250 });
    expect(mock.started).toEqual([{ pseudo: "::view-transition-new(root)", keyframes: [{ transform: "translateX(-100%)" }, { transform: "none" }], duration: 250 }]);
    mock = mockTransitions();
    await changeUnderHold(document.body, async () => {}, { turn: "fade", duration: 250 });
    expect(mock.started).toEqual([{ pseudo: "::view-transition-old(root)", keyframes: [{ opacity: 1 }, { opacity: 0 }], duration: 250 }]);
  });

  it("fades a turn in a whole-screen hold where the bars cannot keep their own layers (an older Safari)", async () => {
    await load(true);
    let mock = mockTransitions();
    await changeUnderHold(document.body, async () => {}, { duration: 180 });
    vi.stubGlobal("CSS", { supports: (property: string, value: string) => !(property === "view-transition-name" && value === "match-element") });
    mock = mockTransitions();
    await changeUnderHold(document.body, async () => {}, { turn: "slide", forward: true, duration: 250 });
    expect(mock.started).toEqual([{ pseudo: "::view-transition-old(root)", keyframes: [{ opacity: 1 }, { opacity: 0 }], duration: 250 }]);
  });

  it("passes on a failed change after letting go", async () => {
    const mock = mockTransitions();
    await expect(changeUnderHold(document.body, async () => { throw new Error("Retired book page"); }, { duration: 180 }))
      .rejects.toThrow("Retired book page");
    expect(mock.started).toEqual([]);
    expect(document.documentElement.className).toBe("");
  });
});
