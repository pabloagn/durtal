"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

interface DatePickerProps {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  required?: boolean;
  min?: string;
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
  placeholder = "YYYY-MM-DD",
  id,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = value ? new Date(value + "T00:00:00") : undefined;
  const minDate = min ? new Date(min + "T00:00:00") : undefined;

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
      setOpen(false);
    },
    [onChange],
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs font-medium text-fg-secondary"
        >
          {label}
          {required && <span className="ml-0.5 text-accent-red">*</span>}
        </label>
      )}

      <div className="relative">
        <button
          type="button"
          id={id}
          onClick={() => setOpen((prev) => !prev)}
          className={`flex h-8 w-full items-center justify-between rounded-sm border border-glass-border bg-bg-primary/80 px-3 text-left text-sm transition-all duration-150 focus:border-accent-rose focus:outline-none focus:glass-input-focus ${
            error ? "border-accent-red" : ""
          } ${open ? "border-accent-rose" : ""}`}
        >
          <span className={value ? "text-fg-primary" : "text-fg-muted"}>
            {value || placeholder}
          </span>
          <CalendarDays
            className="h-3.5 w-3.5 text-fg-muted"
            strokeWidth={1.5}
          />
        </button>

        {open && (
          <div className="absolute z-50 mt-1 rounded-sm border border-glass-border bg-bg-secondary shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]">
            <DayPicker
              mode="single"
              selected={selected}
              onSelect={handleSelect}
              disabled={minDate ? { before: minDate } : undefined}
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
                  "w-8 text-center font-mono text-micro text-fg-muted uppercase",
                week: "flex",
                day: "p-0",
                day_button:
                  "flex h-8 w-8 items-center justify-center rounded-sm text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary",
                selected:
                  "!bg-accent-rose/20 !text-fg-primary font-medium",
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
                  className="text-xs text-fg-muted transition-colors hover:text-fg-secondary"
                >
                  Clear date
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-accent-red">{error}</p>}
    </div>
  );
}
