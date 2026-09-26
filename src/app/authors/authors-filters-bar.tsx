"use client";

import { firstPageHref } from "@/lib/utils/list-params";

import { useRouter, useSearchParams } from "next/navigation";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { EntityFilters } from "@/components/shared/entity-filters";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { ZODIAC_LABELS, ZODIAC_SIGNS } from "@/lib/utils/zodiac";
import {
  parseNationalityCodes,
  type NationalityOption,
} from "@/lib/utils/nationality-param";

/** Offered only while a search is active; it is then the default sort */
const RELEVANCE_SORT = { value: "relevance", label: "Best match" };

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "lastName", label: "Last Name" },
  { value: "recent", label: "Recent" },
  { value: "birth", label: "Born" },
  { value: "works", label: "Works" },
];

const AUTHOR_VIEW_MODES: ViewMode[] = ["grid", "list", "detailed", "map", "timeline"];

interface AuthorsFiltersBarProps {
  nationalities: NationalityOption[];
  genders: string[];
  zodiacSigns: string[];
  birthYearRange: { min: number | null; max: number | null };
  deathYearRange: { min: number | null; max: number | null };
}

/**
 * Search, sort, filter and view controls for /authors.
 * Rendered outside the results' Suspense boundary so it stays mounted (and
 * keeps focus) while results reload, and stays visible when nothing matches.
 */
