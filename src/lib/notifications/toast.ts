import { toast as sonner, type ExternalToast } from "sonner";

/**
 * The app's toasts (SLN-732): Sonner's `toast`, with the house rules applied
 * where a toast is made, so every producer follows them.
 *
 * - How long a toast stays depends on its kind ({@link TOAST_DURATION}). An
 *   error stays until it is dismissed. A toast with an action (Undo, Retry)
 *   or its own duration keeps what it asks for.
 * - The same message of the same kind, while it is still on screen, is one
 *   toast: a repeat neither adds a second nor speaks again.
 * - A long operation shows a pending toast that turns into its outcome under
 *   the same id ({@link pendingToast}).
 * - Info is one look: `toast.message` is an info toast.
 */

type Kind = "success" | "info" | "warning" | "error";
type Message = Parameters<typeof sonner.success>[0];
type Id = string | number;

/** How long each kind stays, in ms. Hovering or focusing the stack holds it. */
export const TOAST_DURATION: Record<Kind, number> = {
  success: 4000,
  info: 4000,
  warning: 8000,
  error: Infinity,
};

interface Shown {
  id: Id;
  type?: string;
  title?: unknown;
}

/** What the mounted toaster shows now (a toaster left behind on another
 * layout shows nothing, so nothing of it counts) */
let onScreen: readonly Shown[] = [];
/** Toasts made in the last moment, before the toaster has drawn them */
const recent = new Map<string, { id: Id; at: number }>();
const RECENT_MS = 1000;

/** The toaster reports what it shows (AppToaster) */
export function syncShownToasts(list: readonly Shown[]) {
  // A toast that has left is no longer one to fold a repeat into
  const now = new Set(list.map((t) => t.id));
  for (const [key, entry] of recent) if (onScreen.some((t) => t.id === entry.id) && !now.has(entry.id)) recent.delete(key);
  onScreen = list;
}

/** The toast already on screen with this kind and text, if any */
function showing(kind: Kind, message: Message): Id | null {
  if (typeof message !== "string") return null;
  const just = recent.get(`${kind}\n${message}`);
  if (just && Date.now() - just.at < RECENT_MS) return just.id;
  return onScreen.find((t) => t.type === kind && t.title === message)?.id ?? null;
}

export const CONNECTION_SAVE_ERROR = "Not saved: Durtal could not be reached. Check the connection and try again.";
const NETWORK_FAILURES = new Set(["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]);
function errorMessage(message: Message): Message {
  return typeof message === "string" && NETWORK_FAILURES.has(message.trim()) ? CONNECTION_SAVE_ERROR : message;
}

function show(kind: Kind, message: Message, data?: ExternalToast): Id {
  if (kind === "error") message = errorMessage(message);
  const own = data?.id !== undefined || data?.action !== undefined || data?.cancel !== undefined;
  if (!own) {
    const same = showing(kind, message);
    if (same !== null) return same;
  }
  const keeps = data?.duration !== undefined || data?.action !== undefined || data?.cancel !== undefined;
  const id = sonner[kind](message, keeps ? data : { ...data, duration: TOAST_DURATION[kind] });
  if (!own && typeof message === "string") {
    const now = Date.now();
    for (const [key, entry] of recent) if (now - entry.at >= RECENT_MS) recent.delete(key);
    recent.set(`${kind}\n${message}`, { id, at: now });
  }
  return id;
}

/** A long operation's toast: pending now, then its outcome in the same place */
export interface PendingToast {
  id: Id;
  success(message: Message, data?: ExternalToast): Id;
  info(message: Message, data?: ExternalToast): Id;
  warning(message: Message, data?: ExternalToast): Id;
  error(message: Message, data?: ExternalToast): Id;
  /** Nothing to report: the pending toast leaves */
  dismiss(): void;
}

/**
 * Shows a pending toast ("Exporting books") that the operation's outcome
 * replaces under the same id, so it never becomes a second toast. Sonner
 * fixes a toast's lifetime when it first appears, so the pending toast starts
 * with a success's; an error ends it with no time limit at all.
 */
export function pendingToast(message: Message, data?: ExternalToast): PendingToast {
  const id = sonner.loading(message, { ...data, duration: TOAST_DURATION.success });
  const settle = (kind: Kind) => (next: Message, more?: ExternalToast) =>
    sonner[kind](kind === "error" ? errorMessage(next) : next, { ...more, id, duration: more?.duration ?? (kind === "error" ? Infinity : TOAST_DURATION.success) });
  return {
    id,
    success: settle("success"),
    info: settle("info"),
    // A warning or an error after a wait stays until it is read
    warning: (next, more) => sonner.warning(next, { ...more, id, duration: more?.duration ?? Infinity }),
    error: settle("error"),
    dismiss: () => void sonner.dismiss(id),
  };
}

/** Scope retry feedback to a particular write and record. Success removes
 * only its own previous failure; other operations' messages stay visible. */
function forAction(action: string) {
  const failureId = `action-failure:${action}`;
  return {
    error: (message: Message, data?: ExternalToast) => show("error", message, { ...data, id: failureId }),
    success: (message: Message, data?: ExternalToast) => {
      sonner.dismiss(failureId);
      return show("success", message, data);
    },
  };
}

const base = (message: Message, data?: ExternalToast) => show("info", message, data);

export const toast = Object.assign(base, {
  success: (message: Message, data?: ExternalToast) => show("success", message, data),
  info: (message: Message, data?: ExternalToast) => show("info", message, data),
  message: (message: Message, data?: ExternalToast) => show("info", message, data),
  warning: (message: Message, data?: ExternalToast) => show("warning", message, data),
  error: (message: Message, data?: ExternalToast) => show("error", message, data),
  loading: sonner.loading,
  custom: sonner.custom,
  promise: sonner.promise,
  dismiss: sonner.dismiss,
  pending: pendingToast,
  forAction,
});
