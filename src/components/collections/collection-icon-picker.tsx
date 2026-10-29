"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Shapes } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Spinner } from "@/components/ui/spinner";
import { acquireSurface, handleSurfaceEscape } from "@/lib/ui/surface-state";
import { coverLetter } from "@/components/books/cover-letter";
import { setCollectionIcon } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

// Holds the whole icon set: loaded only when the picker opens.
const IconPickerPanel = lazy(() => import("./icon-picker-panel"));

const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 440;

/**
 * The collection's icon beside its name. Clicking it opens a Linear-style
 * picker. `children` is the current icon, rendered on the server; with none
 * the button shows the name's letter, faint, as a blank cover does (the plain
 * icon mark when the name has no letter or digit, or when `letterShown`: the
 * poster beside it already shows the letter, SLN-1059).
 */
export function CollectionIconPicker({
  collectionId,
  name,
  value,
  children,
  letterShown = false,
}: {
  collectionId: string;
  name: string;
  value: string | null;
  children?: ReactNode;
  /** The poster beside it is the name's letter: show it once */
  letterShown?: boolean;
}) {
  const router = useRouter();
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    // Fixed panel in a portal; clamp it inside the viewport.
    setPosition({
      left: Math.max(
        8,
        Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8),
      ),
      top: Math.max(
        8,
        Math.min(rect.bottom + 6, window.innerHeight - PANEL_HEIGHT - 8),
      ),
    });
  }

  const close = useCallback((refocus = false) => {
    setPosition(null);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!position) return;
    const lease = acquireSurface(() => close(true), trigger.current
      ? { target: trigger.current, menuButton: null } : null, { blockCommandPalette: true });
    return () => lease.release();
  }, [position, close]);

  useEffect(() => {
    if (!position) return;
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setPosition(null);
    }
    function scrolled(event: Event) {
      // The panel scrolls its own grid; only page scrolls close it.
      if (!panel.current?.contains(event.target as Node)) setPosition(null);
    }
    function resized() {
      setPosition(null);
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
    };
  }, [position]);

  function pick(name: string | null) {
    close(true);
    if (name === value) return;
    startTransition(async () => {
      try {
        await setCollectionIcon(collectionId, name);
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, "Could not save the icon. Try again."));
      }
    });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        disabled={pending}
        onClick={() => (position ? close() : open())}
        aria-label={
          value ? "Change collection icon" : "Choose a collection icon"
        }
        data-tooltip={value ? "Change icon" : "Choose an icon"}
        aria-haspopup="dialog"
        aria-expanded={!!position}
        aria-controls={position ? panelId : undefined}
        aria-busy={pending}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-fg-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
      >
        {value && children ? (
          children
        ) : letterShown || !coverLetter(name) ? (
          // A name with no letter or digit ("★★★"), or one whose letter the
          // poster already shows: the plain icon mark
          <Shapes
            className="h-7 w-7 text-fg-muted/40"
            strokeWidth={1.5}
            absoluteStrokeWidth
            aria-hidden="true"
          />
        ) : (
          <span
            aria-hidden="true"
            data-decorative=""
            className="font-serif text-2xl leading-none text-fg-muted/40 [text-box:trim-both_cap_alphabetic]"
          >
            {coverLetter(name)}
          </span>
        )}
      </button>
      {position &&
        createPortal(
          <div
            id={panelId}
            ref={panel}
            role="dialog"
            aria-label="Collection icon"
            onKeyDown={(event) => {
              if (event.key === "Escape" && handleSurfaceEscape(event.nativeEvent)) event.stopPropagation();
            }}
            className="glass fixed z-[100] max-w-[calc(100vw-16px)]"
            style={{ ...position, width: PANEL_WIDTH }}
          >
            <Suspense
              fallback={
                <div className="flex h-40 items-center justify-center">
                  <Spinner className="h-5 w-5" />
                </div>
              }
            >
              <IconPickerPanel value={value} onPick={pick} />
            </Suspense>
          </div>,
          document.body,
        )}
    </>
  );
}
