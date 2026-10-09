"use client";
import { useId, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { GoToTarget } from "@/lib/reader/engine";
import { chapterQuery, parseGoTo, type GoToMode } from "@/lib/reader/goto";
import type { PositionIndex } from "@/lib/reader/position-index";

export function GoToDialog({
  open,
  onClose,
  index,
  onGo,
  initialMode,
  onModeChange,
}: {
  open: boolean;
  onClose(): void;
  index: PositionIndex;
  onGo(target: GoToTarget): Promise<boolean>;
  initialMode?: GoToMode | null;
  onModeChange?(mode: GoToMode): void;
}) {
  const [mode, setMode] = useState<GoToMode>(
    initialMode ?? (index.pages.length ? "page" : "location"),
  );
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeChapter, setActiveChapter] = useState(0);
  const id = useId();
  const modeId = useId();
  const label = {
    page: "Page",
    location: "Location",
    percent: "Percent",
    chapter: "Chapter",
  }[mode];
  const matches = index.chapters.filter((item) =>
    chapterQuery(item.label).includes(chapterQuery(text)),
  );
  const placeholder =
    mode === "page"
      ? index.pages[0]?.label + " to " + index.pages.at(-1)?.label
      : mode === "location"
        ? "1 to " + index.info.locationCount.toLocaleString()
        : mode === "percent"
          ? "0 to 100%"
          : "Filter chapters";
  const go = async (target: GoToTarget) => {
    setBusy(true);
    try {
      if (await onGo(target)) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Go to"
      className="max-w-lg"
      expandable={false}
    >
      <form
        data-reader-widget
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const result =
            mode === "chapter" && matches[activeChapter]
              ? { target: { href: matches[activeChapter].href } }
              : parseGoTo(mode, text, index);
          if (result.error) {
            setError(result.error);
            return;
          }
          setError(null);
          void go(result.target!);
        }}
      >
        <span id={modeId} className="sr-only">
          Go to mode
        </span>
        <SegmentedControl
          ariaLabelledby={modeId}
          value={mode}
          options={[
            ...(index.pages.length ? [{ value: "page", label: "Page" }] : []),
            { value: "location", label: "Location" },
            { value: "percent", label: "Percent" },
            { value: "chapter", label: "Chapter" },
          ]}
          onChange={(value) => {
            setMode(value as GoToMode);
            onModeChange?.(value as GoToMode);
            setText("");
            setError(null);
            setActiveChapter(0);
          }}
        />
        <label id={id} htmlFor={id + "-input"} className="type-label">
          {label}
        </label>
        <input
          id={id + "-input"}
          autoFocus
          value={text}
          placeholder={placeholder}
          role={mode === "chapter" ? "combobox" : undefined}
          aria-expanded={mode === "chapter" ? true : undefined}
          aria-controls={mode === "chapter" ? id + "-chapters" : undefined}
          aria-activedescendant={
            mode === "chapter" && matches.length
              ? id + "-chapter-" + activeChapter
              : undefined
          }
          onKeyDown={(event) => {
            if (
              mode !== "chapter" ||
              !["ArrowUp", "ArrowDown"].includes(event.key)
            )
              return;
            event.preventDefault();
            const next = Math.max(
              0,
              Math.min(
                matches.length - 1,
                activeChapter + (event.key === "ArrowDown" ? 1 : -1),
              ),
            );
            setActiveChapter(next);
            document
              .getElementById(id + "-chapter-" + next)
              ?.scrollIntoView({ block: "nearest" });
          }}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
            setActiveChapter(0);
          }}
          aria-invalid={!!error}
          aria-describedby={error ? id + "-error" : undefined}
          inputMode={
            mode === "location"
              ? "numeric"
              : mode === "percent"
                ? "decimal"
                : "text"
          }
          className="h-10 rounded-sm border border-border-primary bg-bg-secondary px-3 text-sm outline-none focus:border-accent-primary pointer-coarse:h-11"
        />
        {error && (
          <p
            id={id + "-error"}
            role="alert"
            className="text-sm text-accent-red-text"
          >
            {error}
          </p>
        )}
        {mode === "chapter" && (
          <ul
            id={id + "-chapters"}
            role="listbox"
            aria-label="Chapters"
            className="max-h-72 overflow-y-auto overscroll-contain"
          >
            {matches.map((item, at) => (
              <li key={item.href + at} role="presentation">
                <button
                  id={id + "-chapter-" + at}
                  role="option"
                  aria-selected={at === activeChapter}
                  type="button"
                  disabled={busy}
                  onClick={() => void go({ href: item.href })}
                  className={
                    "flex min-h-8 w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left text-sm hover:bg-bg-tertiary pointer-coarse:min-h-11 " +
                    (at === activeChapter ? "bg-bg-tertiary" : "")
                  }
                  style={{
                    contentVisibility: "auto",
                    containIntrinsicSize: "auto 44px",
                  }}
                >
                  <span className="lines-2">{item.label}</span>
                  <span className="shrink-0 text-xs tabular-nums">
                    {index.positionLabel(item.fraction)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? "Opening" : "Go"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
