"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DurtalLocator, ReaderEngine } from "@/lib/reader/engine";
import { queryRuns, type SearchOptions } from "@/lib/reader/search/fold";
import {
  readSearchOptions,
  writeSearchOptions,
} from "@/lib/reader/search/preferences";
import type { SearchHit } from "@/lib/reader/search/types";
import { ReaderSidePanel } from "./side-panel";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
type Status = "idle" | "searching" | "done" | "stopped" | "capped" | "error";
const order = (a: SearchHit, b: SearchHit) =>
  a.locator.sectionIndex - b.locator.sectionIndex || a.start - b.start;

/** Stays mounted when a narrow viewport jumps, retaining the worker, query and result bar. */
export function SearchPanel({
  open,
  engine,
  language,
  onClose,
  onOpen,
  onJump,
}: {
  open: boolean;
  engine: ReaderEngine;
  language: string | null;
  onClose(): void;
  onOpen(): void;
  onJump(locator: DurtalLocator, hit: SearchHit): Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SearchOptions>(() =>
    readSearchOptions(storage()),
  );
  const [hits, setHits] = useState<SearchHit[]>([]);
  const hitsRef = useRef<SearchHit[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [limit, setLimit] = useState(200);
  const [engaged, setEngaged] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const run = useRef<{ id: number; abort: AbortController } | null>(null);
  const sequence = useRef(0);
  const pendingJump = useRef(false);
  const executed = useRef("");
  const sorted = useMemo(() => [...hits].sort(order), [hits]);
  const current = sorted.findIndex((hit) => hit.id === active);
  const onJumpRef = useRef(onJump);
  useEffect(() => {
    onJumpRef.current = onJump;
  }, [onJump]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(
    () => () => {
      run.current?.abort.abort();
      engine.setDecorations("search", []);
    },
    [engine],
  );
  useEffect(() => {
    engine.setDecorations(
      "search",
      sorted
        .filter((hit) => hit.locator.cfi)
        .map((hit) => ({
          cfi: hit.locator.cfi!,
          color: "link",
          current: hit.id === active,
        })),
    );
  }, [engine, sorted, active]);

  const pick = useCallback(
    async (hit: SearchHit) => {
      const owner = sequence.current;
      setActive(hit.id);
      setFocused(hit.id);
      await onJumpRef.current(hit.locator, hit);
      if (
        owner === sequence.current &&
        !matchMedia("(min-width: 1024px)").matches
      )
        onClose();
    },
    [onClose],
  );
  const next = (direction: -1 | 1) => {
    if (!sorted.length) return;
    const at =
      current < 0
        ? direction > 0
          ? 0
          : sorted.length - 1
        : (current + direction + sorted.length) % sorted.length;
    void pick(sorted[at]);
  };
  const start = (nextQuery = query, nextOptions = options, jump = false) => {
    run.current?.abort.abort();
    const id = ++sequence.current;
    const abort = new AbortController();
    run.current = { id, abort };
    const key = JSON.stringify([nextQuery, nextOptions]);
    executed.current = key;
    pendingJump.current = jump;
    hitsRef.current = [];
    setHits([]);
    setActive(null);
    setFocused(null);
    setLimit(200);
    setProgress(0);
    setError("");
    setEngaged(true);
    if (!queryRuns(nextQuery, language)) {
      setStatus("idle");
      return;
    }
    if (!engine.search) {
      setStatus("error");
      setError("Search is unavailable for this file.");
      return;
    }
    setStatus("searching");
    const origin = engine.currentLocator();
    void (async () => {
      try {
        for await (const update of engine.search!({
          query: nextQuery,
          options: nextOptions,
          signal: abort.signal,
          startSection: origin?.sectionIndex,
        })) {
          if (abort.signal.aborted || run.current?.id !== id) return;
          if (update.kind === "hits") {
            const merged = [...hitsRef.current, ...update.hits];
            hitsRef.current = merged;
            setHits(merged);
            if (pendingJump.current) {
              const first = update.hits.find(
                (hit) =>
                  !origin ||
                  hit.locator.sectionIndex !== origin.sectionIndex ||
                  hit.locator.progression >= origin.progression,
              );
              if (first) {
                pendingJump.current = false;
                void pick(first);
              }
            }
          } else if (update.kind === "progress")
            setProgress(update.completed / Math.max(1, update.total));
          else {
            setProgress(1);
            setStatus(update.capped ? "capped" : "done");
            if (pendingJump.current && hitsRef.current[0]) {
              pendingJump.current = false;
              void pick(hitsRef.current[0]);
            }
          }
        }
      } catch (failure) {
        if (abort.signal.aborted || run.current?.id !== id) return;
        setError(failure instanceof Error ? failure.message : "Search failed.");
        setStatus("error");
      }
    })();
  };
  const end = () => {
    run.current?.abort.abort();
    ++sequence.current;
    pendingJump.current = false;
    hitsRef.current = [];
    setHits([]);
    setEngaged(false);
    setActive(null);
    setStatus("idle");
    engine.setDecorations("search", []);
    onClose();
  };
  const shown = sorted.slice(0, limit);
  const groups = new Map<number, SearchHit[]>();
  for (const hit of shown) {
    const index = hit.locator.sectionIndex;
    const group = groups.get(index) ?? [];
    group.push(hit);
    groups.set(index, group);
  }
  const statusText =
    status === "searching"
      ? `Searching… ${Math.round(progress * 100)}%`
      : status === "capped"
        ? "Stopped at 5,000 matches — narrow the search."
        : status === "error"
          ? error
          : status === "idle"
            ? `Enter ${/^(zh|ja|ko)(-|$)/i.test(language ?? "") ? "a character" : "at least two characters"}.`
            : status === "stopped"
              ? `Stopped. ${hits.length} matches.`
              : hits.length
                ? `${hits.length} matches in ${new Set(hits.map((hit) => hit.locator.sectionIndex)).size} chapters`
                : "No matches";
  return (
    <>
      <ReaderSidePanel open={open} title="Search in book" onClose={end}>
        <div className="space-y-3 px-2" data-reader-search data-reader-widget>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                executed.current === JSON.stringify([query, options]) &&
                hits.length
              )
                next(1);
              else start(query, options, true);
            }}
          >
            <input
              ref={input}
              type="search"
              aria-label="Search in book"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-sm border border-glass-border bg-bg-primary/40 px-3 py-2 text-sm outline-none focus:border-accent-blue-text"
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.shiftKey && hits.length) {
                  event.preventDefault();
                  next(-1);
                }
                if (event.key === "ArrowDown" && shown.length) {
                  event.preventDefault();
                  const hit =
                    shown.find((item) => item.id === active) ?? shown[0];
                  setFocused(hit.id);
                  list.current
                    ?.querySelector<HTMLButtonElement>(`[data-hit="${hit.id}"]`)
                    ?.focus();
                }
              }}
            />
            <button
              type="submit"
              className="mt-2 min-h-8 text-sm text-accent-blue-text pointer-coarse:min-h-11"
            >
              Search
            </button>
          </form>
          <div className="flex flex-wrap gap-x-3 text-xs text-fg-secondary">
            {(
              [
                ["wholeWords", "Whole words"],
                ["matchCase", "Match case"],
                ["matchAccents", "Match accents"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex min-h-8 items-center gap-1.5 pointer-coarse:min-h-11"
              >
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(event) => {
                    const nextOptions = {
                      ...options,
                      [key]: event.target.checked,
                    };
                    setOptions(nextOptions);
                    writeSearchOptions(storage(), nextOptions);
                    start(query, nextOptions);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs text-fg-secondary">
            <p role="status" aria-live="polite">
              {statusText}
            </p>
            {status === "searching" && (
              <button
                type="button"
                className="min-h-8 text-accent-blue-text pointer-coarse:min-h-11"
                onClick={() => {
                  run.current?.abort.abort();
                  pendingJump.current = false;
                  setStatus("stopped");
                }}
              >
                Stop
              </button>
            )}
          </div>
          {status === "searching" && (
            <div
              className="h-0.5 bg-bg-tertiary"
              role="progressbar"
              aria-label="Search progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <div
                className="h-full bg-accent-blue-text"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          <div
            ref={list}
            aria-label="Search results"
            onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
              event.preventDefault();
              const index = shown.findIndex((hit) => hit.id === focused);
              const hit =
                shown[
                  Math.max(
                    0,
                    Math.min(
                      shown.length - 1,
                      index + (event.key === "ArrowDown" ? 1 : -1),
                    ),
                  )
                ];
              if (!hit) return;
              setFocused(hit.id);
              list.current
                ?.querySelector<HTMLButtonElement>(`[data-hit="${hit.id}"]`)
                ?.focus();
            }}
          >
            {[...groups].map(([index, group]) => (
              <section key={index}>
                <h3 className="type-caption mt-4 px-2 text-fg-secondary">
                  {group[0].sectionLabel}
                  {!group[0].linear && " · Notes"}
                </h3>
                {group.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    data-hit={hit.id}
                    tabIndex={hit.id === (focused ?? shown[0]?.id) ? 0 : -1}
                    aria-current={hit.id === active ? "location" : undefined}
                    onFocus={() => setFocused(hit.id)}
                    onClick={() => void pick(hit)}
                    className={`my-1 block min-h-8 w-full border-l-2 px-2 py-2 text-left text-sm outline-none hover:bg-bg-tertiary/40 focus:bg-bg-tertiary/40 pointer-coarse:min-h-11 ${hit.id === active ? "border-accent-red-text bg-bg-tertiary/40" : "border-transparent"}`}
                  >
                    <span className="line-clamp-2">
                      {hit.excerpt.before}
                      <mark className="bg-accent-blue-text/35 text-fg-primary">
                        {hit.excerpt.match}
                      </mark>
                      {hit.excerpt.after}
                    </span>
                    <span className="mt-1 block text-xs text-fg-secondary">
                      {hit.inNote && "Note · "}
                      {hit.locator.pageLabel
                        ? `Page ${hit.locator.pageLabel}`
                        : `Location ${hit.locator.position ?? 1}`}
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {limit < sorted.length && (
              <button
                type="button"
                className="min-h-8 px-2 text-sm text-accent-blue-text pointer-coarse:min-h-11"
                onClick={() => setLimit((value) => value + 200)}
              >
                Show 200 more
              </button>
            )}
          </div>
        </div>
      </ReaderSidePanel>
      {!open && engaged && hits.length > 0 && (
        <div
          data-reader-chrome
          data-reader-widget
          className="glass-bar fixed inset-x-4 bottom-20 z-30 flex items-center justify-center gap-2 rounded-sm border border-glass-border px-2 py-1 text-sm"
        >
          <button
            type="button"
            aria-label="Previous match"
            className="action-icon-sm"
            onClick={() => next(-1)}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <span>
            {Math.max(0, current + 1)} of {hits.length}
          </span>
          <button
            type="button"
            aria-label="Next match"
            className="action-icon-sm"
            onClick={() => next(1)}
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="min-h-8 px-2 text-accent-blue-text pointer-coarse:min-h-11"
            onClick={onOpen}
          >
            Results
          </button>
          <button
            type="button"
            aria-label="Close search"
            className="action-icon-sm"
            onClick={end}
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </>
  );
}
