"use client";
import {
  Component,
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
} from "react";
import { createPortal } from "react-dom";
import {
  createReaderBridge,
  type ReaderBridgeController,
  type ReaderSlot,
} from "@/lib/reader/bridge-state";
import type { ReaderContext, ReaderEvents } from "@/lib/reader/events";
import { registerReaderKey } from "@/lib/reader/input";

const Bridge = createContext<ReaderBridgeController | null>(null);
const Order = createContext(0);
function useBridge() {
  const bridge = useContext(Bridge);
  if (!bridge) throw new Error("Reader hooks require ReaderBridgeProvider");
  return bridge;
}
class PluginBoundary extends Component<
  { id: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
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
  children,
}: {
  context: ReaderContext;
  plugins: { id: string; node: ReactNode }[];
  children: (bridge: ReaderBridgeController) => ReactNode;
}) {
  // Provider lifecycle is one open book; ReaderView keys it by e-book/file/retry.
  const [bridge] = useState(() => createReaderBridge(context));
  useEffect(() => {
    bridge.bus.start();
    return () => bridge.bus.destroy();
  }, [bridge]);
  return (
    <Bridge.Provider value={bridge}>
      {children(bridge)}
      {plugins.map((plugin, order) => (
        <Order.Provider key={plugin.id} value={order}>
          <PluginBoundary id={plugin.id}>{plugin.node}</PluginBoundary>
        </Order.Provider>
      ))}
    </Bridge.Provider>
  );
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
  options: { when?: "always" | "selection" } = {},
) {
  const bridge = useBridge();
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  const when = options.when;
  useEffect(
    () =>
      registerReaderKey(
        key,
        (event) => {
          if (when !== "selection" || bridge.getSnapshot().selection)
            latest.current(event);
        },
        { when },
      ),
    [bridge, key, when],
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
