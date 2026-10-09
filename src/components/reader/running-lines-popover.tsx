"use client";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { Select } from "@/components/ui/select";
import {
  DEFAULT_RUNNING_POSITIONS,
  RUNNING_ITEMS,
  RUNNING_POSITIONS,
  type RunningPositions,
  type RunningPosition,
} from "@/lib/reader/running-lines";
const labels = {
  chapter: "Chapter",
  page: "Page",
  location: "Location",
  percent: "Percent",
  timeLeftChapter: "Time left in chapter",
  timeLeftBook: "Time left in book",
  clock: "Clock",
};
const positions = {
  off: "Off",
  headerLeft: "Header left",
  headerRight: "Header right",
  footerLeft: "Footer left",
  footerRight: "Footer right",
};
export function RunningLinesPopover({
  open,
  onClose,
  value,
  onChange,
  available,
}: {
  open: boolean;
  onClose(): void;
  value: RunningPositions;
  onChange(value: RunningPositions): void;
  available: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const title = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const popup = ref.current;
    if (!open || !popup) return;
    const origin = document.activeElement as HTMLElement | null;
    popup.showPopover();
    popup.querySelector<HTMLElement>('[role="combobox"]')?.focus();
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !popup.querySelector('[role="listbox"]')
      ) {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      popup.hidePopover();
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <div
      ref={ref}
      popover="auto"
      role="dialog"
      aria-labelledby={title}
      data-reader-chrome
      data-reader-widget
      data-reader-running-lines
      data-open={open}
      onToggle={(event) => {
        if ((event.nativeEvent as ToggleEvent).newState === "closed" && open)
          close.current();
      }}
      className="glass fixed inset-auto bottom-24 right-4 m-0 max-h-[calc(100dvh-160px)] w-[360px] max-w-[calc(100vw-32px)] overflow-hidden p-4 text-fg-primary"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id={title} className="type-item-title">
          Header and footer
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-tooltip="Close"
          data-tooltip-keys="esc"
          className="action-icon-sm"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="max-h-[calc(100dvh-232px)] space-y-4 overflow-y-auto overscroll-contain">
        <p className="text-sm text-fg-secondary">
          Locations stay the same at every text size. Print pages come from this
          edition.
        </p>
        {!available && (
          <p className="text-sm text-fg-secondary">
            Running lines appear in paginated, reflowable books. The bottom bar
            remains available here.
          </p>
        )}
        {RUNNING_ITEMS.map((item) => (
          <label
            key={item}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span>{labels[item]}</span>
            <Select
              ariaLabel={labels[item]}
              value={value[item]}
              onChange={(event) =>
                onChange({
                  ...value,
                  [item]: event.target.value as RunningPosition,
                })
              }
              options={RUNNING_POSITIONS.map((position) => ({
                value: position,
                label: positions[position],
              }))}
              className="w-40"
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_RUNNING_POSITIONS })}
          className="min-h-8 rounded-sm px-2 text-sm hover:bg-bg-tertiary pointer-coarse:min-h-11"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
