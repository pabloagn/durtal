"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { Toaster, useSonner, type ToastT } from "sonner";
import { syncShownToasts } from "@/lib/notifications/toast";
import { NotificationRecorder } from "./notification-recorder";

/** Clear of the phone's home indicator and of the screen's edge */
const EDGE = "16px + env(safe-area-inset-bottom)";
/** The gap above a bar the toasts keep clear of */
const ABOVE = 12;

const ICON = "h-4 w-4";

/**
 * The app's toasts, on every page and in the reader (SLN-567, SLN-732). Each
 * toast has its own small cross in its top-right corner: it dismisses that
 * toast only, and runs none of its actions. Several toasts stack, at most
 * three in view; pointing at the stack or focusing it spreads it out and
 * holds every timer. Errors and warnings also go to the notification history.
 *
 * Toasts are made through `@/lib/notifications/toast`, which sets how long
 * each kind stays and keeps a repeat to one toast.
 */
export function AppToaster() {
  const section = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const holder = useLayerHost(layer);
  const clear = useClearance();
  const bottom = clear > 0 ? `max(${EDGE}, ${clear + ABOVE}px)` : `calc(${EDGE})`;
  return (
    <>
      <NotificationRecorder />
      <ToastAnnouncer section={section} mounted={!!holder} />
      <ToastFocus />
      {/* In the top layer, so a toast shows over an open dialog; it lets
          every click outside a toast through */}
      {holder && createPortal(<div
        ref={layer}
        popover="manual"
        data-toast-layer=""
        className="pointer-events-none fixed inset-0 m-0 size-full max-h-none max-w-none overflow-visible border-0 bg-transparent p-0 [&_[data-sonner-toaster]]:pointer-events-auto"
      >
        <Toaster
          ref={section}
          position="bottom-right"
          closeButton
          visibleToasts={3}
          offset={{ bottom, right: 16 }}
          mobileOffset={{ bottom, left: 16, right: 16 }}
          icons={{
            close: <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />,
            success: <CircleCheck className={`${ICON} text-fg-secondary`} strokeWidth={1.5} aria-hidden />,
            info: <Info className={`${ICON} text-fg-secondary`} strokeWidth={1.5} aria-hidden />,
            warning: <TriangleAlert className={`${ICON} text-accent-gold`} strokeWidth={1.5} aria-hidden />,
            error: <CircleAlert className={`${ICON} text-accent-red-text`} strokeWidth={1.5} aria-hidden />,
            loading: <LoaderCircle className={`${ICON} text-fg-secondary motion-safe:animate-spin`} strokeWidth={1.5} aria-hidden />,
          }}
          toastOptions={{
            closeButtonAriaLabel: "Dismiss",
            style: {
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-bg-tertiary)",
              color: "var(--color-fg-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: "0.875rem",
              borderRadius: "var(--radius-sm)",
            },
          }}
        />
      </div>, holder)}
    </>
  );
}

/**
 * Where the toasts live: in the page, or inside the open modal dialog. A
 * modal dialog makes the rest of the page inert, so toasts outside it could
 * be seen but not dismissed; inside it they can. Their layer is a popover, in
 * the top layer, so it is placed against the screen wherever it sits, and it
 * is shown again after each move so it stays above the dialog.
 */
const noSubscription = () => () => {};

function useLayerHost(layer: React.RefObject<HTMLDivElement | null>) {
  // Made in the browser only; the layer renders into it once hydrated
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  const [box] = useState(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.dataset.toastHolder = "";
    return el;
  });
  useEffect(() => {
    if (!box) return;
    document.body.append(box);
    // Dialogs in the order they opened: the last one is on top
    let opened: HTMLDialogElement[] = [];
    let frame = 0;
    const raise = () => {
      const el = layer.current;
      if (!el || typeof el.showPopover !== "function") return;
      try {
        if (el.matches(":popover-open")) el.hidePopover();
        el.showPopover();
      } catch {
        // Left in the page: the toasts still show
      }
    };
    const place = () => {
      opened = opened.filter((d) => d.isConnected && d.open && d.matches(":modal"));
      const host = opened.at(-1) ?? document.body;
      if (box.parentNode !== host) host.append(box);
      raise();
    };
    const changes = new MutationObserver((records) => {
      let moved = false;
      for (const r of records) {
        if (r.type === "attributes" && r.target instanceof HTMLDialogElement) {
          moved = true;
          if (r.target.open && !opened.includes(r.target)) opened.push(r.target);
        } else if (r.type === "childList" && (r.removedNodes.length && (!box.isConnected || opened.some((d) => !d.isConnected)))) {
          moved = true;
        }
      }
      if (!moved) return;
      cancelAnimationFrame(frame);
      // A closing dialog takes the toasts with it: they come back at once
      if (!box.isConnected) place();
      else frame = requestAnimationFrame(place);
    });
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    for (const d of document.querySelectorAll("dialog")) if (d.open) opened.push(d);
    place();
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      box.remove();
    };
  }, [box, layer]);
  // The layer renders a moment after hydration: up it goes
  useEffect(() => {
    const el = layer.current;
    if (!hydrated || !el || typeof el.showPopover !== "function") return;
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      // Left in the page
    }
  }, [hydrated, layer]);
  return hydrated ? box : null;
}

/** Bars the toasts sit above: the reader's bottom bar keeps its place
 * while it is hidden, so the toasts do not jump as it comes and goes */
