"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { SlidersHorizontal } from "lucide-react";

export interface FilterGroup {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

interface FilterDropdownProps {
  groups: FilterGroup[];
  activeFilters: Record<string, string[]>;
  onFilterChange: (key: string, values: string[]) => void;
  onClearAll: () => void;
}

export function FilterDropdown({
  groups,
  activeFilters,
  onFilterChange,
  onClearAll,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeCount = Object.values(activeFilters).reduce(
    (sum, vals) => sum + vals.length,
    0,
  );

  const handleToggleValue = useCallback(
    (groupKey: string, value: string) => {
      const current = activeFilters[groupKey] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      onFilterChange(groupKey, next);
    },
    [activeFilters, onFilterChange],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors ${
          activeCount > 0
            ? "bg-accent-plum/20 text-fg-primary"
            : "text-fg-muted hover:bg-bg-tertiary hover:text-fg-secondary"
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
        Filter
        {activeCount > 0 && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-rose text-[10px] font-medium leading-none text-fg-primary">
            {activeCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 min-w-56 rounded-sm border border-glass-border bg-bg-secondary shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]">
          {/* Header with clear all */}
          {activeCount > 0 && (
            <div className="flex items-center justify-between border-b border-glass-border px-3 py-2">
              <span className="text-xs text-fg-muted">
                {activeCount} active
              </span>
              <button
                onClick={() => {
                  onClearAll();
                }}
                className="text-xs text-accent-rose transition-colors hover:text-accent-rose/80"
              >
                Clear all
              </button>
            </div>
          )}

          {/* Filter groups */}
          <div className="max-h-72 overflow-y-auto">
            {groups.map((group, groupIdx) => (
              <div
                key={group.key}
                className={
                  groupIdx < groups.length - 1
                    ? "border-b border-glass-border"
                    : ""
                }
              >
                <div className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
                  {group.label}
                </div>
                <div className="px-1.5 pb-2">
                  {group.options.map((option) => {
                    const isChecked =
                      activeFilters[group.key]?.includes(option.value) ?? false;
                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
                      >
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                            isChecked
                              ? "border-accent-plum bg-accent-plum"
                              : "border-glass-border bg-transparent"
                          }`}
                        >
                          {isChecked && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 10 10"
                              fill="none"
                              className="text-fg-primary"
                            >
                              <path
                                d="M2 5L4.5 7.5L8 3"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() =>
                            handleToggleValue(group.key, option.value)
                          }
                          className="sr-only"
                        />
                        {option.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
