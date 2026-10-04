// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RatingInput, RatingStars } from "@/components/shared/rating";

// Half-star ratings (SLN-446): mouse halves, touch taps and drags, keyboard, ARIA.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Each star is 24px wide, in a row from x = 0
  const rect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    const n = Number(this.getAttribute("data-star"));
    if (!n) return rect.call(this);
    const left = (n - 1) * 24;
    return { left, right: left + 24, width: 24, top: 0, bottom: 24, height: 24, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});

let root: Root;
let host: HTMLElement;
let changes: (number | null)[];

function Harness({ initial }: { initial: number | null }) {
  const [value, setValue] = useState(initial);
  return createElement(RatingInput, {
    value,
    label: "Your rating",
    onChange: (next: number | null) => {
      changes.push(next);
      setValue(next);
    },
  });
}

function mount(initial: number | null) {
  act(() => root.render(createElement(Harness, { initial })));
}

beforeEach(() => {
  changes = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const slider = () => host.querySelector<HTMLElement>('[role="slider"]')!;
const pointer = (type: string, x: number, pointerType = "mouse") =>
  act(() => {
    slider().dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType, button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: 10 }),
    );
  });
const tap = (x: number) => {
  pointer("pointerdown", x, "touch");
  pointer("pointerup", x, "touch");
};
const key = (k: string) =>
  act(() => {
    slider().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
/** x of the left or right half of star n */
const left = (n: number) => (n - 1) * 24 + 6;
const right = (n: number) => (n - 1) * 24 + 18;

describe("RatingInput", () => {
  it("sets n - 0.5 on a star's left half and n on its right half with a mouse; the current value clears", () => {
    mount(null);
    pointer("pointerdown", left(4));
    expect(changes.at(-1)).toBe(3.5);
    pointer("pointerdown", right(4));
    expect(changes.at(-1)).toBe(4);
    pointer("pointerdown", right(4));
    expect(changes.at(-1)).toBeNull();
  });

  it("previews the hovered half with a mouse", () => {
    mount(2);
    pointer("pointermove", left(5));
    expect(host.querySelector('[data-star="5"] [data-fill]')!.getAttribute("data-fill")).toBe("0.5");
    act(() => {
      slider().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
      slider().dispatchEvent(new PointerEvent("pointerleave", { bubbles: false, pointerType: "mouse" }));
    });
    expect(host.querySelector('[data-star="5"] [data-fill]')!.getAttribute("data-fill")).toBe("0");
  });

  it("taps whole stars by touch: a second tap gives the half, a third the whole star", () => {
    mount(null);
    tap(left(4));
    expect(changes.at(-1)).toBe(4);
    tap(right(4));
    expect(changes.at(-1)).toBe(3.5);
    expect(host.querySelector('[data-star="4"] [data-fill]')!.getAttribute("data-fill")).toBe("0.5");
    tap(left(4));
    expect(changes.at(-1)).toBe(4);
    tap(right(1));
    expect(changes.at(-1)).toBe(1);
    tap(right(1));
    expect(changes.at(-1)).toBe(0.5);
  });

  it("previews a drag by touch and sets the half step on release", () => {
    mount(1);
    pointer("pointerdown", right(1), "touch");
    pointer("pointermove", left(3), "touch");
    expect(changes).toEqual([]);
    expect(host.querySelector('[data-star="3"] [data-fill]')!.getAttribute("data-fill")).toBe("0.5");
    pointer("pointerup", left(3), "touch");
    expect(changes).toEqual([2.5]);
  });

  it("clears with the Clear button, which is hidden without a value", () => {
    mount(3);
    const clear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear rating"]')!;
    expect(clear.getAttribute("data-tooltip")).toBe("Clear rating");
    expect(clear.className).not.toContain("invisible");
    act(() => clear.click());
    expect(changes).toEqual([null]);
    expect(clear.className).toContain("invisible");
  });

  it("follows the keyboard", () => {
    mount(null);
    key("ArrowLeft");
    expect(changes).toEqual([]);
    key("ArrowRight");
    expect(changes.at(-1)).toBe(0.5);
    key("ArrowLeft");
    expect(changes.at(-1)).toBe(0.5);
    key("ArrowUp");
    expect(changes.at(-1)).toBe(1);
    key("End");
    expect(changes.at(-1)).toBe(5);
    key("ArrowRight");
    expect(changes.at(-1)).toBe(5);
    key("ArrowDown");
    expect(changes.at(-1)).toBe(4.5);
    key("Home");
    expect(changes.at(-1)).toBe(0.5);
    key("3");
    expect(changes.at(-1)).toBe(3);
    key("Backspace");
    expect(changes.at(-1)).toBeNull();
    key("5");
    key("Delete");
    expect(changes.slice(-2)).toEqual([5, null]);
  });

  it("speaks as a slider", () => {
    mount(null);
    expect(slider().getAttribute("aria-valuemin")).toBe("0");
    expect(slider().getAttribute("aria-valuemax")).toBe("5");
    expect(slider().getAttribute("aria-valuenow")).toBe("0");
    expect(slider().getAttribute("aria-valuetext")).toBe("Not rated");
    expect(slider().getAttribute("aria-label")).toBe("Your rating");
    key("4");
    key("ArrowRight");
    expect(slider().getAttribute("aria-valuenow")).toBe("4.5");
    expect(slider().getAttribute("aria-valuetext")).toBe("4.5 stars");
  });

  it("ignores an activation with no pointer position, as a VoiceOver double tap may send", () => {
    mount(2);
    act(() => {
      slider().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    for (const pointerType of ["touch", "mouse"])
      act(() => {
        slider().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType, button: 0 }));
        slider().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType, button: 0 }));
      });
    expect(changes).toEqual([]);
    expect(slider().getAttribute("aria-valuetext")).toBe("2 stars");
  });

  it("says star for one", () => {
    mount(null);
    key("1");
    expect(slider().getAttribute("aria-valuetext")).toBe("1 star");
    key("ArrowLeft");
    expect(slider().getAttribute("aria-valuetext")).toBe("0.5 stars");
  });

  it("outlines empty stars in fg-secondary, never fg-muted", () => {
    mount(2.5);
    const html = host.innerHTML;
    expect(html).toContain("text-fg-secondary");
    expect(html).not.toContain("fg-muted");
  });
});

describe("RatingStars", () => {
  it("shows half stars and reads the rating", () => {
    act(() => root.render(createElement(RatingStars, { value: 4.5 })));
    const img = host.querySelector('[role="img"]')!;
    expect(img.getAttribute("aria-label")).toBe("Rated 4.5 out of 5");
    expect([...img.querySelectorAll("[data-fill]")].map((e) => e.getAttribute("data-fill"))).toEqual(["1", "1", "1", "1", "0.5"]);
    act(() => root.render(createElement(RatingStars, { value: null })));
    expect(host.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Not rated");
    expect(host.innerHTML).not.toContain("fg-muted");
  });
});
