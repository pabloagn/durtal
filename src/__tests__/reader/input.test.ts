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
    contents: fn(),
    settings: fn(),
    fullscreen: fn(),
    goto: fn(),
    chapter: fn(),
    shortcuts: fn(),
    escape: fn(),
    activity: fn(),
    pointer: fn(),
  };
  blocked = false;
  clock = 1_000_000;
  document.body.innerHTML = `<main><p id="text">Some text</p><a id="link" href="#x">a link</a><input id="field" /><input id="box" type="checkbox" /></main>`;
  Object.defineProperty(window, "innerWidth", {
    value: 1000,
    configurable: true,
  });
  input = createReaderInput({
    actions,
    isBlocked: () => blocked,
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
    expect(actions.activity).toHaveBeenCalledWith("turn");
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

  it("turns on the outer 30% and shows the bars in the centre", () => {
    click(100);
    click(900);
    click(500);
    expect(actions.left).toHaveBeenCalledTimes(1);
    expect(actions.right).toHaveBeenCalledTimes(1);
    expect(actions.toggleBars).toHaveBeenCalledTimes(1);
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
    expect(actions.right).toHaveBeenCalledTimes(2);
  });

  it("never turns on a long press, which selects", () => {
    touch("touchstart", 950);
    clock += 600;
    touch("touchend", 950);
    expect(actions.right).not.toHaveBeenCalled();
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
