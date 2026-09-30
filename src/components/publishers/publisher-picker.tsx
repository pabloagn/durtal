"use client";
import { useId, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { CapAligned } from "@/components/shared/cap-aligned";
import { usePublisherSearch } from "@/hooks/use-publisher-search";
import {
  createPublisherFromName,
  type getPublisherOptions,
} from "@/lib/actions/publishers";
import { normalizeSearchText } from "@/lib/utils/search-text";
export type PublisherOption = Omit<
  Awaited<ReturnType<typeof getPublisherOptions>>[number],
  "parentName"
> & { parentName?: string | null };
export const fieldClass =
  "w-full rounded-sm border border-glass-border bg-bg-primary px-3 py-2 text-sm text-fg-primary focus:outline-none focus:ring-1 focus:ring-accent-rose";
export function publisherLabel(p: PublisherOption) {
  return `${p.name}${p.country ? ` · ${p.country}` : ""}${p.kind === "imprint" ? ` · ${p.parentName ?? "imprint"}` : ""}`;
}
/** Country, and the parent house of an imprint, shown after the name */
function publisherDetail(p: PublisherOption) {
  return [
    p.kind === "imprint" ? `Imprint of ${p.parentName ?? "a house"}` : null,
    p.country,
  ]
    .filter(Boolean)
    .join(" · ");
}

type Item = { publisher: PublisherOption } | { create: string };

/**
 * Search box for publishing houses. Results show as you type (names and
 * aliases, accents and typos allowed); arrow keys and Enter pick one. With
 * `allowCreate`, the last row creates a house from the typed name.
 */
export function PublisherSearch({
  onSelect,
  exclude = [],
  kinds,
  allowCreate = false,
  label = "Publisher",
  placeholder = "Search publishers…",
  disabled = false,
  autoFocus = false,
}: {
  onSelect: (publisher: PublisherOption) => void;
  /** Ids that are already chosen */
  exclude?: string[];
  kinds?: ("publisher" | "imprint")[];
  allowCreate?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const { results, isSearching } = usePublisherSearch(query, kinds);
  const typed = query.trim();
  const shown = results.filter((p) => !exclude.includes(p.id));
  const exists = results.some(
    (p) => normalizeSearchText(p.name) === normalizeSearchText(typed),
  );
  const items: Item[] = [
    ...shown.map((publisher) => ({ publisher })),
    ...(allowCreate && typed && !isSearching && !exists
      ? [{ create: typed }]
      : []),
  ];
  const current = Math.min(active, Math.max(items.length - 1, 0));

  async function choose(item: Item) {
    if ("publisher" in item) {
      onSelect(item.publisher);
      setQuery("");
      return;
    }
    setCreating(true);
    try {
      const created = await createPublisherFromName(item.create);
      onSelect(created);
      setQuery("");
      toast.success(`Created ${created.name}`);
    } catch {
      toast.error("Could not create the publisher");
    } finally {
      setCreating(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(
        Math.min(Math.max(current + step, 0), Math.max(items.length - 1, 0)),
      );
    } else if (e.key === "Enter" && typed) {
      // Enter picks a result; it never submits the surrounding form
      e.preventDefault();
      if (items[current] && !creating) void choose(items[current]);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  }

  const open = !!typed;
  const optionId = (i: number) => `${listId}-${i}`;
  return (
    <div className="space-y-1">
      <label className="block space-y-1 text-xs text-fg-secondary">
        <span>{label}</span>
        <input
          className={fieldClass}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && items.length ? optionId(current) : undefined
          }
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          disabled={disabled || creating}
          autoFocus={autoFocus}
        />
      </label>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={`${label} results`}
          className="max-h-56 overflow-y-auto rounded-sm border border-glass-border bg-bg-primary p-1"
        >
          {items.map((item, i) => (
            <button
              key={"publisher" in item ? item.publisher.id : "create"}
              id={optionId(i)}
              type="button"
              role="option"
              aria-selected={i === current}
              disabled={disabled || creating}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(item)}
              className={`flex w-full gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                i === current
                  ? "bg-bg-tertiary text-fg-primary"
                  : "text-fg-secondary"
              }`}
            >
              {"publisher" in item ? (
                <>
                  <span className="lines-1 min-w-0">{item.publisher.name}</span>
                  {publisherDetail(item.publisher) && (
                    <span className="lines-1 min-w-0 shrink-0 text-fg-muted">
                      {publisherDetail(item.publisher)}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <CapAligned height={14}>
                    {creating ? (
                      <Loader2
                        size={14}
                        strokeWidth={1.5}
                        className="animate-spin"
                      />
                    ) : (
                      <Plus size={14} strokeWidth={1.5} />
                    )}
                  </CapAligned>
                  <span className="lines-1 min-w-0">
                    Create publisher &ldquo;{item.create}&rdquo;
                  </span>
                </>
              )}
            </button>
          ))}
          {!items.length && (
            <p className="px-2 py-1.5 text-sm text-fg-muted">
              {isSearching ? "Searching…" : "No publisher found"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A chosen publisher with a remove button */
export function PublisherChip({
  publisher,
  onRemove,
  disabled = false,
}: {
  publisher: PublisherOption;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex gap-1.5 rounded-sm border border-glass-border px-2 py-1 text-xs text-fg-secondary">
      <span>{publisherLabel(publisher)}</span>
      <CapAligned height={12}>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove ${publisher.name}`}
          className="block text-fg-muted transition-colors hover:text-fg-primary"
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      </CapAligned>
    </span>
  );
}

/** One publisher: the chosen one with a remove button, or the search box */
export function PublisherChoice({
  value,
  onChange,
  label = "Publisher",
  kinds,
  exclude,
  allowCreate = false,
  disabled = false,
}: {
  value: PublisherOption | null;
  onChange: (publisher: PublisherOption | null) => void;
  label?: string;
  kinds?: ("publisher" | "imprint")[];
  exclude?: string[];
  allowCreate?: boolean;
  disabled?: boolean;
}) {
  if (!value)
    return (
      <PublisherSearch
        label={label}
        kinds={kinds}
        exclude={exclude}
        allowCreate={allowCreate}
        disabled={disabled}
        onSelect={onChange}
      />
    );
  return (
    <div className="space-y-1 text-xs text-fg-secondary">
      <span className="block">{label}</span>
      <PublisherChip
        publisher={value}
        onRemove={() => onChange(null)}
        disabled={disabled}
      />
    </div>
  );
}
