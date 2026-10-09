import { createReaderEventBus, type ReaderContext } from "./events";
export type ReaderSlot = "toolbar-status" | "top-bar" | "selection-actions";
type Fill = { element: HTMLElement; order: number; sequence: number };
const slots: ReaderSlot[] = ["toolbar-status", "top-bar", "selection-actions"];

/** Internal controller: plugin code uses only the bridge's public hooks and fills. */
export function createReaderBridge(context: ReaderContext) {
  const listeners = new Set<() => void>();
  const slotListeners = new Set<() => void>();
  const targets = new Map<ReaderSlot, HTMLElement>();
  const fills = new Map<ReaderSlot, Set<Fill>>(
    slots.map((slot) => [slot, new Set()]),
  );
  let sequence = 0;
  let snapshot = context;
  let filled: Readonly<Record<ReaderSlot, boolean>> = {
    "toolbar-status": false,
    "top-bar": false,
    "selection-actions": false,
  };
  const notifySlots = () => {
    filled = Object.fromEntries(
      slots.map((slot) => [slot, !!fills.get(slot)?.size]),
    ) as Record<ReaderSlot, boolean>;
    slotListeners.forEach((fn) => fn());
  };
  const arrange = (slot: ReaderSlot) => {
    const target = targets.get(slot);
    if (target)
      [...fills.get(slot)!]
        .sort((a, b) => a.order - b.order || a.sequence - b.sequence)
        .forEach((fill) => target.append(fill.element));
  };
  return {
    bus: createReaderEventBus(),
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => snapshot,
    update(update: Partial<ReaderContext>) {
      snapshot = { ...snapshot, ...update };
      listeners.forEach((fn) => fn());
    },
    subscribeSlots(fn: () => void) {
      slotListeners.add(fn);
      return () => {
        slotListeners.delete(fn);
      };
    },
    getSlots: () => filled,
    mountSlot(slot: ReaderSlot, element: HTMLElement | null) {
      const old = targets.get(slot);
      if (old && old !== element)
        fills.get(slot)!.forEach((fill) => fill.element.remove());
      if (element) targets.set(slot, element);
      else targets.delete(slot);
      arrange(slot);
    },
    fill(slot: ReaderSlot, element: HTMLElement, order: number) {
      const fill = { element, order, sequence: sequence++ };
      fills.get(slot)!.add(fill);
      arrange(slot);
      notifySlots();
      return () => {
        fills.get(slot)!.delete(fill);
        element.remove();
        notifySlots();
      };
    },
  };
}
export type ReaderBridgeController = ReturnType<typeof createReaderBridge>;
