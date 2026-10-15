export interface FocusOrigin {
  target: HTMLElement;
  menuButton: HTMLElement | null;
}

let lastFocus: FocusOrigin | null = null;
let transferredOrigin: FocusOrigin | null = null;
function originOf(target: HTMLElement): FocusOrigin {
  const menu = target.closest('[role="menu"]');
  return {
    target,
    menuButton: menu?.parentElement?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null,
  };
}
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof HTMLElement) lastFocus = originOf(event.target);
  });
}
export function captureFocusOrigin(): FocusOrigin | null {
  const active = document.activeElement;
  if (transferredOrigin && (!(active instanceof HTMLElement) || active === document.body || active.closest("dialog, [cmdk-root]"))) return transferredOrigin;
  if (active === document.body && stack.at(-1)?.origin) return stack.at(-1)!.origin;
  if (active instanceof HTMLElement && active !== document.body)
    return lastFocus?.target === active ? lastFocus : originOf(active);
  return lastFocus && !lastFocus.target.isConnected ? lastFocus : null;
}

/**
 * Asked before a surface closes from Esc. True when it took over the close:
 * a draft with unsaved changes asks Save, Discard or Keep editing first.
 */
export type CloseGuard = () => boolean;

export interface SurfaceLease {
  isTop(): boolean;
  release(): void;
  /** The dialog inside the surface guards its close; returns the remover. */
  guard(guard: CloseGuard): () => void;
}
const stack: { lease: SurfaceLease; close(): void; origin: FocusOrigin | null; guard: CloseGuard | null }[] = [];
export const hasOpenSurface = () => stack.length > 0;

const passing = new WeakSet<Event>();

/**
 * A rich text editor (ProseMirror) marks every Esc handled, to stop the
 * browser's own; it closes nothing there. Noted before the editor sees it,
 * such an Esc still reaches the dialog or page around the editor.
 */
export function passEscapeThrough(event: KeyboardEvent) {
  if (event.key === "Escape" && !event.defaultPrevented) passing.add(event);
}

/**
 * ⌘Enter (Ctrl+Enter) in a rich text editor saves the dialog around it
 * (SLN-631), where the editor would break the line: the key is kept from
 * the editor and left to the shortcuts.
 */
export function passSaveThrough(event: KeyboardEvent, mac: boolean) {
  const mod = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;
  if (event.key !== "Enter" || !mod || other || event.altKey || event.shiftKey || event.defaultPrevented) return;
  event.preventDefault();
  passing.add(event);
}

/** A key an editor marked handled only to pass it on (Esc, ⌘Enter) */
export function isPassedThrough(event: Event): boolean {
  return passing.has(event);
}

/** The editor's own use of Esc (it closes something of its own): it stops there */
export function keepEscape(event: KeyboardEvent) {
  event.preventDefault();
  passing.delete(event);
}

/**
 * A key the browser or a popover of the page still owns: an input method
 * composing, a modifier, or an open light-dismiss popover (Esc closes that
 * one first, natively).
 */
export function isFreeEscape(event: KeyboardEvent): boolean {
  if ((event.defaultPrevented && !passing.has(event)) || event.isComposing || event.keyCode === 229) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key !== "Escape") return false;
  try {
    if (document.querySelector('[popover="auto"]:popover-open')) return false;
  } catch {
    // A browser without popovers has none open
  }
  return true;
}

/** Shared by the host and the input layer inside book documents. */
export function handleSurfaceEscape(event: KeyboardEvent): boolean {
  if (!isFreeEscape(event)) return false;
  const top = stack.at(-1);
  if (!top) return false;
  event.preventDefault();
  if (!top.guard?.()) top.close();
  return true;
}
export function acquireSurface(close: () => void, origin = captureFocusOrigin()): SurfaceLease {
  const entry: (typeof stack)[number] = { lease: null as unknown as SurfaceLease, close, origin, guard: null };
  const lease: SurfaceLease = {
    isTop: () => stack.at(-1) === entry,
    release() {
      const index = stack.indexOf(entry);
      if (index === -1) return;
      stack.splice(index, 1);
      // A surface that opens as this one closes (the palette's "Keyboard
      // shortcuts") gives the focus back to where this one had it. It opens
      // in the render after the close, so the origin is kept for a frame
      transferredOrigin = entry.origin;
      const clear = () => { if (transferredOrigin === entry.origin) transferredOrigin = null; };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(clear);
      else queueMicrotask(clear);
      if (!stack.length) document.removeEventListener("keydown", handleSurfaceEscape);
    },
    guard(guard) {
      entry.guard = guard;
      return () => {
        if (entry.guard === guard) entry.guard = null;
      };
    },
  };
  entry.lease = lease;
  if (!stack.length) document.addEventListener("keydown", handleSurfaceEscape);
  stack.push(entry);
  return lease;
}

export function restoreFocusOrigin(origin: FocusOrigin | null) {
  if (hasOpenSurface()) return;
  const active = document.activeElement;
  // A connected control outside a removed dialog represents newer user intent.
  if (active instanceof HTMLElement && active !== document.body && active.isConnected && !active.closest("dialog")) return;
  for (const element of [origin?.target, origin?.menuButton]) {
    if (element?.isConnected) {
      element.focus({ preventScroll: true });
      return;
    }
  }
}
