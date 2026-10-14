import { describe, expect, it } from "vitest";
import { createBrowserHistory } from "@/lib/reader/browser-history";

/** A browser's history for one address: entries, a cursor and popstate */
function fakeWindow(entries: unknown[] = [null]) {
  const listeners = new Set<(event: PopStateEvent) => void>();
  let at = entries.length - 1;
  const go = (delta: number) => {
    const next = at + delta;
    if (next < 0 || next >= entries.length) return;
    at = next;
    for (const listener of listeners) listener({ state: entries[at] } as PopStateEvent);
  };
  const win = {
    // Only the page the reader was opened from has another address
    location: {
      get pathname() {
        return entries[at] === "from" ? "/ebooks/1" : "/reader/1";
      },
    },
    addEventListener: (_: string, listener: (event: PopStateEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: PopStateEvent) => void) => listeners.delete(listener),
    history: {
      get state() {
        return entries[at];
      },
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
  return { win: win as unknown as Window, at: () => at, go, entries };
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

  it("after a reload, leaves past the earlier open's entries", () => {
    // An earlier page, the page the reader was opened from, the reader, and two jumps
    const { win, at, go } = fakeWindow(["earlier", "from", null]);
    const first = createBrowserHistory({ step: () => {}, window: win });
    first.pushed();
    first.pushed();
    first.destroy();
    // The reload: the reader's own history is gone, the browser's is not
    const steps: number[] = [];
    const history = createBrowserHistory({ step: (direction) => steps.push(direction), window: win });
    expect(history.depth).toBe(2);
    // The chip and Alt+Arrow have nothing of the browser's to step through
    expect(history.step(-1)).toBe(false);
    // A jump after the reload steps back as before
    history.pushed();
    go(-1);
    expect(steps).toEqual([-1]);
    expect(at()).toBe(4);
    // Browser Back into an entry from before the reload goes on to the page
    // the reader was opened from, and no further
    go(-1);
    expect(at()).toBe(1);
    expect(steps).toEqual([-1]);
  });

  it("takes no step when the reader's Back leaves past its entries", () => {
    const { win, at, go } = fakeWindow(["from", null]);
    const steps: number[] = [];
    const history = createBrowserHistory({ step: (direction) => steps.push(direction), window: win });
    history.pushed();
    history.pushed();
    go(-1 - history.depth);
    expect(at()).toBe(0);
    expect(steps).toEqual([]);
  });
});
