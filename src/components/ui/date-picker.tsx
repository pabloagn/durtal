"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId } from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { acquireSurface } from "@/lib/ui/surface-state";

interface DatePickerProps {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  required?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  id?: string;
}

export function DatePicker({
  label,
  value,
  onChange,
  error,
  required,
  min,
  max,
  placeholder = "YYYY-MM-DD",
  id,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  // The label names the field even when the caller passes no id (SLN-932)
  const ownId = useId();
  const fieldId = id ?? ownId;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeCalendar = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const selected = value ? new Date(value + "T00:00:00") : undefined;
  const minDate = min ? new Date(min + "T00:00:00") : undefined;
  const maxDate = max ? new Date(max + "T00:00:00") : undefined;

  const handleSelect = useCallback(
    (day: Date | undefined) => {
      if (!day) {
        onChange?.("");
      } else {
        const y = day.getFullYear();
        const m = String(day.getMonth() + 1).padStart(2, "0");
        const d = String(day.getDate()).padStart(2, "0");
        onChange?.(`${y}-${m}-${d}`);
      }
      closeCalendar();
    },
    [onChange, closeCalendar],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // A calendar is a child surface, even inside a dialog with its own guard.
  // The shared Escape owner closes this layer before it can reach the parent.
  useLayoutEffect(() => {
    if (!open) return;
    const lease = acquireSurface(closeCalendar);
    return () => lease.release();
  }, [open, closeCalendar]);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      {label && (
        <label
          htmlFor={fieldId}
          className="type-label block"
        >
          {label}
          {required && <span className="ml-0.5 text-accent-red-text">*</span>}
        </label>
      )}

      <div className="relative">
        <button
          type="button"
          ref={triggerRef}
          id={fieldId}
          // The chosen day is a draft's state (SLN-631): a dialog asks before losing it
          data-draft-value={value ?? ""}
          onClick={() => open ? closeCalendar() : setOpen(true)}
          className={`flex h-8 w-full items-center justify-between rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-left text-xs transition-all duration-150 focus:border-accent-primary focus:outline-none focus:glass-input-focus pointer-coarse:h-11 pointer-coarse:text-sm ${
            error ? "border-accent-red" : ""
          } ${open ? "border-accent-primary" : ""}`}
        >
          {/* One line: a narrow field would break "YYYY-MM-DD" at its hyphens, off the icon's line */}
          <span className={`min-w-0 truncate ${value ? "text-fg-primary" : "text-fg-secondary"}`}>
            {value || placeholder}
          </span>
          <CalendarDays
            className="h-3.5 w-3.5 shrink-0 text-fg-muted"
            strokeWidth={1.5}
          />
        </button>

        {open && (
          <div className="glass absolute z-50 mt-1">
            <DayPicker
              mode="single"
              selected={selected}
              onSelect={handleSelect}
              disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
              defaultMonth={selected ?? new Date()}
              showOutsideDays
              classNames={{
                root: "p-3",
                months: "flex flex-col",
                month_caption:
                  "flex items-center justify-center font-serif text-sm text-fg-primary mb-2",
                nav: "flex items-center justify-between absolute top-3 left-3 right-3",
                button_previous:
                  "rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary",
                button_next:
                  "rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary",
                weekdays: "flex",
                weekday:
                  "w-8 text-center font-mono text-micro text-fg-secondary uppercase",
                week: "flex",
                day: "p-0",
                day_button:
                  "flex h-8 w-8 items-center justify-center rounded-sm text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary",
                selected:
                  "!bg-accent-primary/20 !text-fg-primary font-medium",
                today: "font-bold text-accent-gold",
                outside: "text-fg-muted/30",
                disabled: "text-fg-muted/20 cursor-not-allowed hover:bg-transparent",
                hidden: "invisible",
              }}
              components={{
                Chevron: ({ orientation }) =>
                  orientation === "left" ? (
                    <ChevronLeft
                      className="h-4 w-4"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <ChevronRight
                      className="h-4 w-4"
                      strokeWidth={1.5}
                    />
                  ),
              }}
            />
            {value && (
              <div className="border-t border-glass-border px-3 py-2">
                <button
                  type="button"
                  onClick={() => handleSelect(undefined)}
                  className="text-xs text-fg-secondary transition-colors hover:text-fg-primary"
                >
                  Clear date
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-accent-red-text">{error}</p>}
    </div>
  );
}
