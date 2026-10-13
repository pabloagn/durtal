import { createAnnotationDeleteHooks } from "./annotation-deletion";
import { createReaderEventBus, type ReaderContext, type ReaderSelection } from "./events";
import { createControllerReadiness, type ReaderControllerFailureCode } from "./controller-readiness";
import type { ReactElement, ReactNode } from "react";
export type ReaderPluginView = {
  id: string;
  node: ReactNode;
  controller?: true;
  failure?: ReaderControllerFailureCode;
  failureNode?: ReactElement<ReaderControllerFailureProps>;
};
export type ReaderControllerFailureProps = {
  id: string;
  code: ReaderControllerFailureCode;
  onRetry?: () => void;
};
export type ReaderSlot = "toolbar-status" | "top-bar" | "selection-actions";
type Fill = { element: HTMLElement; order: number; sequence: number; placement: "normal" | "last" };
const slots: ReaderSlot[] = ["toolbar-status", "top-bar", "selection-actions"];

/** Internal controller: plugin code uses only the bridge's public hooks and fills. */
export function createReaderBridge(
  context: ReaderContext,
  options: { requiredControllerIds?: readonly string[]; failures?: Readonly<Record<string, ReaderControllerFailureCode>> } = {},
) {
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
        .sort((a, b) => Number(a.placement === "last") - Number(b.placement === "last") ||
          a.order - b.order || a.sequence - b.sequence)
        .forEach((fill) => target.append(fill.element));
  };
  const bus = createReaderEventBus();
  const controllers = createControllerReadiness(bus, options.requiredControllerIds ?? [], options.failures);
  type SelectionCapture = (origin?: Document) => { selection: ReaderSelection; clear(): void } | null;
  let selectionCapture: SelectionCapture | null = null;
  const captures = new WeakMap<ReaderSelection, { current(): boolean; clear(): void }>();
  const leaving = new Set<() => Promise<unknown>>();
  return {
    bus,
    start: controllers.start,
    destroy() {
      selectionCapture = null;
      controllers.destroy();
    },
    /** Native book selection at the action, independent of debounced UI events. */
    registerSelectionCapture(capture: SelectionCapture) {
      selectionCapture = capture;
      return () => { if (selectionCapture === capture) selectionCapture = null; };
    },
    captureSelection(origin?: Document): ReaderSelection | null {
      const capture = selectionCapture, admission = controllers.getSnapshot();
      if (!capture || !admission.ready) return null;
      const fileId = snapshot.fileId;
      const current = () => {
        const now = controllers.getSnapshot();
        return selectionCapture === capture && now.ready && now.epoch === admission.epoch &&
          now.revision === admission.revision && snapshot.fileId === fileId;
      };
      const value = capture(origin);
      if (!value || value.selection.fileId !== fileId || !current()) return null;
      const selection = structuredClone(value.selection);
      captures.set(selection, { current, clear: value.clear });
      return selection;
    },
    isSelectionCaptureCurrent(selection: ReaderSelection) {
      return captures.get(selection)?.current() ?? false;
    },
    clearCapturedSelection(selection: ReaderSelection) {
      const capture = captures.get(selection);
      if (capture?.current()) capture.clear();
      captures.delete(selection);
    },
    installController: controllers.install,
    whenControllersReady: controllers.whenReady,
    isControllerPermitCurrent: controllers.isPermitCurrent,
    reportControllerFailure: controllers.fail,
    acknowledgeVisibleControllerFailure: controllers.visibleFailure,
    subscribeControllerReadiness: controllers.subscribe,
    getControllerReadinessSnapshot: controllers.getSnapshot,
    annotationDeletes: createAnnotationDeleteHooks(),
    /** Work that must reach the server before the reader leaves for another page
     * in the app, such as the open reading sitting (SLN-677). */
    registerLeave(hook: () => Promise<unknown>) {
      leaving.add(hook);
      return () => { leaving.delete(hook); };
    },
    /** Never holds the reader for longer than `limit` ms, and never throws. */
    async leave(limit = 2000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...leaving].map((hook) => hook())),
        new Promise((done) => { timer = setTimeout(done, limit); }),
      ]);
      clearTimeout(timer);
    },
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
    fill(slot: ReaderSlot, element: HTMLElement, order: number, placement: "normal" | "last" = "normal") {
      const fill = { element, order, placement, sequence: sequence++ };
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
