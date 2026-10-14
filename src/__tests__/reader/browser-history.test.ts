import { describe, expect, it } from "vitest";
import { createBrowserHistory } from "@/lib/reader/browser-history";

/** A browser's history for one address: entries, a cursor and popstate */
function fakeWindow() {
  const listeners = new Set<(event: PopStateEvent) => void>();
  const entries: unknown[] = [null];
  let at = 0;
  const go = (delta: number) => {
    const next = at + delta;
    if (next < 0 || next >= entries.length) return;
    at = next;
    for (const listener of listeners) listener({ state: entries[at] } as PopStateEvent);
  };
  const win = {
    addEventListener: (_: string, listener: (event: PopStateEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: PopStateEvent) => void) => listeners.delete(listener),
    history: {
      pushState(state: unknown) {
        entries.splice(at + 1);
        entries.push(state);
        at++;
      },
      back: () => go(-1),
      forward: () => go(1),
      go,
    },
  };
  return { win: win as unknown as Window, at: () => at, go };
}

describe("in-book jumps in the browser's history (SLN-681)", () => {
  it("steps the reader back and forward with the browser, and keeps the chip in step", () => {
    const { win, at, go } = fakeWindow();
    const steps: number[] = [];
    const history = createBrowserHistory({ step: (direction) => steps.push(direction), window: win });
    history.pushed();
    history.pushed();
    expect(history.depth).toBe(2);
    // Browser Back: one reader step back
    go(-1);
    expect(steps).toEqual([-1]);
    expect(history.depth).toBe(1);
    // The chip goes through the browser, whose popstate makes the step
    expect(history.step(-1)).toBe(true);
    expect(steps).toEqual([-1, -1]);
    expect(at()).toBe(0);
    // Nothing further back is the reader's: the chip steps on its own
    expect(history.step(-1)).toBe(false);
    // Forward again through the browser
    expect(history.step(1)).toBe(true);
    expect(steps).toEqual([-1, -1, 1]);
    // A new jump drops the forward entries
    history.pushed();
    expect(history.step(1)).toBe(false);
    history.destroy();
    go(-1);
    expect(steps).toEqual([-1, -1, 1]);
  });
});
