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

export interface SurfaceLease {
  isTop(): boolean;
  release(): void;
}
const stack: { lease: SurfaceLease; close(): void; origin: FocusOrigin | null }[] = [];
export const hasOpenSurface = () => stack.length > 0;

/** Shared by the host and the input layer inside book documents. */
export function handleSurfaceEscape(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.key !== "Escape") return false;
  const top = stack.at(-1);
  if (!top) return false;
  event.preventDefault();
  top.close();
  return true;
}
export function acquireSurface(close: () => void, origin = captureFocusOrigin()): SurfaceLease {
  const entry = { lease: null as unknown as SurfaceLease, close, origin };
  const lease: SurfaceLease = {
    isTop: () => stack.at(-1) === entry,
    release() {
      const index = stack.indexOf(entry);
      if (index === -1) return;
      stack.splice(index, 1);
      transferredOrigin = entry.origin;
      queueMicrotask(() => { if (transferredOrigin === entry.origin) transferredOrigin = null; });
      if (!stack.length) document.removeEventListener("keydown", handleSurfaceEscape);
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
