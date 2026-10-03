"use client";
import { X } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { getPublisherOptions } from "@/lib/actions/publishers";
export type PublisherOption = Omit<
  Awaited<ReturnType<typeof getPublisherOptions>>[number],
  "parentName"
> & { parentName?: string | null };
export function publisherLabel(p: PublisherOption) {
  return `${p.name}${p.country ? ` · ${p.country}` : ""}${p.kind === "imprint" ? ` · ${p.parentName ?? "imprint"}` : ""}`;
}
/** One publisher from the directory: the shared Select, with a search box */
export function PublisherPicker({
  options,
  value,
  onChange,
  label = "Publisher",
  placeholder = "Choose a publisher…",
  disabled = false,
}: {
  options: PublisherOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      label={label}
      options={options.map((p) => ({ value: p.id, label: publisherLabel(p) }))}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      searchable
      searchPlaceholder="Search publishers…"
    />
  );
}
/** Several publishers (co-published editions): removable chips over a picker */
export function PublisherLinksField({
  options,
  ids,
  onChange,
  disabled = false,
}: {
  options: PublisherOption[];
  ids: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => {
            const p = options.find((o) => o.id === id);
            const name = p ? publisherLabel(p) : "Publisher";
            return (
              <span
                key={id}
                className="inline-flex h-6 items-center gap-1 rounded-sm border border-glass-border bg-bg-tertiary/60 pl-2 pr-1 text-xs text-fg-secondary"
              >
                {name}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(ids.filter((x) => x !== id))}
                  className="rounded-sm p-0.5 text-fg-muted transition-colors hover:text-fg-primary disabled:opacity-40"
                >
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <PublisherPicker
        label={ids.length ? "Add another publisher" : "Publisher"}
        options={options.filter((p) => !ids.includes(p.id))}
        value=""
        onChange={(id) => id && onChange([...ids, id])}
        disabled={disabled}
      />
    </div>
  );
}
