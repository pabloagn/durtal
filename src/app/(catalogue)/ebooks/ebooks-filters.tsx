"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, ArrowDown, ArrowUp } from "lucide-react";
import {
  FilterDropdown,
  type FilterGroup,
} from "@/components/shared/filter-dropdown";
import { FILTER_ROW_CLASSES } from "@/components/shared/entity-filters";
import { ViewModeSwitcher } from "@/components/books/view-mode-switcher";
import { GridSizeSlider } from "@/components/books/grid-size-slider";
import { firstPageHref } from "@/lib/utils/list-params";
import { parseEbookLibraryParams } from "@/lib/ebooks/library-params";
import { formatLabel } from "@/lib/ebooks/formats";
import { languageName } from "@/lib/utils/language";
import type { EbookLibraryCounts } from "@/lib/ebooks/library-queries";

export const EBOOK_SORT_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "added", label: "Added" },
  { value: "opened", label: "Opened" },
  { value: "size", label: "Size" },
];
export function EbooksFilters({
  counts,
  view,
  setView,
  columns,
  setColumns,
}: {
  counts: EbookLibraryCounts;
  view: "grid" | "list";
  setView: (view: "grid" | "list") => void;
  columns: number;
  setColumns: (columns: number) => void;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const parsed = parseEbookLibraryParams(search);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(parsed.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(search.toString());
  useEffect(() => {
    latest.current = search.toString();
  }, [search]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (input.current && document.activeElement !== input.current)
      setQuery(parsed.q);
  }, [parsed.q]);
  function change(key: string, values: string[]) {
    if (timer.current) clearTimeout(timer.current);
    const params = new URLSearchParams(latest.current);
    params.delete(key);
    values.forEach((value) => params.append(key, value));
    router.push(firstPageHref("/ebooks", params), { scroll: false });
  }
  const groups: FilterGroup[] = [
    {
      key: "linked",
      label: "In Durtal",
      options: [
        { value: "linked", label: "Linked" },
        { value: "unlinked", label: "Not linked" },
        { value: "standalone", label: "Kept as eBook" },
      ],
    },
    {
      key: "format",
      label: "Format",
      options: counts.formats.map((value) => ({
        value,
        label: formatLabel(value),
      })),
    },
    {
      key: "language",
      label: "Language",
      options: counts.languages
        .map((value) => ({ value, label: languageName(value) ?? value }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      key: "drm",
      label: "Has a DRM file",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    {
      key: "review",
      label: "Needs review",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
  ];
  return (
    <div className={`mb-4 sm:mb-6 ${FILTER_ROW_CLASSES}`}>
      <div className="relative flex-1">
        <Search
          aria-hidden
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-secondary"
        />
        <input
          ref={input}
          type="search"
          maxLength={200}
          aria-label="Search eBooks"
          data-shortcut-search=""
          placeholder="Search eBooks…"
          value={query}
          className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-accent-primary focus:outline-none pointer-coarse:h-11"
          onChange={(event) => {
            const q = event.target.value;
            setQuery(q);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              const params = new URLSearchParams(latest.current);
              if (q) params.set("q", q);
              else params.delete("q");
              router.replace(firstPageHref("/ebooks", params), {
                scroll: false,
              });
            }, 150);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {EBOOK_SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={parsed.sort === option.value}
            className={`h-8 rounded-sm border px-2.5 text-xs transition-colors pointer-coarse:h-11 ${
              parsed.sort === option.value
                ? "border-accent-primary/40 bg-selection-bg text-fg-primary"
                : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
            }`}
            onClick={() => {
              const params = new URLSearchParams(latest.current);
              params.set("sort", option.value);
              params.set(
                "order",
                parsed.sort === option.value
                  ? parsed.order === "asc"
                    ? "desc"
                    : "asc"
                  : ["added", "opened", "size"].includes(option.value)
                    ? "desc"
                    : "asc",
              );
              router.push(firstPageHref("/ebooks", params), { scroll: false });
            }}
          >
            {/* The arrow sits on the label's cap-height center */}
            {option.label}
            {parsed.sort === option.value &&
              (parsed.order === "desc" ? (
                <ArrowDown aria-hidden className="ml-0.5 inline h-3 w-3 align-[calc(0.5cap-6px)]" strokeWidth={1.5} />
              ) : (
                <ArrowUp aria-hidden className="ml-0.5 inline h-3 w-3 align-[calc(0.5cap-6px)]" strokeWidth={1.5} />
              ))}
          </button>
        ))}
      </div>
      <FilterDropdown
        groups={groups}
        activeFilters={{
          linked: parsed.linked,
          format: parsed.formats,
          language: parsed.languages,
          drm: parsed.drm === null ? [] : [parsed.drm ? "yes" : "no"],
          review:
            parsed.needsReview === null
              ? []
              : [parsed.needsReview ? "yes" : "no"],
        }}
        onFilterChange={(key, values) =>
          change(
            key,
            key === "drm" || key === "review" ? values.slice(-1) : values,
          )
        }
        onClearAll={() => {
          const params = new URLSearchParams(latest.current);
          for (const key of ["linked", "format", "language", "drm", "review"])
            params.delete(key);
          router.push(firstPageHref("/ebooks", params), { scroll: false });
        }}
      />
      <ViewModeSwitcher
        value={view}
        onChange={(value) => {
          if (value === "grid" || value === "list") setView(value);
        }}
        availableModes={["grid", "list"]}
      />
      {view === "grid" && (
        <GridSizeSlider value={columns} onChange={setColumns} />
      )}
    </div>
  );
}
