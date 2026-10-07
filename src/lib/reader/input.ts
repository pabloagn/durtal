/**
 * The reader's one input layer (eBooks sub-issue 3). It listens on the app's
 * document and on every section document the engine loads, so keys, taps,
 * swipes and the wheel keep working after a click into the text (the old
 * reader lost its keys there).
 *
 * Keys: → and Space for the next page, ← and Shift+Space for the previous
 * one (← and → go left and right, so a right-to-left book turns the right
 * way), PageDown and PageUp, Home and End, t contents, s settings, f full
 * screen, Esc closes. No key fires while focus is in a text field or a
 * slider, or while the command palette or a dialog is open (Esc aside).
 * Touch and mouse: the left 30% goes left, the right 30% goes right, the
 * centre shows or hides the bars; a swipe of 40 px or more, mostly
 * horizontal, turns; a long press selects and never turns. The wheel turns
 * one page per gesture.
 */

export interface ReaderActions {
  next(): void;
  prev(): void;
  /** Toward the left edge: the previous page in a left-to-right book */
  left(): void;
  right(): void;
  first(): void;
  last(): void;
  toggleBars(): void;
  contents(): void;
  settings(): void;
  fullscreen(): void;
  /** Esc: closes the open panel, else leaves full screen */
  escape(): void;
  /** Any input that is reading: a turn, a key, a tap */
  activity?(kind: "turn" | "key" | "pointer" | "scroll"): void;
}

export interface ReaderInputOptions {
  actions: ReaderActions;
  /** A dialog or the command palette is open: only Esc goes through */
  isBlocked(): boolean;
  /** Whether a selection stands in the book (a registered key may need one) */
  hasSelection?(): boolean;
  now?(): number;
}

type KeyWhen = "always" | "selection";
interface RegisteredKey {
  handler: (event: KeyboardEvent) => void;
  when: KeyWhen;
}

const registry = new Map<string, Set<RegisteredKey>>();

/**
 * A key for the reader beyond its own (sub-issue 4 passes plug-in shortcuts
 * through here, such as the tracker's `q` with a selection). It fires from
 * the app and from inside the book alike. Returns the unregister function.
 */
export function registerReaderKey(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options: { when?: KeyWhen } = {},
): () => void {
  const entry: RegisteredKey = { handler, when: options.when ?? "always" };
  const set = registry.get(key) ?? new Set<RegisteredKey>();
  set.add(entry);
  registry.set(key, set);
  return () => {
    set.delete(entry);
    if (!set.size) registry.delete(key);
  };
}

/** A text field, a select, a slider or editable text: keys belong to it. Works across frames. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as (Element & { isContentEditable?: boolean; type?: string }) | null;
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const role = el.getAttribute("role");
  if (role === "slider" || role === "combobox" || role === "textbox" || role === "spinbutton") return true;
  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;
  const type = (el.getAttribute("type") ?? "text").toLowerCase();
  return !["button", "checkbox", "radio", "submit", "reset", "image", "file", "color"].includes(type);
}

/** Taps, swipes and long presses */
export const TAP_ZONE = 0.3;
export const SWIPE_MIN = 40;
export const LONG_PRESS_MS = 500;
const TAP_SLOP = 10;
/** A click this soon after a touch is the touch's own emulated click */
const GHOST_CLICK_MS = 700;
/** The wheel is still in the same gesture until it rests this long */
const WHEEL_REST_MS = 220;
const WHEEL_MIN = 12;

interface Point {
  x: number;
  y: number;
  at: number;
}

export interface ReaderInput {
  /** Listens on a document: the app's, or a section's inside the book */
  attach(doc: Document): () => void;
  destroy(): void;
}

