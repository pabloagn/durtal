"use client";

import { memo, useDeferredValue, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { icons } from "lucide-react";

type IconName = keyof typeof icons;

/** Every Lucide icon, alphabetical, with its name split into words for search. */
const ALL = (Object.keys(icons) as IconName[]).map((name) => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .toLowerCase();
  return { name, words, compact: words.replace(/ /g, "") };
});

/** A first page that suits a library; names Lucide lacks are skipped. */
const SUGGESTED = (
  [
    "Library",
    "LibraryBig",
    "Book",
    "BookOpen",
    "BookMarked",
    "BookHeart",
    "BookKey",
    "BookLock",
    "Bookmark",
    "Scroll",
    "ScrollText",
    "Feather",
    "Quote",
    "Skull",
    "Ghost",
    "Flame",
    "Moon",
    "MoonStar",
    "Sparkles",
    "Star",
    "Eye",
    "Key",
    "Hourglass",
    "Crown",
    "Sword",
    "Shield",
    "Castle",
    "Church",
    "Cross",
    "Landmark",
    "Gem",
    "Rose",
    "Flower2",
    "Leaf",
    "TreePine",
    "Mountain",
    "Waves",
    "Globe",
    "Compass",
    "Anchor",
    "Music",
    "Palette",
    "Drama",
    "Brain",
    "HeartCrack",
    "Dumbbell",
    "FlaskConical",
    "Atom",
    "Telescope",
    "Scale",
    "Biohazard",
    "Syringe",
    "Wine",
    "Infinity",
    "Orbit",
    "Hexagon",
  ] as string[]
).filter((name): name is IconName => Object.hasOwn(icons, name));

export const ICON_COUNT = ALL.length;
const EVERY = ALL.map((i) => i.name);

const WORDS = new Map<string, string>(ALL.map((i) => [i.name, i.words]));
function label(name: string) {
  return WORDS.get(name) ?? name;
}

/** Icons a row: the grid's own columns, or 8 (its column count) before layout */
function columnsOf(buttons: HTMLElement[]) {
  const top = buttons[0]?.offsetTop ?? 0;
  const first = buttons.findIndex((b) => b.offsetTop !== top);
  return first > 0 ? first : Math.min(8, buttons.length) || 1;
}

/**
 * Where an arrow key, Home or End moves focus from `at` in a grid of `count`
 * icons, `columns` a row; null for any other key (SLN-1302)
 */
export function iconGridMove(key: string, at: number, count: number, columns: number): number | null {
  const rowStart = at - (at % columns);
  const next = {
    ArrowRight: at + 1,
    ArrowLeft: at - 1,
    ArrowDown: at + columns,
    ArrowUp: at - columns,
    Home: rowStart,
    End: Math.min(rowStart + columns, count) - 1,
  }[key];
  if (next === undefined) return null;
  return next < 0 || next >= count ? at : next;
}

/**
 * One choice among icons: one Tab stop (the chosen icon, else the first),
 * arrows across the rows, Enter or Space to choose (SLN-1302)
 */
const IconGrid = memo(function IconGrid({
  names,
  value,
  onPick,
  labelledBy,
}: {
  names: IconName[];
  value: string | null;
  onPick: (name: string) => void;
  labelledBy: string;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const stop = Math.max(0, names.indexOf(value as IconName));
  // Arrows move the stop without a render of every icon; a new list or choice resets it
  useLayoutEffect(() => {
    grid.current?.querySelectorAll<HTMLElement>("[role=radio]").forEach((b, i) => {
      b.tabIndex = i === stop ? 0 : -1;
    });
  }, [names, stop]);

  return (
    // On touch each icon is a 44px press, as many to a row as the panel fits
    <div
      ref={grid}
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={(e) => {
        const buttons = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")];
        const at = buttons.indexOf(e.target as HTMLElement);
        if (at < 0) return;
        const next = iconGridMove(e.key, at, buttons.length, columnsOf(buttons));
        if (next === null) return;
        e.preventDefault();
        buttons[at].tabIndex = -1;
        buttons[next].tabIndex = 0;
        buttons[next].focus();
      }}
      className="grid grid-cols-8 gap-0.5 pointer-coarse:grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]"
    >
      {names.map((name, i) => {
        const Icon = icons[name];
        const selected = name === value;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === stop ? 0 : -1}
            onClick={() => onPick(name)}
            data-tooltip={label(name)}
            aria-label={label(name)}
            className={`flex h-9 w-9 items-center pointer-coarse:h-11 pointer-coarse:w-full justify-center rounded-sm transition-colors hover:bg-bg-tertiary hover:text-fg-primary ${selected ? "bg-bg-tertiary text-fg-primary ring-1 ring-accent-primary/60" : "text-fg-secondary"}`}
          >
            <Icon
              className="h-[18px] w-[18px]"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
});

/**
 * The icon picker's panel: search, suggestions, then every Lucide icon.
 * It imports the whole icon set, so load it lazily.
 */
export default function IconPickerPanel({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (name: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => input.current?.focus(), []);

  const tokens = deferred
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);
  const joined = tokens.join("");
  const results = tokens.length
    ? ALL.filter((i) => tokens.every((t) => i.compact.includes(t)))
        // Names that start with the query first, each part alphabetical
        .sort(
          (a, b) =>
            Number(b.compact.startsWith(joined)) -
            Number(a.compact.startsWith(joined)),
        )
        .map((i) => i.name)
    : null;

  return (
    <div className="flex max-h-[min(440px,calc(100vh-16px))] flex-col">
      <div className="flex items-center gap-2 border-b border-glass-border p-2">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results?.length) {
              e.preventDefault();
              onPick(results[0]);
            }
          }}
          placeholder={`Search ${ICON_COUNT.toLocaleString("en")} icons`}
          aria-label="Search icons"
          className="h-8 pointer-coarse:h-11 min-w-0 flex-1 rounded-sm border border-glass-border bg-bg-primary px-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-primary focus:outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="shrink-0 rounded-sm px-2 py-1 text-xs text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:min-h-11"
          >
            Remove
          </button>
        )}
      </div>
      {/* Not a Tab stop of its own (Firefox makes a scroller one): focus moving through the grids scrolls it */}
      <div tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto p-2">
        {/* One polite line, there before its text changes: the match count or no match. Empty, it takes no room but stays in the accessibility tree, so its first text is announced */}
        <p
          id={`${id}-results`}
          role="status"
          className={results && !results.length ? "py-8 text-center text-sm text-fg-secondary" : "type-caption mb-1.5 px-1 empty:mb-0"}
        >
          {results
            ? results.length
              ? `${results.length} ${results.length === 1 ? "icon" : "icons"}`
              : `No icons match “${deferred.trim()}”`
            : ""}
        </p>
        {results ? (
          results.length > 0 && (
            <IconGrid names={results} value={value} onPick={onPick} labelledBy={`${id}-results`} />
          )
        ) : (
          <>
            <p id={`${id}-suggested`} className="type-caption mb-1.5 px-1">
              Suggested
            </p>
            <IconGrid names={SUGGESTED} value={value} onPick={onPick} labelledBy={`${id}-suggested`} />
            <p id={`${id}-all`} className="type-caption mb-1.5 mt-4 px-1">
              All icons
            </p>
            <IconGrid
              names={EVERY}
              value={value}
              onPick={onPick}
              labelledBy={`${id}-all`}
            />
          </>
        )}
      </div>
    </div>
  );
}
