"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Shapes } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { setCollectionIcon } from "@/lib/actions/collections";

// Holds the whole icon set: loaded only when the picker opens.
const IconPickerPanel = lazy(() => import("./icon-picker-panel"));

const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 440;

/**
 * The collection's icon beside its name. Clicking it opens a Linear-style
 * picker. `children` is the current icon, rendered on the server.
 */
export function CollectionIconPicker({
  collectionId,
  value,
  children,
}: {
  collectionId: string;
  value: string | null;
  children?: ReactNode;
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

  function close(refocus = false) {
    setPosition(null);
    if (refocus) trigger.current?.focus();
  }

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
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close(true);
    }
    function scrolled(event: Event) {
      // The panel scrolls its own grid; only page scrolls close it.
      if (!panel.current?.contains(event.target as Node)) setPosition(null);
    }
    function resized() {
      setPosition(null);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
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
      } catch {
        toast.error("Could not save the icon. Try again.");
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
        title={value ? "Change icon" : "Choose an icon"}
        aria-haspopup="dialog"
        aria-expanded={!!position}
        aria-controls={position ? panelId : undefined}
        aria-busy={pending}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm text-fg-primary transition-colors hover:bg-bg-tertiary disabled:opacity-50"
      >
        {value && children ? (
          children
        ) : (
          <Shapes
            className="h-7 w-7 text-fg-muted/40"
            strokeWidth={1.5}
            absoluteStrokeWidth
            aria-hidden="true"
          />
        )}
      </button>
      {position &&
        createPortal(
          <div
            id={panelId}
            ref={panel}
            role="dialog"
            aria-label="Collection icon"
            className="fixed z-[100] max-w-[calc(100vw-16px)] rounded-sm border border-glass-border bg-bg-secondary shadow-xl"
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
