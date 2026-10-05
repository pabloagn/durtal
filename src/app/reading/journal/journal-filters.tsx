"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import { firstPageHref } from "@/lib/utils/list-params";
import { formatRating } from "@/lib/utils/rating";
import { JOURNAL_DEFAULT_ORDER, JOURNAL_MIN_RATINGS } from "@/lib/reading/journal-params";
import type { ReadingFormat } from "@/lib/reading/constants";

const BASE = "/reading/journal";

const SORT_OPTIONS = [
  { value: "finished", label: "Finished" },
  { value: "started", label: "Started" },
  { value: "rating", label: "Rating" },
  { value: "title", label: "Title" },
];

const STATUS_OPTIONS = [
  { value: "reading", label: "Reading" },
  { value: "paused", label: "Paused" },
  { value: "finished", label: "Finished" },
  { value: "abandoned", label: "Abandoned" },
];

const FORMAT_LABELS: Record<ReadingFormat, string> = { print: "Print", ebook: "E-book", audio: "Audiobook" };

/** One choice only: a new tick replaces the old one */
const SINGLE = new Set(["minRating"]);
const PARAMS = ["status", "format", "minRating", "rereads", "yearMin", "yearMax"];

/** The journal's search, sorts and filters, all in the URL (SLN-448) */
export function JournalFilters({ yearRange, formats }: { yearRange: { min: number | null; max: number | null }; formats: ReadingFormat[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const list = (key: string) => searchParams.get(key)?.split(",").filter(Boolean) ?? [];

  const activeFilters: Record<string, string[]> = {
    status: list("status"),
    format: list("format"),
    minRating: list("minRating"),
    rereads: searchParams.get("rereads") === "1" ? ["1"] : [],
  };

  const min = yearRange.min ?? new Date().getFullYear();
  const max = yearRange.max ?? new Date().getFullYear();
  const yearMin = Number(searchParams.get("yearMin")) || min;
  const yearMax = Number(searchParams.get("yearMax")) || max;
  const yearActive = yearMin !== min || yearMax !== max;

  const groups: AnyFilterGroup[] = [
    { key: "status", label: "Status", options: STATUS_OPTIONS },
    ...(yearRange.min !== null && yearRange.max !== null && yearRange.min < yearRange.max
      ? [
          {
            type: "range" as const,
            key: "year",
            label: "Year",
            min,
            max,
            value: [yearMin, yearMax] as [number, number],
            onChange: (val: [number, number]) => {
              const params = new URLSearchParams(searchParams.toString());
              if (val[0] !== min) params.set("yearMin", String(val[0]));
              else params.delete("yearMin");
              if (val[1] !== max) params.set("yearMax", String(val[1]));
              else params.delete("yearMax");
              router.push(firstPageHref(BASE, params));
            },
          } satisfies AnyFilterGroup,
        ]
      : []),
    ...(formats.length > 1 ? [{ key: "format", label: "Format", options: formats.map((f) => ({ value: f, label: FORMAT_LABELS[f] })) }] : []),
    {
      key: "minRating",
      label: "Minimum rating",
      options: JOURNAL_MIN_RATINGS.map((r) => ({ value: String(r), label: `${formatRating(r)} and up` })),
    },
    { key: "rereads", label: "Re-reads", options: [{ value: "1", label: "Re-reads only" }] },
  ];

  function onFilterChange(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    const next = SINGLE.has(key) ? values.slice(-1) : values;
    if (next.length) params.set(key, next.join(","));
    else params.delete(key);
    router.push(firstPageHref(BASE, params));
  }

  function onClearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of PARAMS) params.delete(key);
    router.push(firstPageHref(BASE, params));
  }

  return (
    <EntityFilters
      basePath={BASE}
      sortOptions={SORT_OPTIONS}
      searchPlaceholder="Search title or author..."
      defaultSort="finished"
      defaultSortOrders={JOURNAL_DEFAULT_ORDER}
    >
      <FilterDropdown
        groups={groups}
        activeFilters={activeFilters}
        onFilterChange={onFilterChange}
        onClearAll={onClearAll}
        activeRangeCount={yearActive ? 1 : 0}
      />
    </EntityFilters>
  );
}
