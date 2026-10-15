// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReaderInput,
  isEditableTarget,
  registerReaderKey,
  type ReaderActions,
  type ReaderInput,
} from "@/lib/reader/input";

/* SLN-492: the reader's one input layer: keys, taps, swipes and the wheel */

let actions: {
  [K in keyof ReaderActions]-?: ReturnType<typeof vi.fn<() => void>>;
};
let input: ReaderInput;
let blocked = false;
let edgeTaps = true;
let selected = false;
let scrolled = false;
let turning = false;
let clock = 1_000_000;

beforeEach(() => {
  const fn = () => vi.fn<() => void>();
  actions = {
    next: fn(),
    prev: fn(),
    left: fn(),
    right: fn(),
    first: fn(),
    last: fn(),
    toggleBars: fn(),
    showBars: fn(),
    contents: fn(),
    settings: fn(),
    search: fn(),
    fullscreen: fn(),
    speech: fn(),
    sentence: fn(),
    goto: fn(),
    chapter: fn(),
    shortcuts: fn(),
    escape: fn(),
    activity: fn(),
    pointer: fn(),
    scroll: fn(),
    scrollBy: fn(),
  };
  blocked = false;
  edgeTaps = true;
  selected = false;
  scrolled = false;
  turning = false;
  clock = 1_000_000;
  document.body.innerHTML = `<main><p id="text">Some text</p><a id="link" href="#x">a link</a><input id="field" /><input id="box" type="checkbox" /></main>`;
  Object.defineProperty(window, "innerWidth", {
    value: 1000,
    configurable: true,
  });
  input = createReaderInput({
    actions,
    isBlocked: () => blocked,
    hasSelection: () => selected,
    edgeTaps: () => edgeTaps,
    scrolled: () => scrolled,
    turning: () => turning,
    now: () => clock,
  });
  input.attach(document);
});
afterEach(() => input.destroy());

