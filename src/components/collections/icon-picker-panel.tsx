"use client";

import { memo, useDeferredValue, useEffect, useRef, useState } from "react";
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

const WORDS = new Map<string, string>(ALL.map((i) => [i.name, i.words]));
function label(name: string) {
  return WORDS.get(name) ?? name;
}

const IconGrid = memo(function IconGrid({
  names,
  value,
  onPick,
}: {
  names: IconName[];
  value: string | null;
  onPick: (name: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {names.map((name) => {
        const Icon = icons[name];
        const selected = name === value;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            title={label(name)}
            aria-label={label(name)}
            aria-pressed={selected}
            className={`flex h-9 w-9 items-center justify-center rounded-sm transition-colors hover:bg-bg-tertiary hover:text-fg-primary ${selected ? "bg-bg-tertiary text-fg-primary ring-1 ring-accent-rose/60" : "text-fg-secondary"}`}
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
          className="h-8 min-w-0 flex-1 rounded-sm border border-glass-border bg-bg-primary px-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
        />
        {value && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="shrink-0 rounded-sm px-2 py-1 text-xs text-fg-muted hover:bg-bg-tertiary hover:text-fg-primary"
          >
            Remove
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {results ? (
          results.length ? (
            <>
              <p className="mb-1.5 px-1 text-micro uppercase tracking-wider text-fg-muted">
                {results.length} {results.length === 1 ? "icon" : "icons"}
              </p>
              <IconGrid names={results} value={value} onPick={onPick} />
            </>
          ) : (
            <p className="py-8 text-center text-sm text-fg-muted">
              No icons match “{deferred.trim()}”
            </p>
          )
        ) : (
          <>
            <p className="mb-1.5 px-1 text-micro uppercase tracking-wider text-fg-muted">
              Suggested
            </p>
            <IconGrid names={SUGGESTED} value={value} onPick={onPick} />
            <p className="mb-1.5 mt-4 px-1 text-micro uppercase tracking-wider text-fg-muted">
              All icons
            </p>
            <IconGrid
              names={ALL.map((i) => i.name)}
              value={value}
              onPick={onPick}
            />
          </>
        )}
      </div>
    </div>
  );
}