export function AuthorsFiltersBar({
  nationalities,
  genders,
  zodiacSigns,
  birthYearRange,
  deathYearRange,
}: AuthorsFiltersBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isSearching = !!searchParams.get("q")?.trim();

  const [viewMode, setViewMode] = useLocalStorage<ViewMode>(
    "durtal-authors-view-mode",
    "grid",
  );
  const [gridColumns, setGridColumns] = useLocalStorage(
    "durtal-authors-grid-columns",
    5,
  );

  // --- Active filter values from URL ---
  const activeFilters: Record<string, string[]> = {
    nationality: parseNationalityCodes(searchParams.get("nationality")) ?? [],
    gender: searchParams.get("gender")?.split(",").filter(Boolean) ?? [],
    zodiac: searchParams.get("zodiac")?.split(",").filter(Boolean) ?? [],
    alive: searchParams.get("alive") ? [searchParams.get("alive")!] : [],
  };

  // Birth year range from URL
  const birthMin = birthYearRange.min ?? 0;
  const birthMax = birthYearRange.max ?? new Date().getFullYear();
  const birthYearMinParam = searchParams.get("birthYearMin");
  const birthYearMaxParam = searchParams.get("birthYearMax");
  const activeBirthRange: [number, number] = [
    birthYearMinParam ? parseInt(birthYearMinParam, 10) : birthMin,
    birthYearMaxParam ? parseInt(birthYearMaxParam, 10) : birthMax,
  ];
  const birthRangeActive =
    activeBirthRange[0] !== birthMin || activeBirthRange[1] !== birthMax;

  // Death year range from URL
  const deathMin = deathYearRange.min ?? 0;
  const deathMax = deathYearRange.max ?? new Date().getFullYear();
  const deathYearMinParam = searchParams.get("deathYearMin");
  const deathYearMaxParam = searchParams.get("deathYearMax");
  const activeDeathRange: [number, number] = [
    deathYearMinParam ? parseInt(deathYearMinParam, 10) : deathMin,
    deathYearMaxParam ? parseInt(deathYearMaxParam, 10) : deathMax,
  ];
  const deathRangeActive =
    activeDeathRange[0] !== deathMin || activeDeathRange[1] !== deathMax;

  const activeRangeCount = (birthRangeActive ? 1 : 0) + (deathRangeActive ? 1 : 0);

  // All 12 zodiac signs in canonical order, plus "Not Available"
  const zodiacOptions: { value: string; label: string }[] = ZODIAC_SIGNS.map(
    (sign) => ({ value: sign, label: ZODIAC_LABELS[sign] }),
  );
  zodiacOptions.push({ value: "__none__", label: "Not Available" });
  // Filter to only signs present in DB + __none__
  const presentSigns = new Set(zodiacSigns);
  const filteredZodiacOptions = zodiacOptions.filter(
    (o) => o.value === "__none__" || presentSigns.has(o.value),
  );

  const filterGroups: AnyFilterGroup[] = [
    {
      key: "nationality",
      label: "Nationality",
      options: nationalities.map((n) => ({ value: n.code, label: n.name })),
    },
    ...(genders.length > 0
      ? [
          {
            key: "gender",
            label: "Gender",
            options: genders.map((g) => ({
              value: g,
              label: g.charAt(0).toUpperCase() + g.slice(1),
            })),
          } satisfies AnyFilterGroup,
        ]
      : []),
    ...(filteredZodiacOptions.length > 0
      ? [
          {
            key: "zodiac",
            label: "Zodiac Sign",
            options: filteredZodiacOptions,
          } satisfies AnyFilterGroup,
        ]
      : []),
    {
      key: "alive",
      label: "Status",
      options: [
        { value: "true", label: "Alive" },
        { value: "false", label: "Deceased" },
      ],
    },
    ...(birthYearRange.min != null && birthYearRange.max != null
      ? [
          {
            type: "range" as const,
            key: "birthYear",
            label: "Birth Year",
            min: birthMin,
            max: birthMax,
            value: activeBirthRange,
            onChange: (val: [number, number]) => {
              const params = new URLSearchParams(searchParams.toString());
              if (val[0] !== birthMin) {
                params.set("birthYearMin", String(val[0]));
              } else {
                params.delete("birthYearMin");
              }
              if (val[1] !== birthMax) {
                params.set("birthYearMax", String(val[1]));
              } else {
                params.delete("birthYearMax");
              }
      router.push(firstPageHref("/authors", params));
            },
          } satisfies AnyFilterGroup,
        ]
      : []),
    ...(deathYearRange.min != null && deathYearRange.max != null
      ? [
          {
            type: "range" as const,
            key: "deathYear",
            label: "Death Year",
            min: deathMin,
            max: deathMax,
            value: activeDeathRange,
            onChange: (val: [number, number]) => {
              const params = new URLSearchParams(searchParams.toString());
              if (val[0] !== deathMin) {
                params.set("deathYearMin", String(val[0]));
              } else {
                params.delete("deathYearMin");
              }
              if (val[1] !== deathMax) {
                params.set("deathYearMax", String(val[1]));
              } else {
                params.delete("deathYearMax");
              }
      router.push(firstPageHref("/authors", params));
            },
          } satisfies AnyFilterGroup,
        ]
      : []),
  ];

  function handleFilterChange(key: string, values: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "alive") {
      // alive is a single-select: only allow one value at a time
      if (values.length > 0) {
        const last = values[values.length - 1];
        params.set("alive", last);
      } else {
        params.delete("alive");
      }
    } else if (values.length > 0) {
      params.set(key, values.join(","));
    } else {
      params.delete(key);
    }
      router.push(firstPageHref("/authors", params));
  }

  function handleClearAll() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("nationality");
    params.delete("gender");
    params.delete("zodiac");
    params.delete("alive");
    params.delete("birthYearMin");
    params.delete("birthYearMax");
    params.delete("deathYearMin");
    params.delete("deathYearMax");
      router.push(firstPageHref("/authors", params));
  }

  return (
    <EntityFilters
      basePath="/authors"
      sortOptions={isSearching ? [RELEVANCE_SORT, ...SORT_OPTIONS] : SORT_OPTIONS}
      searchPlaceholder="Search authors..."
      defaultSort={isSearching ? "relevance" : "name"}
      defaultSortOrders={{ relevance: "desc", name: "asc", lastName: "asc", recent: "desc", birth: "asc", works: "desc" }}
      viewMode={viewMode}
      gridColumns={gridColumns}
      onViewModeChange={setViewMode}
      onGridColumnsChange={setGridColumns}
      availableViewModes={AUTHOR_VIEW_MODES}
    >
      <FilterDropdown
        groups={filterGroups}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAll}
        activeRangeCount={activeRangeCount}
      />
    </EntityFilters>
  );
}
