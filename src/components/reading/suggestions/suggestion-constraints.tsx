"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import { suggestionQuery, type SuggestionParams } from "@/lib/reading/suggest/params";

const BASE = "/reading/suggestions";

const SCOPES = [
  { value: "owned", label: "Owned" },
  { value: "next", label: "Up Next" },
  { value: "wanted", label: "Wanted" },
  { value: "all", label: "All" },
] as const;

const LENGTHS = [
  { value: "short", label: "Under 200 pages" },
  { value: "medium", label: "200 to 400 pages" },
  { value: "long", label: "Over 400 pages" },
];

/** One choice only in these groups: a new tick replaces the old one */
const SINGLE = new Set(["length", "lang", "home", "noNewSeries"]);

/**
 * The suggestions' constraints (SLN-457), all in the URL: the scope, then
 * length (or "about N pages"), the language read, at hand in a home, work
 * types to leave out, and books that start a new series. Filters, not scores.
 */
export function SuggestionConstraints({
  params,
  languages,
  homes,
  workTypes,
}: {
  params: SuggestionParams;
  languages: { value: string; label: string }[];
  homes: { value: string; label: string }[];
  workTypes: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [about, setAbout] = useState(params.length === "about" && params.about ? String(params.about) : "");
  const go = (next: Partial<SuggestionParams>) => router.push(`${BASE}${suggestionQuery({ ...params, page: 1, pick: undefined, ...next })}`);

  const active: Record<string, string[]> = {
    length: params.length !== "any" && params.length !== "about" ? [params.length] : [],
    lang: params.lang ? [params.lang] : [],
    home: params.home ? [params.home] : [],
    skipTypes: params.skipTypes,
    noNewSeries: params.noNewSeries ? ["1"] : [],
  };
  const groups: AnyFilterGroup[] = [
    { key: "length", label: "Length", options: LENGTHS },
    ...(languages.length > 1 ? [{ key: "lang", label: "Language read", options: languages }] : []),
    ...(homes.length ? [{ key: "home", label: "At hand in", options: homes }] : []),
    ...(workTypes.length ? [{ key: "skipTypes", label: "Leave out", options: workTypes }] : []),
    { key: "noNewSeries", label: "Series", options: [{ value: "1", label: "Leave out books that start a new series" }] },
  ];

  function change(key: string, values: string[]) {
    const value = SINGLE.has(key) ? values.filter((v) => !active[key].includes(v)).slice(-1) : values;
    if (key === "length") go({ length: (value[0] as SuggestionParams["length"]) ?? "any", about: undefined });
    else if (key === "lang") go({ lang: value[0] });
    else if (key === "home") go({ home: value[0] });
    else if (key === "skipTypes") go({ skipTypes: value });
    else if (key === "noNewSeries") go({ noNewSeries: value.length > 0 });
  }

  function applyAbout() {
    const n = Math.round(Number(about));
    if (about.trim() && n >= 20 && n <= 5000) go({ length: "about", about: n });
    else if (!about.trim() && params.length === "about") go({ length: "any", about: undefined });
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3" data-suggestion-constraints="">
      <SegmentedControl options={[...SCOPES]} value={params.scope} onChange={(scope) => go({ scope })} ariaLabel="Which books" />
      <label className="flex items-center gap-2 text-xs text-fg-secondary">
        About
        <input
          type="number"
          inputMode="numeric"
          min={20}
          max={5000}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          onBlur={applyAbout}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyAbout();
          }}
          placeholder="500"
          aria-label="About this many pages"
          className="h-8 w-20 rounded-sm border border-glass-border bg-bg-secondary px-2 text-sm text-fg-primary tabular-nums placeholder:text-fg-muted pointer-coarse:h-11 pointer-coarse:text-base"
          data-suggestion-about=""
        />
        pages
      </label>
      {/* At the right end, so its panel (anchored right) opens over the bar, also on a phone */}
      <div className="ml-auto">
        <FilterDropdown
          groups={groups}
          activeFilters={active}
          onFilterChange={change}
          onClearAll={() => go({ length: "any", about: undefined, lang: undefined, home: undefined, skipTypes: [], noNewSeries: false })}
        />
      </div>
    </div>
  );
}
