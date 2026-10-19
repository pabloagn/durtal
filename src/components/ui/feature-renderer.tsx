"use client";

import { Component, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { acquireSurface, captureFocusOrigin, hasOpenSurface, restoreFocusOrigin, type SurfaceLease } from "@/lib/ui/surface-state";
import { DialogFocusScope, useDialogFocusScope } from "./dialog-focus-scope";

/** Own one lease and focus origin across a feature's loading/error/ready views. */
export function FeatureSurface({ close, children }: { close(): void; children: ReactNode }) {
  const inherited = useDialogFocusScope();
  const [origin] = useState(() => typeof document === "undefined" ? null : captureFocusOrigin());
  const [owned, setOwned] = useState<SurfaceLease | null>(null);
  const latestClose = useRef(close);
  latestClose.current = close;
  const runs = useRef(0);
  useLayoutEffect(() => {
    if (inherited) return;
    const run = ++runs.current;
    const lease = acquireSurface(() => latestClose.current(), origin);
    setOwned(lease);
    return () => {
      lease.release();
      queueMicrotask(() => { if (runs.current === run) restoreFocusOrigin(origin); });
    };
  }, [inherited, origin]);
  return <DialogFocusScope.Provider value={inherited ?? owned}>{children}</DialogFocusScope.Provider>;
}

/**
 * How long a feature may take to load before "Loading…" shows. Most load
 * sooner, and then their dialog is the first and only one to open, with one
 * focus move (SLN-1464). Meanwhile the surface is held: Escape still cancels.
 */
export const PENDING_DELAY_MS = 300;
/**
 * The "Loading…" up now, or the one that just went: when the next stage of
 * the same open (a host, then its dialog; a failure, then its retry) takes
 * over, it keeps that clock, and shows at once if the last one had shown.
 */
let current: { since: number; shown: boolean } | null = null;
let handover: { at: number; since: number; shown: boolean } | null = null;
const HANDOVER_MS = 100;

function PendingModal({ failed, close, retry }: { failed: boolean; close(): void; retry(): void }) {
  const scope = useDialogFocusScope();
  const ref = useRef<HTMLDialogElement>(null);
  const [start] = useState(() => {
    const now = typeof performance === "undefined" ? 0 : performance.now();
    // Only within an open that is still held: a new open starts its own clock
    const before = !hasOpenSurface() ? null : current ?? (handover && now - handover.at < HANDOVER_MS ? handover : null);
    return before ? { since: before.since, shown: before.shown } : { since: now, shown: false };
  });
  const [slow, setSlow] = useState(start.shown);
  const shown = failed || slow;
  useEffect(() => {
    if (failed || slow) return;
    const timer = setTimeout(() => setSlow(true), Math.max(0, PENDING_DELAY_MS - (performance.now() - start.since)));
    return () => clearTimeout(timer);
  }, [failed, slow, start]);
  const mine = useRef<{ since: number; shown: boolean } | null>(null);
  useLayoutEffect(() => {
    mine.current = current = { since: start.since, shown };
    const element = ref.current;
    if (!element || !shown) return;
    if (!element.open) element.showModal();
    element.querySelector<HTMLButtonElement>("button")?.focus();
  }, [shown, start]);
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      const last = mine.current;
      if (last) handover = { at: performance.now(), ...last };
      if (current === last) current = null;
      if (element?.open) element.close();
    };
  }, []);
  const dismiss = () => { if (scope?.isTop()) close(); };
  return <dialog ref={ref} aria-label={failed ? "Reading action unavailable" : "Loading reading action"} onCancel={(event) => { event.preventDefault(); dismiss(); }} className="glass m-auto max-w-md overflow-hidden rounded-sm p-6 text-fg-primary">
    <p role={failed ? "alert" : "status"}>{failed ? "This reading action could not load." : "Loading reading action…"}</p>
    <div className="mt-4 flex gap-4">
      {failed && <button type="button" onClick={retry} className="underline pointer-coarse:min-h-11">Retry</button>}
      <button type="button" onClick={dismiss} className="underline pointer-coarse:min-h-11">Close</button>
    </div>
  </dialog>;
}

