/**
 * Lightweight event system for refreshing the activity timeline.
 * Call triggerActivityRefresh() after any mutation that records activity.
 * The ActivityTimeline component listens for this event and re-fetches.
 */

const EVENT_NAME = "durtal:activity-refresh";

export function triggerActivityRefresh(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }
}

export function onActivityRefresh(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
