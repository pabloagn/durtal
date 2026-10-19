"use client";

import { useId, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { searchScore } from "@/lib/utils/search-text";

export interface ParentChoice {
  id: string;
  name: string;
  parentId?: string | null;
}

/** Choices shown at once: the list never scrolls inside its dialog */
const SHOWN = 8;
const TOP = "";

/** Each item's path from the top: "Fiction / Short story" */
export function choicePaths(choices: ParentChoice[]) {
  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  const paths = new Map<string, string[]>();
  for (const choice of choices) {
    const path: string[] = [];
    const seen = new Set<string>();
    for (let at: ParentChoice | undefined = choice; at && !seen.has(at.id); at = byId.get(at.parentId ?? "")) {
      seen.add(at.id);
      path.unshift(at.name);
    }
    paths.set(choice.id, path);
  }
  return paths;
}

/** The item and every item under it: never its own parent */
export function subtree(choices: ParentChoice[], id: string | undefined) {
  const out = new Set<string>();
  if (!id) return out;
  const children = new Map<string, string[]>();
  for (const choice of choices)
    if (choice.parentId)
      children.set(choice.parentId, [...(children.get(choice.parentId) ?? []), choice.id]);
  const queue = [id];
  while (queue.length) {
    const next = queue.shift()!;
    if (out.has(next)) continue;
    out.add(next);
    queue.push(...(children.get(next) ?? []));
  }
  return out;
}

/**
 * The parent of a family's item, chosen by searching every item's path (SLN-1158).
 * The field is a `data-picker`, so ↑ ↓ and Enter pick a choice (shortcuts
 * provider). At most eight choices show, so the list never scrolls inside
 * its dialog; typing narrows it.
 */
export function ParentPicker({
  familyName,
  choices,
  value,
  onChange,
  exclude,
}: {
  familyName: string;
  choices: ParentChoice[];
  /** The chosen parent's id, or "" for the top level */
  value: string;
  onChange: (id: string) => void;
  /** The item being moved: it and its narrower items are left out */
  exclude?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const paths = useMemo(() => choicePaths(choices), [choices]);
  const left = useMemo(() => subtree(choices, exclude), [choices, exclude]);
  const options = useMemo(
    () =>
      choices
        .filter((choice) => !left.has(choice.id))
        .map((choice) => ({ id: choice.id, path: paths.get(choice.id) ?? [choice.name] }))
        // Paths in natural order: Group 2 before Group 10
        .sort((a, b) =>
          a.path.join("\u0000").localeCompare(b.path.join("\u0000"), "en", { numeric: true, sensitivity: "base" }),
        ),
    [choices, left, paths],
  );
  const typed = query.trim();
  const matches = typed
    ? options
        .map((option) => ({ option, score: searchScore(typed, option.path.join(" / ")) }))
        .filter(({ score }) => score >= 0)
        .sort((a, b) => b.score - a.score)
        .map(({ option }) => option)
    : options;
  // The current choice stays in view until the search leaves it out
  const chosen = options.find((option) => option.id === value);
  const showTop = !typed || searchScore(typed, "Top level") >= 0;
  const pinned =
    chosen && !typed && matches.indexOf(chosen) >= SHOWN - (showTop ? 1 : 0) ? chosen : null;
  const all = [
    ...(showTop ? [{ id: TOP, path: ["Top level"] }] : []),
    ...(pinned ? [pinned] : []),
    ...matches.filter((option) => option !== pinned),
  ];
  const listed = all.slice(0, SHOWN);
  const more = all.length - listed.length;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="type-label block">
        Parent
      </label>
      <input
        id={id}
        data-picker=""
        type="text"
        value={query}
        maxLength={200}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${familyName.toLowerCase()}…`}
        className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 px-2.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-primary focus:outline-none pointer-coarse:h-11"
      />
      <div
        role="listbox"
        aria-label="Parent"
        className="rounded-sm border border-glass-border/60 py-1"
      >
        {listed.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id || "top"}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(option.id)}
              className="flex w-full items-start gap-2 px-2.5 py-1 text-left text-sm leading-5 text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:min-h-11 pointer-coarse:py-3"
            >
              <span className="flex h-5 w-3.5 shrink-0 items-center">
                {selected && <Check className="h-3.5 w-3.5 text-accent-primary" strokeWidth={1.5} />}
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {option.path.slice(0, -1).map((part, index) => (
                  <span key={index}>{part} / </span>
                ))}
                <span className={selected ? "text-fg-primary" : undefined}>{option.path.at(-1)}</span>
              </span>
            </button>
          );
        })}
        {listed.length === 0 && (
          <p className="px-2.5 py-1 text-sm text-fg-secondary">No item matches “{typed}”</p>
        )}
        {more > 0 && (
          <p className="px-2.5 py-1 text-xs text-fg-secondary">
            {more.toLocaleString("en")} more; type to narrow the list
          </p>
        )}
      </div>
    </div>
  );
}
