"use client";
import {
  Component,
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type ErrorInfo,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  createReaderBridge,
  type ReaderBridgeController,
  type ReaderSlot,
  type ReaderPluginView,
} from "@/lib/reader/bridge-state";
import { READER_CONTROLLER_EVENTS, type ReaderControllerHandlers, type ReaderControllerFailureCode } from "@/lib/reader/controller-readiness";
import type { BeforeAnnotationDelete } from "@/lib/reader/annotation-deletion";
import type { ReaderContext, ReaderEvents } from "@/lib/reader/events";
import {
  registerReaderKey,
  getReaderShortcuts,
  subscribeReaderShortcuts,
} from "@/lib/reader/input";

const Bridge = createContext<ReaderBridgeController | null>(null);
const Order = createContext(0);
const PluginIdentity = createContext<string | null>(null);
function useBridge() {
  const bridge = useContext(Bridge);
  if (!bridge) throw new Error("Reader hooks require ReaderBridgeProvider");
  return bridge;
}
class PluginBoundary extends Component<
  { id: string; children: ReactNode; controller?: true; bridge: ReaderBridgeController },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.props.controller)
      this.props.bridge.reportControllerFailure(this.props.id, "reader_controller_failed", this.props.bridge.getControllerReadinessSnapshot().epoch);
    console.error(
      `[reader] Plug-in ${this.props.id} crashed:`,
      error,
      info.componentStack,
    );
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function ReaderBridgeProvider({
  context,
  plugins,
  requiredControllerIds = [],
  onRetry,
  children,
}: {
  context: ReaderContext;
  plugins: ReaderPluginView[];
  requiredControllerIds?: readonly string[];
  onRetry?: () => void;
  children: (bridge: ReaderBridgeController) => ReactNode;
}) {
  // Provider lifecycle is one open book; ReaderView keys it by e-book/file/retry.
  const [bridge] = useState(() => {
    for (const plugin of plugins) {
      if (plugin.controller && (!requiredControllerIds.includes(plugin.id) || !plugin.failureNode))
        throw new Error(`Reader controller configuration is incomplete: ${plugin.id}`);
      if (requiredControllerIds.includes(plugin.id) && !plugin.controller)
        throw new Error(`Required reader plugin must declare its controller: ${plugin.id}`);
    }
    return createReaderBridge(context, {
      requiredControllerIds,
      failures: Object.fromEntries(plugins.filter((plugin) => plugin.controller && plugin.failure)
        .map((plugin) => [plugin.id, plugin.failure!])),
    });
  });
  useLayoutEffect(() => {
    bridge.start();
    return () => bridge.destroy();
  }, [bridge]);
  return (
    <Bridge.Provider value={bridge}>
      {children(bridge)}
      {plugins.map((plugin, order) => (
        <Order.Provider key={plugin.id} value={order}>
          <PluginIdentity.Provider value={plugin.id}>
            <PluginHost plugin={plugin} bridge={bridge} onRetry={onRetry} />
          </PluginIdentity.Provider>
        </Order.Provider>
      ))}
    </Bridge.Provider>
  );
}

function PluginHost({ plugin, bridge, onRetry }: {
  plugin: ReaderPluginView; bridge: ReaderBridgeController; onRetry?: () => void;
}) {
  const readiness = useSyncExternalStore(bridge.subscribeControllerReadiness,
    bridge.getControllerReadinessSnapshot, bridge.getControllerReadinessSnapshot);
  const failure = readiness.controllers.find((controller) => controller.id === plugin.id)?.code;
  if (plugin.controller && failure)
    return plugin.failureNode ? (
      <PluginBoundary key={`${plugin.id}:failure`} id={plugin.id} bridge={bridge}>
        {cloneElement(plugin.failureNode, { code: failure, onRetry })}
      </PluginBoundary>
    ) : null;
  return (
    <PluginBoundary key={`${plugin.id}:controller`} id={plugin.id} controller={plugin.controller} bridge={bridge}>
      {plugin.node}
    </PluginBoundary>
  );
}