const key = (
  k: string,
  init: KeyboardEventInit = {},
  target: Element | Document = document.getElementById("text")!,
) => {
  const event = new KeyboardEvent("keydown", {
    key: k,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

describe("keys", () => {
  it("routes available speech actions and leaves unavailable speech keys native", () => {
    expect(key("a").defaultPrevented).toBe(true);
    expect(key(",").defaultPrevented).toBe(true);
    expect(key(".").defaultPrevented).toBe(true);
    expect(actions.speech).toHaveBeenCalledOnce();
    expect(actions.sentence.mock.calls).toEqual([["previous"], ["next"]]);
    key("a", { repeat: true });
    key(".", { ctrlKey: true });
    blocked = true; key("a"); blocked = false;
    key(".", {}, document.getElementById("field")!);
    expect(actions.speech).toHaveBeenCalledOnce();
    expect(actions.sentence).toHaveBeenCalledTimes(2);
    const { speech, sentence, ...withoutSpeech } = actions;
    input.destroy();
    input = createReaderInput({ actions: withoutSpeech, isBlocked: () => blocked, now: () => clock });
    input.attach(document);
    expect(key("a").defaultPrevented).toBe(false);
    expect(key(",").defaultPrevented).toBe(false);
    expect(key(".").defaultPrevented).toBe(false);
    expect(speech).toHaveBeenCalledOnce();
    expect(sentence).toHaveBeenCalledTimes(2);
  });

  it("opens book search from the book, leaves a second Mod+F in the search field to the browser", () => {
    expect(key("/", {}).defaultPrevented).toBe(true);
    expect(key("f", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(actions.search).toHaveBeenCalledTimes(2);
    const root = document.createElement("div");
    root.setAttribute("data-reader-search", "");
    const field = document.createElement("input");
    root.append(field);
    document.body.append(root);
    expect(key("f", { metaKey: true }, field).defaultPrevented).toBe(false);
    expect(key("/", {}, field).defaultPrevented).toBe(false);
    expect(actions.search).toHaveBeenCalledTimes(2);
  });
  it("turns with the arrows, space, page keys, Home and End", () => {
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    key("ArrowLeft");
    key(" ");
    key(" ", { shiftKey: true });
    key("PageDown");
    key("PageUp");
    key("Home");
    key("End");
    expect(actions.right).toHaveBeenCalledTimes(1);
    expect(actions.left).toHaveBeenCalledTimes(1);
    expect(actions.next).toHaveBeenCalledTimes(2);
    expect(actions.prev).toHaveBeenCalledTimes(2);
    expect(actions.first).toHaveBeenCalledTimes(1);
    expect(actions.last).toHaveBeenCalledTimes(1);
    expect(actions.activity).not.toHaveBeenCalledWith("turn");
    expect(actions.activity).toHaveBeenCalledTimes(8);
  });

  it("opens contents, settings and full screen with t, s and f, not held or shifted", () => {
    key("t");
    key("S");
    key("f");
    key("t", { repeat: true });
    key("T", { shiftKey: true });
    expect(actions.contents).toHaveBeenCalledTimes(1);
    expect(actions.settings).toHaveBeenCalledTimes(1);
    expect(actions.fullscreen).toHaveBeenCalledTimes(1);
  });

  it("leaves keys to text fields, and to the browser with a modifier", () => {
    key("ArrowRight", {}, document.getElementById("field")!);
    key("t", {}, document.getElementById("field")!);
    key("ArrowRight", { metaKey: true });
    key("f", { ctrlKey: true });
    expect(actions.right).not.toHaveBeenCalled();
    expect(actions.contents).not.toHaveBeenCalled();
    expect(actions.fullscreen).not.toHaveBeenCalled();
    // Nor a slider (the settings' controls)
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="slider" role="slider" tabindex="0"></div>`,
    );
    key("ArrowRight", {}, document.getElementById("slider")!);
    expect(actions.right).not.toHaveBeenCalled();
    // A checkbox is not a text field
    key("ArrowRight", {}, document.getElementById("box")!);
    expect(actions.right).toHaveBeenCalledTimes(1);
  });

  it("turns left and right, not back and forward: the engine maps them by the book's direction", () => {
    // In a right-to-left book goLeft is the next page; the input layer never decides that
    key("ArrowLeft");
    expect(actions.left).toHaveBeenCalledTimes(1);
    expect(actions.prev).not.toHaveBeenCalled();
    expect(actions.next).not.toHaveBeenCalled();
  });

  it("shows the bars on the menu key, never while a dialog is open (SLN-663)", () => {
    key("ContextMenu");
    expect(actions.showBars).toHaveBeenCalledTimes(1);
    expect(actions.toggleBars).not.toHaveBeenCalled();
    blocked = true;
    key("ContextMenu");
    expect(actions.showBars).toHaveBeenCalledTimes(1);
  });

  it("lets only Esc through to the reader while nothing is open, nothing while a dialog or the palette is", () => {
    key("Escape");
    expect(actions.escape).toHaveBeenCalledTimes(1);
    blocked = true;
    key("Escape");
    key("ArrowRight");
    expect(actions.escape).toHaveBeenCalledTimes(1);
    expect(actions.right).not.toHaveBeenCalled();
  });

  it("passes a registered key on, with a selection when it asks for one", () => {
    let selection = false;
    input.destroy();
    input = createReaderInput({
      actions,
      isBlocked: () => blocked,
      hasSelection: () => selection,
      now: () => clock,
    });
    input.attach(document);
    const always = vi.fn();
    const withSelection = vi.fn();
    const offAlways = registerReaderKey("q", always);
    const offSelection = registerReaderKey("x", withSelection, {
      when: "selection",
    });
    key("q");
    key("x");
    expect(always).toHaveBeenCalledTimes(1);
    expect(withSelection).not.toHaveBeenCalled();
    selection = true;
    expect(key("x").defaultPrevented).toBe(true);
    expect(withSelection).toHaveBeenCalledTimes(1);
    offAlways();
    offSelection();
    key("q");
    expect(always).toHaveBeenCalledTimes(1);
  });

  it("hears keys from a section document it attached, and stops after detaching", () => {
    const section = document.implementation.createHTMLDocument("section");
    const detach = input.attach(section);
    key("ArrowRight", {}, section.body);
    expect(actions.right).toHaveBeenCalledTimes(1);
    detach();
    key("ArrowRight", {}, section.body);
    expect(actions.right).toHaveBeenCalledTimes(1);
  });

  it("hands Tab in a book's page to bookTab, unless the selection's toolbar took it (SLN-810)", () => {
    input.destroy();
    let toolbar = false;
    const bookTab = vi.fn<(event: KeyboardEvent) => void>();
    input = createReaderInput({
      actions,
      isBlocked: () => blocked,
      selectionTab: (event) => {
        if (toolbar) event.preventDefault();
      },
      bookTab,
    });
    input.attach(document);
    const section = document.implementation.createHTMLDocument("section");
    input.attach(section);
    key("Tab");
    expect(bookTab).not.toHaveBeenCalled();
    key("Tab", { shiftKey: true }, section.body);
    expect(bookTab).toHaveBeenCalledTimes(1);
    expect(bookTab.mock.calls[0][0].shiftKey).toBe(true);
    toolbar = true;
    key("Tab", {}, section.body);
    expect(bookTab).toHaveBeenCalledTimes(1);
  });
});

describe("isEditableTarget", () => {
  it("knows text fields, sliders and editable text", () => {
    document.body.innerHTML = `<input id="a" type="search"><input id="b" type="radio"><textarea id="c"></textarea><div id="d" role="slider"></div><div id="e" contenteditable="true"></div><button id="f"></button>`;
    const is = (id: string) => isEditableTarget(document.getElementById(id));
    expect([is("a"), is("b"), is("c"), is("d"), is("f")]).toEqual([
      true,
      false,
      true,
      true,
      false,
    ]);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});

describe("taps, swipes and the wheel", () => {
  const touch = (
    type: string,
    x: number,
    y = 300,
    target: Element = document.getElementById("text")!,
  ) => {
    const point = {
      clientX: x,
      clientY: y,
      identifier: 1,
      target,
    } as unknown as Touch;
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      touches: type === "touchend" ? [] : [point],
      changedTouches: [point],
    });
    target.dispatchEvent(event);
  };
  const click = (
    x: number,
    target: Element = document.getElementById("text")!,
  ) =>
    target.dispatchEvent(
      new MouseEvent("click", {
        clientX: x,
        clientY: 300,
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );

  const press = (target: Element = document.getElementById("text")!) =>
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));

  it("never turns or toggles on a mouse click, in the edge strips too, whatever edge taps say (SLN-662)", () => {
    // A laptop window under 1100 px tall reads as a tablet, where edge taps are on
    for (const on of [true, false]) {
      edgeTaps = on;
      for (const x of [50, 100, 300, 500, 700, 900, 950]) click(x);
    }
    expect(actions.left).not.toHaveBeenCalled();
    expect(actions.right).not.toHaveBeenCalled();
    expect(actions.toggleBars).not.toHaveBeenCalled();
  });

  it("a tap that dismisses a selection only dismisses it, even in an edge strip", () => {
    selected = true;
    press();
    selected = false; // the press's default action collapsed it
    touch("touchstart", 950);
    touch("touchend", 950);
    expect(actions.right).not.toHaveBeenCalled();
    clock += 1000;
    press();
    touch("touchstart", 950);
    touch("touchend", 950);
    expect(actions.right).toHaveBeenCalledTimes(1);
  });

  it("taps by touch: the edge strips turn, the rest shows or hides the bars", () => {
    touch("touchstart", 100);
    touch("touchend", 100);
    touch("touchstart", 500);
    touch("touchend", 500);
    clock += 1000;
    touch("touchstart", 300);
    touch("touchend", 300);
    expect(actions.left).toHaveBeenCalledTimes(1);
    expect(actions.toggleBars).toHaveBeenCalledTimes(2);
    edgeTaps = false;
    touch("touchstart", 950);
    touch("touchend", 950);
    expect(actions.right).not.toHaveBeenCalled();
    expect(actions.toggleBars).toHaveBeenCalledTimes(3);
  });

  it("never turns by touch while the book has a selection", () => {
    selected = true;
    touch("touchstart", 950);
    touch("touchend", 950);
    touch("touchstart", 600);
    touch("touchend", 540);
    expect(actions.right).not.toHaveBeenCalled();
    expect(actions.toggleBars).not.toHaveBeenCalled();
  });

  it("leaves clicks on links and controls to them", () => {
    click(900, document.getElementById("link")!);
    expect(actions.right).not.toHaveBeenCalled();
  });

  it("turns on a horizontal swipe of 40 px, toward where the finger went", () => {
    touch("touchstart", 600);
    touch("touchmove", 540);
    touch("touchend", 540);
    expect(actions.right).toHaveBeenCalledTimes(1);
    touch("touchstart", 400);
    touch("touchend", 460, 310);
    expect(actions.left).toHaveBeenCalledTimes(1);
    // Mostly vertical: not a turn, and not a tap either
    touch("touchstart", 500, 100);
    touch("touchmove", 530, 300);
    touch("touchend", 530, 300);
    expect(actions.left).toHaveBeenCalledTimes(1);
    expect(actions.right).toHaveBeenCalledTimes(1);
    expect(actions.toggleBars).not.toHaveBeenCalled();
  });

  it("taps by touch without the emulated click turning twice", () => {
    touch("touchstart", 950);
    touch("touchend", 950);
    click(950);
    expect(actions.right).toHaveBeenCalledTimes(1);
    clock += 1000;
    click(950);
    expect(actions.right).toHaveBeenCalledTimes(1);
  });

  it("never turns on a long press, which selects", () => {
    touch("touchstart", 950);
    clock += 600;
    touch("touchend", 950);
    expect(actions.right).not.toHaveBeenCalled();
  });

  it("a held arrow key's repeats turn only once the page before has (SLN-673)", () => {
    const press = (repeat: boolean) =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", repeat, bubbles: true, cancelable: true }),
      );
    press(false);
    turning = true;
    press(true);
    press(true);
    expect(actions.right).toHaveBeenCalledTimes(1);
    // A deliberate second press still queues behind the turn
    press(false);
    expect(actions.right).toHaveBeenCalledTimes(2);
    turning = false;
    press(true);
    expect(actions.right).toHaveBeenCalledTimes(3);
  });

  it("in the scroll flow, leaves the wheel to the browser and scrolls by lines on the up and down arrows (SLN-674)", () => {
    scrolled = true;
    document
      .getElementById("text")!
      .dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
    expect(actions.next).not.toHaveBeenCalled();
    const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    document.body.dispatchEvent(down);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(down.defaultPrevented).toBe(true);
    expect(actions.scroll.mock.calls).toEqual([[1], [-1]]);
  });

  it("in the scroll flow, a wheel beside the text column scrolls the book; over a list it is the list's", () => {
    scrolled = true;
    const wheel = (target: Element, init: WheelEventInit) =>
      target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, composed: true, ...init }));
    // The paginator's background: nothing under it scrolls
    wheel(document.getElementById("text")!, { deltaY: 100 });
    wheel(document.getElementById("text")!, { deltaY: -3, deltaMode: 1 });
    expect(actions.scrollBy.mock.calls).toEqual([[100], [-120]]);
    // Something that scrolls by itself keeps its wheel
    const list = document.createElement("div");
    list.style.overflowY = "auto";
    Object.defineProperties(list, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
    document.body.append(list);
    wheel(list, { deltaY: 100 });
    // The bars and dialogs keep theirs, and a blocked reader takes none
    wheel(document.getElementById("link")!, { deltaY: 100 });
    blocked = true;
    wheel(document.getElementById("text")!, { deltaY: 100 });
    expect(actions.scrollBy).toHaveBeenCalledTimes(2);
    expect(actions.next).not.toHaveBeenCalled();
  });

  it("turns one page per wheel gesture", () => {
    vi.useFakeTimers();
    try {
      const wheel = (deltaY: number) =>
        document
          .getElementById("text")!
          .dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true }));
      wheel(5);
      wheel(10);
      wheel(40);
      wheel(40);
      expect(actions.next).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(300);
      wheel(-30);
      expect(actions.prev).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("bridge input guards", () => {
  it("reserves reader keys and isolates a failing plugin shortcut", () => {
    expect(() => registerReaderKey("t", () => {})).toThrow("reserves");
    const logged = vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const next = vi.fn();
    const off1 = registerReaderKey("q", () => {
      throw new Error("plugin");
    });
    const off2 = registerReaderKey("q", next);
    key("q");
    expect(next).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledOnce();
    off1();
    off2();
  });
  it("keeps native Shift+Arrow selection and Space/Enter button activation", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button id="copy">Copy</button>',
    );
    const button = document.getElementById("copy")!;
    expect(key("ArrowRight", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(key(" ", {}, button).defaultPrevented).toBe(false);
    expect(key("Enter", {}, button).defaultPrevented).toBe(false);
    expect(actions.right).not.toHaveBeenCalled();
    expect(actions.next).not.toHaveBeenCalled();
  });
  it("captures ordinary key and chrome pointer activity once after duplicate document attach", () => {
    input.attach(document);
    key("x");
    document
      .getElementById("text")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(actions.activity).toHaveBeenCalledTimes(2);
    expect(actions.activity).toHaveBeenNthCalledWith(1, "key");
    expect(actions.activity).toHaveBeenNthCalledWith(2, "pointer");
  });
});
