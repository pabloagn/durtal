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

type ReaderState = { durtalReader?: string; durtalDepth?: number } | null;

/** How many in-book entries sit below an entry; 0 for one that is not this reader's */
function depthOf(state: ReaderState, token: string) {
  return state?.durtalReader === token && typeof state.durtalDepth === "number" ? state.durtalDepth : 0;
}

export function createBrowserHistory(options: {
  /** Moves the reader's own history one step, without touching the browser's */
  step(direction: -1 | 1): void;
  window?: Window;
}): BrowserHistory {
  const win = options.window ?? window;
  // A reload keeps the entries the earlier open pushed, but not the reader's
  // own history. This open takes over their token and starts above them
  // (`floor`), so its Back still leaves past them; elsewhere a token per open
  // keeps entries from another open of the book from being this reader's.
  const restored = win.history.state as ReaderState;
  const token = restored?.durtalReader ?? Math.random().toString(36).slice(2);
  const floor = depthOf(restored, token);
  let depth = floor;
  let top = floor;
  // The page the reader was opened from is another address: Back to it leaves
  const address = () => win.location?.pathname;
  const reader = address();
  const pop = (event: PopStateEvent) => {
    if (address() !== reader) return;
    const at = depthOf(event.state as ReaderState, token);
    if (at === depth) return;
    // An entry from before the reload holds no place: go on past them all
    // to the page the reader was opened from
    if (at < floor) {
      depth = at;
      win.history.go(-1 - at);
      return;
    }
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
      if (direction < 0 ? depth <= floor : depth >= top) return false;
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
