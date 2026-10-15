"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DurtalLocator, ReaderEngine } from "@/lib/reader/engine";
import { queryRuns, type SearchOptions } from "@/lib/reader/search/fold";
import {
  readSearchOptions,
  writeSearchOptions,
} from "@/lib/reader/search/preferences";
import type { SearchHit } from "@/lib/reader/search/types";
import type { PositionIndex } from "@/lib/reader/position-index";
import { pageWords } from "@/lib/reader/place-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ReaderSidePanel } from "./side-panel";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const OPTIONS = [
  ["wholeWords", "Whole words"],
  ["matchCase", "Match case"],
  ["matchAccents", "Match accents"],
] as const;

type Status = "idle" | "searching" | "done" | "stopped" | "capped" | "error";
/** The empty result names the query, and the options that narrow it */
function noMatches(query: string, options: SearchOptions) {
  const on = OPTIONS
    .filter(([key]) => options[key])
    .map(([, label]) => label);
  const named = query.trim() ? `No matches for “${query.trim()}”.` : "No matches.";
  if (!on.length) return named;
  const list = on.length === 1 ? on[0] : `${on.slice(0, -1).join(", ")} and ${on.at(-1)}`;
  return `${named} ${list} ${on.length === 1 ? "is" : "are"} on; turning ${on.length === 1 ? "it" : "them"} off may find more.`;
}

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
  places,
  escapeRef,
  onDockHeight,
}: {
  open: boolean;
  engine: ReaderEngine;
  language: string | null;
  /** Names each hit's place as the bar names it (SLN-680) */
  places?: PositionIndex | null;
  onClose(): void;
  onOpen(): void;
  onJump(locator: DurtalLocator, hit: SearchHit): Promise<unknown>;
  /** The reader's Esc, once the panel is closed: true when it ended the search */
  escapeRef?: MutableRefObject<(() => boolean) | null>;
  /** The results bar's height while it stands in the bottom bar's place, else 0 */
  onDockHeight?(height: number): void;
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
  const [ran, setRan] = useState<{ query: string; options: SearchOptions }>({ query: "", options });
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const ids = useId();
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
        .filter((hit) => hit.locator.cfi || hit.locator.pdf?.rects?.length)
        .map((hit) => ({
          id: hit.id, locator: hit.locator, color: "link",
          style: "outline" as const, current: hit.id === active,
        })),
    );
  }, [engine, sorted, active]);

  const pick = useCallback(
    async (hit: SearchHit) => {
      const owner = sequence.current;
      // An EPUB jump focuses the passage in the book: give focus back to the
      // field or Next, so the next Enter steps on to the next match
      const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const keep = (within: Element | null) => {
        if (!origin?.isConnected || !within?.contains(origin) || document.activeElement === origin) return;
        // Only focus the jump took into the book: a panel opened meanwhile keeps it
        if (!document.getElementById("reader-book")?.contains(document.activeElement)) return;
        // Firefox ignores focus() here while the book's frame holds the focus
        window.focus();
        origin.focus({ preventScroll: true });
      };
      setActive(hit.id);
      setFocused(hit.id);
      await onJumpRef.current(hit.locator, hit);
      if (owner !== sequence.current) return;
      if (!matchMedia("(min-width: 1024px)").matches) {
        // The panel closes onto the hit (focus back on its opener); the
        // results bar stays
        onClose();
        keep(bar.current);
        return;
      }
      // On a wide screen the panel stays open and the book stands beside it,
      // so no hit is ever under it (SLN-728)
      keep(origin?.closest("[data-reader-search], [data-reader-search-bar]") ?? null);
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
    setRan({ query: nextQuery, options: nextOptions });
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
  // Esc closes the panel first (the reader does that), then the search
  const barShown = !open && engaged && hits.length > 0;
  useEffect(() => {
    if (!escapeRef) return;
    escapeRef.current = () => {
      if (!barShown) return false;
      end();
      return true;
    };
    return () => {
      escapeRef.current = null;
    };
  });
  // The results bar takes the bottom bar's place, in the margin below the
  // text, so it never covers a line of the book (SLN-727)
  const onDockHeightRef = useRef(onDockHeight);
  useEffect(() => {
    onDockHeightRef.current = onDockHeight;
  }, [onDockHeight]);
  useEffect(() => {
    const element = bar.current;
    if (!barShown || !element) return;
    const report = () => onDockHeightRef.current?.(element.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      onDockHeightRef.current?.(0);
    };
  }, [barShown]);
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
                : noMatches(ran.query, ran.options);
  return (
    <>
      <ReaderSidePanel open={open} title="Search in book" onClose={onClose}>
        <div className="space-y-3 px-2" data-reader-search data-reader-widget>
          <form
            className="flex items-start gap-2"
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
            <div className="min-w-0 flex-1">
              <Input
                ref={input}
                type="search"
                aria-label="Search in book"
                placeholder="Words or a phrase"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="[&::-webkit-search-cancel-button]:appearance-none"
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
                // Always a suffix, so the field is never remounted (and
                // never loses focus) when the clear button comes and goes
                suffix={
                  <>
                    {query && (
                      <button
                        type="button"
                        aria-label="Clear search"
                        data-tooltip="Clear"
                        className="action-icon-sm"
                        onClick={() => {
                          setQuery("");
                          input.current?.focus();
                        }}
                      >
                        <X className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                    )}
                  </>
                }
              />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          <div role="group" aria-label="Search options" className="flex flex-col gap-2">
            {OPTIONS.map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <Switch
                  id={`${ids}-${key}`}
                  checked={options[key]}
                  aria-labelledby={`${ids}-${key}-label`}
                  onCheckedChange={(checked) => {
                    const nextOptions = { ...options, [key]: checked };
                    setOptions(nextOptions);
                    writeSearchOptions(storage(), nextOptions);
                    start(query, nextOptions);
                  }}
                />
                <label
                  id={`${ids}-${key}-label`}
                  htmlFor={`${ids}-${key}`}
                  className="flex cursor-pointer items-center text-sm pointer-coarse:min-h-11"
                >
                  {label}
                </label>
              </div>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs text-fg-secondary">
            <p role="status" aria-live="polite">
              {statusText}
            </p>
            {status === "searching" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-mr-2.5 shrink-0"
                onClick={() => {
                  run.current?.abort.abort();
                  pendingJump.current = false;
                  setStatus("stopped");
                }}
              >
                Stop
              </Button>
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
                      {places
                        ? places.locatorLabel(hit.locator)
                        : hit.locator.pageLabel
                          ? pageWords(hit.locator.pageLabel, undefined)
                          : `Location ${hit.locator.position ?? 1}`}
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {limit < sorted.length && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setLimit((value) => value + 200)}
              >
                Show 200 more
              </Button>
            )}
          </div>
        </div>
      </ReaderSidePanel>
      {barShown && (
        <div
          ref={bar}
          data-reader-chrome
          data-reader-widget
          data-reader-search-bar
          className="glass-bar fixed inset-x-0 bottom-0 z-30 border-t border-glass-border pb-[env(safe-area-inset-bottom)]"
        >
          <div
            role="toolbar"
            aria-label="Search results"
            className="flex h-9 items-center justify-center gap-1 px-2 text-sm pointer-coarse:h-11"
          >
            <button
              type="button"
              aria-label="Previous match"
              data-tooltip="Previous match"
              className="action-icon-sm"
              onClick={() => next(-1)}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <span className="whitespace-nowrap px-1 tabular-nums">
              {Math.max(0, current + 1)} of {hits.length}
            </span>
            <button
              type="button"
              aria-label="Next match"
              data-tooltip="Next match"
              className="action-icon-sm"
              onClick={() => next(1)}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
            <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
              Results
            </Button>
            <button
              type="button"
              aria-label="Close search"
              data-tooltip="Close search"
              data-tooltip-keys="esc"
              className="action-icon-sm"
              onClick={end}
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
