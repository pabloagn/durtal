/**
 * In-book jumps as browser history entries (SLN-681). Following a link, a
 * footnote or any other jump pushes an entry for the same address, so browser
 * Back, a mouse back button or Android back returns to the place before it,
 * as the reader's own Back chip does. The chip and Alt+Arrow step through the
 * browser too while it holds the entry, so the two never drift apart.
 */
export interface BrowserHistory {
  /** The reader's history gained an entry */
  pushed(): void;
  /** Steps through the browser when it holds that entry; false when it does not */
  step(direction: -1 | 1): boolean;
  /** How many reader entries sit above the page the reader was opened on */
  readonly depth: number;
  destroy(): void;
}

export function createBrowserHistory(options: {
  /** Moves the reader's own history one step, without touching the browser's */
  step(direction: -1 | 1): void;
  window?: Window;
}): BrowserHistory {
  const win = options.window ?? window;
  // Entries from another open of the book (a reload) are not this reader's
  const token = Math.random().toString(36).slice(2);
  let depth = 0;
  let top = 0;
  const pop = (event: PopStateEvent) => {
    const state = event.state as { durtalReader?: string; durtalDepth?: number } | null;
    const at = state?.durtalReader === token && typeof state.durtalDepth === "number" ? state.durtalDepth : 0;
    if (at === depth) return;
    const direction = at < depth ? -1 : 1;
    const steps = Math.abs(at - depth);
    depth = at;
    for (let i = 0; i < steps; i++) options.step(direction);
  };
  win.addEventListener("popstate", pop);
  return {
    pushed() {
      depth++;
      top = depth;
      win.history.pushState({ durtalReader: token, durtalDepth: depth }, "");
    },
    step(direction) {
      if (direction < 0 ? depth <= 0 : depth >= top) return false;
      if (direction < 0) win.history.back();
      else win.history.forward();
      return true;
    },
    get depth() {
      return depth;
    },
    destroy() {
      win.removeEventListener("popstate", pop);
    },
  };
}