/** Functional handlers are installed together before their generation is acknowledged. */
export function useReaderController(id: string, handlers: ReaderControllerHandlers) {
  const bridge = useBridge();
  const identity = useContext(PluginIdentity);
  if (identity !== id) throw new Error("Reader controller must match its configured plugin identity");
  for (const event of READER_CONTROLLER_EVENTS)
    if (typeof handlers[event] !== "function") throw new Error(`Missing reader controller handler: ${event}`);
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  useLayoutEffect(() => bridge.installController(id, {
    activity: (event) => latest.current.activity(event),
    location: (event) => latest.current.location(event),
    end: (event) => latest.current.end(event),
    selection: (event) => latest.current.selection(event),
  }), [bridge, id]);
}

/** Visible means a connected surface with painted area inside this viewport. */
export function readerControllerFailureVisible(element: HTMLElement | null): boolean {
  if (!element?.isConnected || element.ownerDocument.visibilityState === "hidden") return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (node.hidden || node.getAttribute("aria-hidden") === "true" || style.display === "none" ||
      style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
  }
  return [...element.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0 &&
    rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth);
}

/** A feature-owned failure must actually render before the plain reader is admitted. */
export function useReaderControllerFailure(id: string, code: ReaderControllerFailureCode,
  noticeRef: RefObject<HTMLElement | null>) {
  const bridge = useBridge();
  const identity = useContext(PluginIdentity);
  if (identity !== id) throw new Error("Reader failure must match its configured plugin identity");
  useLayoutEffect(() => {
    const epoch = bridge.getControllerReadinessSnapshot().epoch;
    bridge.reportControllerFailure(id, code, epoch);
    let revoke = () => {};
    const frame = requestAnimationFrame(() => {
      if (readerControllerFailureVisible(noticeRef.current))
        revoke = bridge.acknowledgeVisibleControllerFailure(id, code, epoch);
    });
    return () => { cancelAnimationFrame(frame); revoke(); };
  }, [bridge, id, code, noticeRef]);
}

export function useReaderEvent<K extends keyof ReaderEvents>(
  name: K,
  handler: (event: ReaderEvents[K]) => void,
) {
  const bridge = useBridge();
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(
    () => bridge.bus.on(name, (event) => latest.current(event)),
    [bridge, name],
  );
}
/** Confirmation only. Returning a prepared quote effect composes it with the
 * eventual durable annotation delete; no tracker write happens in this hook. */
export function useBeforeAnnotationDelete(handler: BeforeAnnotationDelete) {
  const bridge = useBridge();
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(
    () =>
      bridge.annotationDeletes.register((annotation, signal) =>
        latest.current(annotation, signal),
      ),
    [bridge],
  );
}
export function useReaderContext(): ReaderContext {
  const bridge = useBridge();
  return useSyncExternalStore(
    bridge.subscribe,
    bridge.getSnapshot,
    bridge.getSnapshot,
  );
}
export function useReaderShortcut(
  key: string,
  handler: (event: KeyboardEvent) => void,
  options: { when?: "always" | "selection"; label?: string } = {},
) {
  const bridge = useBridge();
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  const when = options.when;
  const label = options.label;
  useEffect(
    () =>
      registerReaderKey(
        key,
        (event) => {
          if (when !== "selection" || bridge.getSnapshot().selection)
            latest.current(event);
        },
        { when, label },
      ),
    [bridge, key, when, label],
  );
}
export function useReaderSlotFilled(slot: ReaderSlot): boolean {
  const bridge = useBridge();
  return useSyncExternalStore(
    bridge.subscribeSlots,
    bridge.getSlots,
    bridge.getSlots,
  )[slot];
}
export function useReaderShortcutList() {
  return useSyncExternalStore(
    subscribeReaderShortcuts,
    getReaderShortcuts,
    getReaderShortcuts,
  );
}
export function ReaderSlotFill({
  slot,
  children,
}: {
  slot: ReaderSlot;
  children?: ReactNode;
}) {
  const bridge = useBridge();
  const order = useContext(Order);
  const element = useMemo(() => {
    if (typeof document === "undefined") return null;
    const node = document.createElement("span");
    node.style.display = "contents";
    return node;
  }, []);
  useEffect(() => {
    if (!element) return;
    return bridge.fill(slot, element, order);
  }, [bridge, slot, order, element]);
  return element ? createPortal(children, element) : null;
}
