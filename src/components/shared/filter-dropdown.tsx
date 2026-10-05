"use client";

import { useRef, useState, useEffect, useCallback, useLayoutEffect } from "react";
import { SlidersHorizontal, ChevronDown, Search, Check } from "lucide-react";
import { RangeSlider } from "@/components/ui/range-slider";
import { inkOn } from "@/lib/color/color-math";

/** Minimum number of options before showing the search box in a filter group */
const SEARCH_THRESHOLD = 8;
/** Most options one group lists at once: a longer list (every actor of a large film catalogue) narrows by its search */
const LIST_LIMIT = 200;
/** The panel keeps this far from the window's edges */
const EDGE = 16;

export interface FilterOption {
  value: string;
  label: string;
  /** How many items have it, shown beside the label */
  count?: number;
  /** A colour group's swatch (CSS colour) */
  swatch?: string;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: FilterOption[];
  /** The panel section the group is under; a panel with sections shows one section at a time */
  section?: string;
  /** Options with a swatch, in two columns: the cover colours */
  swatches?: boolean;
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
  section?: string;
  /** The range narrows the list: counted in its section */
  active?: boolean;
}

export type AnyFilterGroup = FilterGroup | RangeFilterGroup;

const isRange = (group: AnyFilterGroup): group is RangeFilterGroup => "type" in group && group.type === "range";

interface FilterDropdownProps {
  groups: AnyFilterGroup[];
  activeFilters: Record<string, string[]>;
  onFilterChange: (key: string, values: string[]) => void;
  onClearAll: () => void;
  /** Count of active range filters (for badge display) */
  activeRangeCount?: number;
  /** Called when the pointer reaches the button, it takes focus or the panel opens: start loading lazy options */
  onIntent?: () => void;
  /** The groups are still loading */
  loading?: boolean;
  /** The groups did not load; opening the panel again retries */
  failed?: boolean;
  /** The panel's sections in order, when its groups have one (the library, SLN-405) */
  sections?: string[];
}

/** A count badge: a group's or a section's chosen values */
function CountBadge({ count }: { count: number }) {
  return (
    <span className="flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-accent-plum/30 px-1 text-micro font-medium leading-none text-fg-secondary">
      {count}
    </span>
  );
}