export function createReaderInput(options: ReaderInputOptions): ReaderInput {
  const { actions } = options;
  const now = options.now ?? (() => Date.now());
  const detachers = new Set<() => void>();
  let touchStart: Point | null = null;
  let touchMoved = false;
  let lastTouchEnd = -Infinity;
  let wheelTotal = 0;
  let wheelTurned = false;
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;

  /** x in the reader's viewport, for an event in any of its documents */
  const viewportX = (doc: Document, clientX: number) => {
    const frame = doc.defaultView?.frameElement;
    return frame ? frame.getBoundingClientRect().left + clientX : clientX;
  };
  const viewportWidth = () => (typeof window === "undefined" ? 0 : window.innerWidth);

  const selectionIn = (doc: Document) => {
    const selection = doc.getSelection?.();
    return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
  };

  const zoneTap = (doc: Document, clientX: number) => {
    const width = viewportWidth();
    if (!width) return;
    const x = viewportX(doc, clientX) / width;
    if (x < TAP_ZONE) {
      actions.left();
      actions.activity?.("turn");
    } else if (x > 1 - TAP_ZONE) {
      actions.right();
      actions.activity?.("turn");
    } else {
      actions.toggleBars();
      actions.activity?.("pointer");
    }
  };

  /** Clicks on links, controls and the bars are theirs, not a page turn */
  const interactive = (target: EventTarget | null) => {
    const el = target as Element | null;
    if (!el || el.nodeType !== 1) return false;
    return !!el.closest("a[href], button, input, select, textarea, label, summary, [role=button], [role=dialog], dialog, [data-reader-chrome]");
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      // A dialog closes itself; the reader's Esc is for when none is open
      if (options.isBlocked()) return;
      actions.escape();
      return;
    }
    if (options.isBlocked() || isEditableTarget(event.target)) return;
    const registered = registry.get(event.key);
    if (registered?.size) {
      const selection = options.hasSelection?.() ?? false;
      let handled = false;
      for (const entry of registered) {
        if (entry.when === "selection" && !selection) continue;
        entry.handler(event);
        handled = true;
      }
      if (handled) {
        event.preventDefault();
        return;
      }
    }
    const turn = (fn: () => void) => {
      event.preventDefault();
      fn();
      actions.activity?.("turn");
    };
    switch (event.key) {
      case "ArrowRight":
        return turn(actions.right);
      case "ArrowLeft":
        return turn(actions.left);
      case " ":
      case "Spacebar":
        return turn(event.shiftKey ? actions.prev : actions.next);
      case "PageDown":
        return turn(actions.next);
      case "PageUp":
        return turn(actions.prev);
      case "Home":
        return turn(actions.first);
      case "End":
        return turn(actions.last);
    }
    if (event.shiftKey || event.repeat) return;
    const single: Record<string, () => void> = { t: actions.contents, s: actions.settings, f: actions.fullscreen };
    const action = single[event.key.toLowerCase()];
    if (action && event.key.length === 1) {
      event.preventDefault();
      action();
      actions.activity?.("key");
    }
  };

  const attach = (doc: Document) => {
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, at: now() };
      touchMoved = false;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touchStart) return;
      const touch = event.touches[0];
      if (touch && Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > TAP_SLOP) touchMoved = true;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const start = touchStart;
      touchStart = null;
      lastTouchEnd = now();
      if (!start || event.touches.length) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const held = now() - start.at;
      if (selectionIn(doc)) return;
      if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
        // The finger moves left: the page on the right comes in
        if (dx < 0) actions.right();
        else actions.left();
        actions.activity?.("turn");
        return;
      }
      // A long press selects text; it never turns or toggles
      if (touchMoved || held >= LONG_PRESS_MS || interactive(event.target)) return;
      zoneTap(doc, touch.clientX);
    };
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      if (now() - lastTouchEnd < GHOST_CLICK_MS) return;
      if (interactive(event.target) || selectionIn(doc)) return;
      zoneTap(doc, event.clientX);
    };
    const onWheel = (event: WheelEvent) => {
      if (options.isBlocked() || event.ctrlKey) return;
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      wheelTotal += delta;
      if (!wheelTurned && Math.abs(wheelTotal) >= WHEEL_MIN) {
        wheelTurned = true;
        if (wheelTotal > 0) actions.next();
        else actions.prev();
        actions.activity?.("turn");
      }
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelTotal = 0;
        wheelTurned = false;
      }, WHEEL_REST_MS);
    };
    doc.addEventListener("keydown", onKeyDown);
    doc.addEventListener("touchstart", onTouchStart, { passive: true });
    doc.addEventListener("touchmove", onTouchMove, { passive: true });
    doc.addEventListener("touchend", onTouchEnd);
    doc.addEventListener("click", onClick);
    doc.addEventListener("wheel", onWheel, { passive: true });
    const detach = () => {
      doc.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("touchstart", onTouchStart);
      doc.removeEventListener("touchmove", onTouchMove);
      doc.removeEventListener("touchend", onTouchEnd);
      doc.removeEventListener("click", onClick);
      doc.removeEventListener("wheel", onWheel);
      detachers.delete(detach);
    };
    detachers.add(detach);
    return detach;
  };

  return {
    attach,
    destroy() {
      for (const detach of [...detachers]) detach();
      if (wheelTimer) clearTimeout(wheelTimer);
    },
  };
}
