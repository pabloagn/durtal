"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { SlidersHorizontal, ChevronDown, Search } from "lucide-react";
import { RangeSlider } from "@/components/ui/range-slider";

/** Minimum number of options before showing the search box in a filter group */
const SEARCH_THRESHOLD = 8;

export interface FilterGroup {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface RangeFilterGroup {
  type: "range";
  key: string;
  label: string;
  min: number;
  max: number;
  /** Active range, defaults to [min, max] when unset */
  value?: [number, number];
  onChange: (value: [number, number]) => void;
}

export type AnyFilterGroup = FilterGroup | RangeFilterGroup;

interface FilterDropdownProps {
  groups: AnyFilterGroup[];
  activeFilters: Record<string, string[]>;
  onFilterChange: (key: string, values: string[]) => void;
  onClearAll: () => void;
  /** Count of active range filters (for badge display) */
  activeRangeCount?: number;
}

export function FilterDropdown({
  groups,
  activeFilters,
  onFilterChange,
  onClearAll,
  activeRangeCount = 0,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [groupSearchTerms, setGroupSearchTerms] = useState<Record<string, string>>({});

  // Track which groups are expanded: default first group open, rest closed
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () => {
      const initial: Record<string, boolean> = {};
      groups.forEach((g, i) => {
        initial[g.key] = i === 0;
      });
      return initial;
    },
  );

  // When groups list changes (e.g. on first render), initialise new keys
  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev };
      groups.forEach((g, i) => {
        if (!(g.key in next)) {
          next[g.key] = i === 0;
        }
      });
      return next;
    });
  }, [groups]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeCount =
    Object.values(activeFilters).reduce((sum, vals) => sum + vals.length, 0) +
    activeRangeCount;

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

  // Close on outside click — but only when the click is truly outside the container.
  // We use mousedown so we can check before focus changes happen.
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
          <div className="max-h-96 overflow-y-auto">
            {groups.map((group, groupIdx) => {
              const isExpanded = expandedGroups[group.key] ?? false;
              const isRange = "type" in group && group.type === "range";

              // Active count for this group (for badge on header)
              const groupActiveCount = isRange
                ? 0 // range active state shown via activeRangeCount at top level
                : (activeFilters[group.key]?.length ?? 0);

              return (
                <div
                  key={group.key}
                  className={
                    groupIdx < groups.length - 1
                      ? "border-b border-glass-border"
                      : ""
                  }
                >
                  {/* Collapsible group header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex w-full items-center justify-between px-3 pb-1 pt-2.5 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-fg-muted">
                        {group.label}
                      </span>
                      {groupActiveCount > 0 && (
                        <span className="flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-accent-plum/30 text-[9px] font-medium leading-none text-fg-secondary">
                          {groupActiveCount}
                        </span>
                      )}
                    </div>
                    <ChevronDown
                      className={`h-3 w-3 shrink-0 text-fg-muted transition-transform duration-150 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                      strokeWidth={1.5}
                    />
                  </button>

                  {/* Group content */}
                  {isExpanded && (
                    isRange ? (
                      /* Range slider group */
                      <div className="px-3 pb-1 pt-0">
                        <RangeSlider
                          min={(group as FilterGroup & RangeFilterGroup).min}
                          max={(group as RangeFilterGroup).max}
                          value={(group as RangeFilterGroup).value ?? [(group as RangeFilterGroup).min, (group as RangeFilterGroup).max]}
                          onChange={(group as RangeFilterGroup).onChange}
                        />
                      </div>
                    ) : (
                      /* Checkbox group with optional search */
                      <div className="px-1.5 pb-2">
                        {(group as FilterGroup).options.length >= SEARCH_THRESHOLD && (
                          <div className="relative mb-1 px-1.5">
                            <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-muted" strokeWidth={1.5} />
                            <input
                              type="text"
                              placeholder={`Search ${group.label.toLowerCase()}...`}
                              value={groupSearchTerms[group.key] ?? ""}
                              onChange={(e) =>
                                setGroupSearchTerms((prev) => ({
                                  ...prev,
                                  [group.key]: e.target.value,
                                }))
                              }
                              className="w-full rounded-sm border border-glass-border bg-bg-primary py-1 pl-7 pr-2 text-xs text-fg-secondary outline-none placeholder:text-fg-muted/60 focus:border-accent-plum"
                            />
                          </div>
                        )}
                        {(() => {
                          const searchTerm = (groupSearchTerms[group.key] ?? "").toLowerCase();
                          const filteredOptions = searchTerm
                            ? (group as FilterGroup).options.filter((o) =>
                                o.label.toLowerCase().includes(searchTerm),
                              )
                            : (group as FilterGroup).options;
                          return filteredOptions.map((option) => {
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
                          });
                        })()}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