/** One option's row: a checkbox, or its swatch, then the label and its count */
function OptionRow({
  option,
  checked,
  swatch,
  onToggle,
}: {
  option: FilterOption;
  checked: boolean;
  swatch: boolean;
  onToggle: () => void;
}) {
  // A colour no cover has stays in its place, but cannot narrow to nothing
  const empty = swatch && option.count === 0 && !checked;
  return (
    <label
      className={`flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs transition-colors pointer-coarse:min-h-11 ${
        empty
          ? "cursor-default text-fg-muted"
          : "cursor-pointer text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
      }`}
    >
      {swatch ? (
        <span
          aria-hidden
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
            checked ? "border-fg-primary" : "border-fg-muted/60"
          } ${empty ? "opacity-40" : ""}`}
          style={{ backgroundColor: option.swatch }}
        >
          {checked && (
            <Check
              className={`h-2.5 w-2.5 ${option.swatch && inkOn(option.swatch) === "dark" ? "text-bg-primary" : "text-fg-primary"}`}
              strokeWidth={2.5}
            />
          )}
        </span>
      ) : (
        <span
          aria-hidden
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            checked ? "border-accent-plum bg-accent-plum" : "border-glass-border bg-transparent"
          }`}
        >
          {checked && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-fg-primary">
              <path d="M2 5L4.5 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      )}
      <input type="checkbox" checked={checked} disabled={empty} onChange={onToggle} className="sr-only" />
      {/* The label and its count share a baseline; the box stays centred */}
      <span className="min-w-0 flex-1 self-baseline">{option.label}</span>
      {option.count !== undefined && (
        <span className="shrink-0 self-baseline pl-2 font-mono text-micro tabular-nums text-fg-secondary">
          {option.count.toLocaleString("en")}
        </span>
      )}
    </label>
  );
}

export function FilterDropdown({
  groups,
  activeFilters,
  onFilterChange,
  onClearAll,
  activeRangeCount = 0,
  onIntent,
  loading = false,
  failed = false,
  sections,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [groupSearchTerms, setGroupSearchTerms] = useState<Record<string, string>>({});
  const [section, setSection] = useState<string | null>(null);

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

  const groupActiveCount = (group: AnyFilterGroup) =>
    isRange(group) ? (group.active ? 1 : 0) : (activeFilters[group.key]?.length ?? 0);
  const sectionCount = (name: string) =>
    groups.filter((g) => g.section === name).reduce((sum, g) => sum + groupActiveCount(g), 0);
  // A panel with sections opens on the first section with a chosen value
  const currentSection =
    sections && (section ?? sections.find((s) => sectionCount(s) > 0) ?? sections[0]);

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

  // The panel hangs from the button's right edge; on a narrow window it
  // moves sideways to stay EDGE px inside it, and the page scrolls to show
  // all of it when it reaches below the window
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    // The window's width without its scrollbar: 100vw counts a classic scrollbar
    const width = document.documentElement.clientWidth;
    panel.style.translate = "";
    panel.style.maxWidth = `${width - 2 * EDGE}px`;
    const rect = panel.getBoundingClientRect();
    const right = width - EDGE;
    const shift = rect.left < EDGE ? EDGE - rect.left : rect.right > right ? right - rect.right : 0;
    if (shift) panel.style.translate = `${shift}px 0`;
    if (rect.bottom > window.innerHeight) panel.scrollIntoView({ block: "nearest" });
  }, [open]);

  /** A checkbox or swatch group's rows, with a search when the list is long */
  const renderOptions = (group: FilterGroup) => {
    const searchTerm = (groupSearchTerms[group.key] ?? "").toLowerCase();
    const filteredOptions = searchTerm
      ? group.options.filter((o) => o.label.toLowerCase().includes(searchTerm))
      : group.options;
    // Past the limit only chosen options stay listed, and a line says how many there are
    const chosen = activeFilters[group.key] ?? [];
    const shown = filteredOptions.filter((o, i) => i < LIST_LIMIT || chosen.includes(o.value));
    return (
      <div className="px-1.5 pb-2">
        {group.options.length >= SEARCH_THRESHOLD && !group.swatches && (
          <div className="relative mb-1 px-1.5">
            <Search className="absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-muted" strokeWidth={1.5} />
            <input
              type="text"
              aria-label={`Search ${group.label.toLowerCase()}`}
              placeholder={`Search ${group.label.toLowerCase()}...`}
              value={groupSearchTerms[group.key] ?? ""}
              onChange={(e) =>
                setGroupSearchTerms((prev) => ({
                  ...prev,
                  [group.key]: e.target.value,
                }))
              }
              className="w-full rounded-sm border border-glass-border bg-bg-primary py-1 pl-7 pr-2 text-xs text-fg-secondary outline-none placeholder:text-fg-muted/60 focus:border-accent-rose"
            />
          </div>
        )}
        <div className={group.swatches ? "grid grid-cols-2 gap-x-1" : undefined}>
          {shown.map((option) => (
            <OptionRow
              key={option.value}
              option={option}
              checked={chosen.includes(option.value)}
              swatch={!!group.swatches}
              onToggle={() => handleToggleValue(group.key, option.value)}
            />
          ))}
        </div>
        {shown.length < filteredOptions.length && (
          <p className="px-1.5 py-1 text-xs text-fg-secondary">
            {shown.length} of {filteredOptions.length.toLocaleString("en")} shown. Type to narrow.
          </p>
        )}
      </div>
    );
  };

  const renderRange = (group: RangeFilterGroup) => (
    <div className="px-3 pb-1 pt-0">
      <RangeSlider
        min={group.min}
        max={group.max}
        value={group.value ?? [group.min, group.max]}
        onChange={group.onChange}
      />
    </div>
  );

  const status = (
    <>
      {loading && (
        <p role="status" className="px-3 py-2.5 text-xs text-fg-secondary">
          Loading filters…
        </p>
      )}
      {failed && (
        <p role="alert" className="px-3 py-2.5 text-xs text-fg-secondary">
          The filters did not load. Close the panel and open it again.
        </p>
      )}
    </>
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => {
          onIntent?.();
          setOpen((prev) => !prev);
        }}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs transition-colors ${
          activeCount > 0
            ? "bg-accent-plum/20 text-fg-primary"
            : "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
        Filter
        {activeCount > 0 && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-rose text-micro font-medium leading-none text-fg-primary">
            {activeCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className={`glass absolute right-0 top-full z-50 mt-1.5 ${
            sections ? "w-[34rem] overflow-hidden" : "min-w-56"
          }`}
        >
          {/* Header with clear all */}
          {activeCount > 0 && (
            <div className="flex items-center justify-between border-b border-glass-border px-3 py-2">
              <span className="text-xs text-fg-secondary">
                {activeCount} active
              </span>
              <button
                onClick={() => {
                  onClearAll();
                }}
                className="text-xs text-accent-rose-text transition-colors hover:text-accent-rose-text/80"
              >
                Clear all
              </button>
            </div>
          )}

          {sections && currentSection ? (
            /* A rail of sections, and the chosen section's groups beside it */
            <div className="flex h-[min(26rem,60vh)]">
              <div
                role="tablist"
                aria-orientation="vertical"
                aria-label="Filter sections"
                className="w-28 shrink-0 overflow-y-auto border-r border-glass-border py-1.5 sm:w-32"
              >
                {sections.map((name) => {
                  const selected = name === currentSection;
                  const count = sectionCount(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setSection(name)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors pointer-coarse:min-h-11 ${
                        selected
                          ? "bg-bg-tertiary text-fg-primary"
                          : "text-fg-secondary hover:bg-bg-tertiary/60 hover:text-fg-primary"
                      }`}
                    >
                      <span className="min-w-0 truncate">{name}</span>
                      {count > 0 && <CountBadge count={count} />}
                    </button>
                  );
                })}
              </div>
              <div role="tabpanel" aria-label={currentSection} className="min-w-0 flex-1 overflow-y-auto pb-1">
                {status}
                {groups
                  .filter((g) => g.section === currentSection)
                  .map((group) => {
                    const count = groupActiveCount(group);
                    return (
                      <div key={group.key}>
                        <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5">
                          <span className="type-caption">{group.label}</span>
                          {count > 0 && <CountBadge count={count} />}
                        </div>
                        {isRange(group) ? renderRange(group) : renderOptions(group)}
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            <>
              {status}
              {/* Filter groups */}
              <div className="max-h-96 overflow-y-auto">
                {groups.map((group, groupIdx) => {
                  const isExpanded = expandedGroups[group.key] ?? false;
                  // A range's active state shows in the button's count
                  const count = isRange(group) ? 0 : groupActiveCount(group);

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
                          <span className="type-caption">
                            {group.label}
                          </span>
                          {count > 0 && <CountBadge count={count} />}
                        </div>
                        <ChevronDown
                          className={`h-3 w-3 shrink-0 text-fg-muted transition-transform duration-150 ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                          strokeWidth={1.5}
                        />
                      </button>

                      {/* Group content */}
                      {isExpanded && (isRange(group) ? renderRange(group) : renderOptions(group))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
