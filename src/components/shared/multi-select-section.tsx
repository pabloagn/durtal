"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";

export interface MultiSelectSectionProps {
  title: string;
  items: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** What an empty list says instead of "No themes available": while the full list loads, or when it could not */
  emptyText?: string;
}

export function MultiSelectSection({
  title,
  items,
  selectedIds,
  onChange,
  emptyText,
}: MultiSelectSectionProps) {
  const [filter, setFilter] = useState("");

  // Chosen items stay in the list while a filter narrows the others
  const filtered = filter
    ? items.filter(
        (i) =>
          selectedIds.includes(i.id) ||
          i.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : items;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="type-label">{title}</h3>
        {selectedIds.length > 0 && (
          <Badge variant="muted">{selectedIds.length}</Badge>
        )}
      </div>
      {items.length > 8 && (
        <input
          type="text"
          aria-label={`Filter ${title.toLowerCase()}`}
          placeholder={`Filter ${title.toLowerCase()}...`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-2 h-7 w-full rounded-sm border border-glass-border bg-bg-primary px-2 text-xs text-fg-primary placeholder:text-fg-muted focus:border-accent-primary focus:outline-none pointer-coarse:h-11"
        />
      )}
      {items.length === 0 ? (
        <p className="text-xs text-fg-secondary">
          {emptyText ?? `No ${title.toLowerCase()} available`}
        </p>
      ) : (
        <div className="max-h-[200px] space-y-0.5 overflow-y-auto rounded-sm border border-glass-border bg-bg-primary p-2">
          {filtered.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs text-fg-secondary hover:bg-bg-tertiary pointer-coarse:min-h-11"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => toggle(item.id)}
                className="rounded-sm"
              />
              {item.name}
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-1 text-xs text-fg-secondary">No matches</p>
          )}
        </div>
      )}
      {selectedIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {selectedIds.map((id) => {
            const item = items.find((i) => i.id === id);
            return item ? (
              <Badge key={id} variant="default">
                {item.name}
              </Badge>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}