export function PendingDialog(props: { failed: boolean; close(): void; retry(): void }) {
  return <FeatureSurface close={props.close}><PendingModal {...props} /></FeatureSurface>;
}

/** Exceptions and suspension stay inside the invoking feature, never the book. */
export class FeatureBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
  onFailure?(error: unknown): void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFailure?.(error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Renderers that have loaded, by their loader: the next open renders at once */
const loaded = new WeakMap<object, unknown>();
/** Loads under way, by their loader: an open during a preload waits on that one */
const loading = new WeakMap<object, Promise<unknown>>();

function loadOnce<P extends object>(load: () => Promise<ComponentType<P>>): Promise<ComponentType<P>> {
  const running = loading.get(load);
  if (running) return running as Promise<ComponentType<P>>;
  const promise = Promise.resolve().then(load).then((Component) => {
    loaded.set(load, Component);
    return Component;
  });
  loading.set(load, promise);
  // A failed load is tried afresh next time
  const done = () => { if (loading.get(load) === promise) loading.delete(load); };
  promise.then(done, done);
  return promise;
}

/**
 * Starts loading a feature before it opens (SLN-1464), so its dialog can open
 * first time. A failure here is left for the open to meet and retry.
 */
export function preloadFeature<P extends object>(load: () => Promise<ComponentType<P>>): Promise<void> {
  if (loaded.has(load)) return Promise.resolve();
  return loadOnce(load).then(() => {}, () => {});
}

/** Each retry invokes this exact resource again; no rejected React.lazy cache. */
export function DeferredFeature<P extends object>({ load, rendererProps, close, pending: renderPending }: {
  load(): Promise<ComponentType<P>>;
  rendererProps: P;
  close(): void;
  /** Inline secondary editors keep the surrounding native dialog usable. */
  pending?(failed: boolean, retry: () => void): ReactNode;
}) {
  const [Renderer, setRenderer] = useState<ComponentType<P> | null>(() => (loaded.get(load) as ComponentType<P> | undefined) ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const resource = useRef<{ attempt: number; promise: Promise<ComponentType<P>> } | null>(null);
  const dismiss = () => { generation.current++; close(); };
  const retry = () => {
    generation.current++;
    resource.current = null;
    setRenderer(null); setFailed(false); setAttempt((n) => n + 1);
  };
  useEffect(() => {
    // Loaded before it opened: nothing to wait for
    if (attempt === 0 && loaded.has(load)) return;
    const expected = ++generation.current;
    if (!resource.current || resource.current.attempt !== attempt)
      resource.current = { attempt, promise: loadOnce(load) };
    void resource.current.promise.then((Component) => {
      if (generation.current === expected) setRenderer(() => Component);
    }).catch((error: unknown) => {
      if (generation.current !== expected) return;
      console.error("[reading] Feature renderer could not load:", error); setFailed(true);
    });
    return () => { generation.current++; };
  }, [load, attempt]);
  const pending = renderPending?.(failed, retry) ?? <PendingDialog failed={failed} close={dismiss} retry={retry} />;
  const failure = renderPending?.(true, retry) ?? <PendingDialog failed close={dismiss} retry={retry} />;
  const loading = renderPending?.(false, retry) ?? <PendingDialog failed={false} close={dismiss} retry={retry} />;
  const content = Renderer && !failed ? <FeatureBoundary key={attempt} fallback={failure}>
      <Suspense fallback={loading}>
        <Renderer {...rendererProps} />
      </Suspense>
    </FeatureBoundary> : pending;
  return renderPending ? content : <FeatureSurface close={dismiss}>{content}</FeatureSurface>;
}