const AVOID = "[data-toast-avoid], [data-reader-bottom-bar]";
/** A bar this near the bottom of the screen counts as at the bottom */
const NEAR_BOTTOM = 48;
/** The toasts' width beside a wide screen's right edge (Sonner's) */
const TOAST_WIDTH = 356;

/**
 * How far up from the bottom of the screen a bar marked `data-toast-avoid`
 * (a selection toolbar) or the reader's bottom bar reaches, so the toasts
 * sit above it. A bar beside the toasts' column, not under it, is left alone.
 */
function useClearance() {
  const [clear, setClear] = useState(0);
  useEffect(() => {
    let frame = 0;
    const sizes = new ResizeObserver(() => measure());
    const watched = new Set<Element>();
    function measure() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let reach = 0;
        for (const el of document.querySelectorAll(AVOID)) {
          if (!watched.has(el)) {
            watched.add(el);
            sizes.observe(el);
          }
          const r = el.getBoundingClientRect();
          // Sonner's toasts span a phone's width, else sit at the right
          const left = innerWidth <= 600 ? 16 : innerWidth - 16 - TOAST_WIDTH;
          const under = r.right > left && r.left < innerWidth - 16;
          if (r.height > 0 && under && r.bottom >= innerHeight - NEAR_BOTTOM) reach = Math.max(reach, innerHeight - r.top);
        }
        setClear(Math.round(reach));
      });
    }
    const changes = new MutationObserver(measure);
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-toast-avoid", "data-reader-bottom-bar"] });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      changes.disconnect();
      sizes.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return clear;
}

function spoken(toast: ToastT) {
  const title = typeof toast.title === "string" ? toast.title.trim() : "";
  const description = typeof toast.description === "string" ? toast.description.trim() : "";
  return [title, description].filter(Boolean).join(". ");
}

/** How long a spoken line stays in its region (it is read once, on arrival) */
const SPOKEN_MS = 7000;

/**
 * Says each toast once (SLN-732): an error at once, anything else when the
 * screen reader is free. A pending toast that becomes its outcome says the
 * outcome; a repeat that stays one toast says nothing. Sonner's own list is a
 * live region that reads every change to every toast, so it is silenced and
 * these two regions speak instead.
 */
function ToastAnnouncer({ section, mounted }: { section: React.RefObject<HTMLElement | null>; mounted: boolean }) {
  const { toasts } = useSonner();
  const said = useRef(new Map<string | number, string>());
  const polite = useRef<HTMLDivElement>(null);
  const assertive = useRef<HTMLDivElement>(null);

  // The list mounts a moment after the announcer, in its holder
  useEffect(() => {
    const el = section.current;
    if (!mounted || !el) return;
    el.setAttribute("aria-live", "off");
    el.removeAttribute("aria-relevant");
    el.removeAttribute("aria-atomic");
  }, [section, mounted]);

  useEffect(() => {
    const shown = toasts.filter((t) => !t.delete);
    syncShownToasts(shown.map((t) => ({ id: t.id, type: t.type, title: t.title })));
    // Oldest first, so toasts that arrive together are said in order
    for (const toast of [...shown].reverse()) {
      const text = spoken(toast);
      const key = `${toast.type}\n${text}`;
      if (!text || said.current.get(toast.id) === key) continue;
      said.current.set(toast.id, key);
      const region = toast.type === "error" ? assertive.current : polite.current;
      if (!region) continue;
      const line = document.createElement("p");
      line.textContent = text;
      region.append(line);
      setTimeout(() => line.remove(), SPOKEN_MS);
    }
    const live = new Set(shown.map((t) => t.id));
    for (const id of said.current.keys()) if (!live.has(id)) said.current.delete(id);
  }, [toasts]);

  useEffect(() => () => syncShownToasts([]), []);

  return (
    <>
      <div ref={polite} className="sr-only" aria-live="polite" data-toast-announcer="polite" />
      <div ref={assertive} className="sr-only" aria-live="assertive" data-toast-announcer="assertive" />
    </>
  );
}

/**
 * A toast dismissed from the keyboard takes the focus with it. The focus
 * moves to the next toast's cross (or the one before), and when none is left
 * it goes back where it was before it entered the toasts.
 */
function ToastFocus() {
  useEffect(() => {
    let before: HTMLElement | null = null;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      const from = event.relatedTarget as HTMLElement | null;
      if (target?.closest("[data-sonner-toaster]") && !from?.closest("[data-sonner-toaster]")) before = from;
    };
    const onClick = (event: MouseEvent) => {
      // A click from Enter or Space has no pointer position (detail 0)
      if (event.detail !== 0) return;
      const button = (event.target as Element | null)?.closest("button");
      const toast = button?.closest<HTMLElement>("[data-sonner-toast]");
      if (!button || !toast || !toast.contains(document.activeElement)) return;
      if (!button.matches("[data-close-button], [data-button], [data-cancel]")) return;
      const list = [...(toast.parentElement?.querySelectorAll<HTMLElement>("[data-sonner-toast]:not([data-removed='true'])") ?? [])];
      const at = list.indexOf(toast);
      const next = list[at + 1] ?? list[at - 1];
      const target = next?.querySelector<HTMLElement>("[data-close-button]") ?? next;
      if (target) target.focus({ preventScroll: true });
      else if (before?.isConnected) before.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("click", onClick, true);
    };
  }, []);
  return null;
}
