"use client";

import { useEffect, useRef, useState } from "react";

export interface PickerChoice {
  id: string;
  label: string;
  /** Shown after the label, dimmer: "perfume house", "1883–1963" */
  hint?: string | null;
}

/**
 * A bounded search with a "Create" choice, as the taxonomy search has. The
 * field is a `data-picker`: ↑ ↓ and Enter pick a choice (shortcuts
 * provider), Escape or leaving the field closes it.
 */
export function SearchPicker({
  label,
  placeholder,
  search,
  onPick,
  onCreate,
  createLabel = (name) => `Create “${name}”`,
  exclude,
  onClose,
}: {
  /** Names the field for screen readers: "Search houses" */
  label: string;
  placeholder: string;
  search: (query: string) => Promise<PickerChoice[]>;
  onPick: (choice: PickerChoice) => void;
  /** Makes a new record from the typed name; omit to offer none */
  onCreate?: (name: string) => Promise<PickerChoice>;
  createLabel?: (name: string) => string;
  exclude?: Set<string>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<PickerChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      search(query.trim())
        .then((found) => live && (setChoices(found), setError(null)))
        .catch(() => live && setError("Search failed"));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  const shown = (choices ?? []).filter((c) => !exclude?.has(c.id));
  const name = query.trim();
  const exact = (choices ?? []).some(
    (c) => c.label.toLowerCase() === name.toLowerCase(),
  );

  async function create() {
    if (!onCreate) return;
    setCreating(true);
    try {
      onPick(await onCreate(name));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create");
      setCreating(false);
    }
  }

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      <input
        ref={input}
        data-picker
        type="text"
        value={query}
        maxLength={200}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), onClose())}
        placeholder={placeholder}
        aria-label={label}
        className="h-7 w-56 rounded-sm border border-glass-border bg-bg-primary/80 px-2 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent-rose focus:outline-none"
      />
      <div className="glass absolute left-0 top-8 z-30 w-72 py-1">
        {error && <p className="px-2 py-1 text-xs text-accent-red-text">{error}</p>}
        {!error && choices === null && (
          <p className="px-2 py-1 text-xs text-fg-secondary">Searching...</p>
        )}
        {shown.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => onPick(choice)}
            className="block w-full truncate px-2 py-1 text-left text-xs text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
          >
            {choice.label}
            {choice.hint && <span className="text-fg-secondary"> · {choice.hint}</span>}
          </button>
        ))}
        {choices && !shown.length && !name && (
          <p className="px-2 py-1 text-xs text-fg-secondary">Type a name</p>
        )}
        {onCreate && name && choices && !exact && (
          <button
            type="button"
            disabled={creating}
            onClick={create}
            className="block w-full truncate px-2 py-1 text-left text-xs text-accent-rose-text hover:bg-bg-tertiary"
          >
            {creating ? "Creating..." : createLabel(name)}
          </button>
        )}
      </div>
    </div>
  );
}
