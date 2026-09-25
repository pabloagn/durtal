"use client";
import { useState } from "react";
import type { getPublisherOptions } from "@/lib/actions/publishers";
export type PublisherOption = Omit<
  Awaited<ReturnType<typeof getPublisherOptions>>[number],
  "parentName"
> & { parentName?: string | null };
export const fieldClass =
  "w-full rounded-sm border border-glass-border bg-bg-primary px-3 py-2 text-sm text-fg-primary focus:outline-none focus:ring-1 focus:ring-accent-rose";
export function publisherLabel(p: PublisherOption) {
  return `${p.name}${p.country ? ` · ${p.country}` : ""}${p.kind === "imprint" ? ` · ${p.parentName ?? "imprint"}` : ""}`;
}
export function PublisherPicker({
  options,
  value,
  onChange,
  label = "Publisher",
  disabled = false,
}: {
  options: PublisherOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter(
    (p) =>
      p.id === value ||
      publisherLabel(p).toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="space-y-2">
      <input
        className={fieldClass}
        aria-label={`Search ${label.toLowerCase()}`}
        placeholder={`Search ${label.toLowerCase()}…`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={disabled}
      />
      <label className="block space-y-1 text-xs text-fg-secondary">
        <span>{label}</span>
        <select
          className={fieldClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">Choose a publisher…</option>
          {filtered.map((p) => (
            <option key={p.id} value={p.id}>
              {publisherLabel(p)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
