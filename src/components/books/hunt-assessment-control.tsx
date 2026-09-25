"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Gem, X } from "lucide-react";
import { toast } from "sonner";
import { localToday, type HuntAssessment } from "@/lib/constants/hunting";
import {
  huntAssessmentSchema,
  type HuntAssessmentInput,
} from "@/lib/validations/hunting";
import { updateHuntAssessment } from "@/lib/actions/hunting";

export function HuntAssessmentControl({
  workId,
  isRare = false,
  huntAssessedOn = null,
}: HuntAssessment & { workId: string }) {
  const router = useRouter();
  const popupId = useId();
  const [saved, setSaved] = useState({ isRare, huntAssessedOn });
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const group = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSaved({ isRare, huntAssessedOn });
  }, [isRare, huntAssessedOn]);

  function showDate() {
    const rect = toggle.current?.getBoundingClientRect();
    if (!rect) return;
    // The portal escapes hero clipping; clamp to the viewport at any zoom level.
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 144)),
    });
  }

  useEffect(() => {
    if (!position) return;
    dateInput.current?.focus();
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !group.current?.contains(target))
        setPosition(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPosition(null);
        toggle.current?.focus();
      }
    }
    function close() {
      setPosition(null);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [position]);

  function save(input: HuntAssessmentInput, revealDate = false) {
    const parsed = huntAssessmentSchema.safeParse(input);
    if (!parsed.success) {
      toast.error("Choose a valid date");
      return;
    }
    startTransition(async () => {
      try {
        const result = await updateHuntAssessment(workId, parsed.data);
        setSaved(result);
        if (revealDate) showDate();
        else setPosition(null);
        router.refresh();
      } catch {
        toast.error("Could not update the rare flag. Try again.");
      }
    });
  }

  return (
    <div ref={group} className="inline-flex items-center gap-1">
      <button
        ref={toggle}
        type="button"
        disabled={pending}
        aria-pressed={saved.isRare}
        aria-busy={pending}
        aria-label={saved.isRare ? "Unmark rare" : "Mark as rare"}
        title={
          saved.isRare
            ? `Rare · ${saved.huntAssessedOn}. Click to unmark`
            : "Mark as rare"
        }
        className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors hover:bg-bg-tertiary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-gold disabled:opacity-50 ${saved.isRare ? "text-accent-gold" : "text-fg-muted hover:text-accent-gold"}`}
        onClick={() =>
          save(
            saved.isRare
              ? { isRare: false, huntAssessedOn: null }
              : { isRare: true, huntAssessedOn: localToday() },
            !saved.isRare,
          )
        }
      >
        <Gem
          className="h-4 w-4"
          strokeWidth={1.5}
          fill={saved.isRare ? "currentColor" : "none"}
          fillOpacity={0.18}
          aria-hidden="true"
        />
      </button>
      {saved.isRare && (
        <button
          type="button"
          disabled={pending}
          onClick={() => (position ? setPosition(null) : showDate())}
          className="rounded-sm px-1 py-1 font-mono text-micro text-fg-muted hover:text-accent-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-gold"
          aria-label="Edit rare date"
          aria-expanded={!!position}
          aria-controls={position ? popupId : undefined}
          aria-haspopup="dialog"
          title="Edit date"
        >
          <time dateTime={saved.huntAssessedOn ?? undefined}>
            {saved.huntAssessedOn}
          </time>
        </button>
      )}
      {position &&
        createPortal(
          <div
            id={popupId}
            ref={popup}
            role="dialog"
            aria-label="Rare date"
            className="fixed z-[100] w-60 max-w-[calc(100vw-16px)] rounded-sm border border-glass-border bg-bg-secondary p-3 shadow-xl"
            style={position}
          >
            <div className="mb-2 flex items-center justify-between">
              <label
                htmlFor={`${popupId}-date`}
                className="text-xs text-fg-secondary"
              >
                Marked on
              </label>
              <button
                type="button"
                onClick={() => {
                  setPosition(null);
                  toggle.current?.focus();
                }}
                aria-label="Close date popup"
                className="text-fg-muted hover:text-fg-primary"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                save({
                  isRare: true,
                  huntAssessedOn: String(
                    new FormData(event.currentTarget).get("date") ?? "",
                  ),
                });
              }}
            >
              <div className="flex items-center gap-2">
                <input
                  ref={dateInput}
                  id={`${popupId}-date`}
                  name="date"
                  type="date"
                  required
                  defaultValue={saved.huntAssessedOn ?? localToday()}
                  disabled={pending}
                  className="h-8 min-w-0 flex-1 rounded-sm border border-glass-border bg-bg-primary px-2 font-mono text-xs text-fg-primary [color-scheme:dark] focus:border-accent-gold focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={pending}
                  aria-label="Save rare date"
                  title="Save date"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-accent-gold hover:bg-bg-tertiary disabled:opacity-50"
                >
                  <Check className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  save({ isRare: true, huntAssessedOn: localToday() })
                }
                className="mt-2 text-xs text-fg-muted hover:text-fg-primary"
              >
                Today
              </button>
            </form>
          </div>,
          document.body,
        )}
    </div>
  );
}
