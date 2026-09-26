# Task 0141: Publishers page matches the other list pages

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0125, 0129
**Blocks**: None

## Overview

SLN-328: `/publishers` was built apart from the other list pages: a plain HTML form (search only on Enter), its own styling, a plain substring search (no accents, no typos, no ranking), favourites pinned without a sort, and text links for actions.

## Implementation Details

- Page structure now matches Authors and Places: header with button-styled actions (Add Publisher, Review unmatched editions), a toolbar outside the results' Suspense boundary (keeps focus while results reload), keyed results boundary, full-page empty state only when there are no publishers, shared no-results and page-out-of-range states, top and bottom pagination.
- Toolbar: the shared `EntityFilters` (search as you type, 300 ms, URL-synced; sort buttons Best match/Name/Editions/Recent; view switch; grid size) with a `FilterDropdown` for Favourites, Type (publisher/imprint) and Country. Countries are single values split from multi-country entries ("United States; France") and sent as repeated URL params, so a name can never break the filter.
- Views: grid cards (`PublisherCard`), list rows (`PublisherListItem`) and a table (`DataTable`) with configurable columns; favourites toggle in all three. `DataTable` gains an opt-in `preserveOrder` so the table follows the toolbar sort until a header is clicked (Authors and Library tables unchanged).
- Search engine: the author engine moved to `src/lib/actions/utils/text-search.ts` (same SQL) and now also powers publishers over name and aliases: accent-insensitive, typo-tolerant, ranked. `author-search.ts` delegates to it.
- `getPublishers(options)` takes search, sort, order, favourites, kinds, countries and paging; returns parent names for imprints. `getPublisherCountries()` lists single countries.
- `buttonClass()` in `button.tsx` styles links as buttons.

## Completion Notes

- PostgreSQL tests: accents/word order/typos/aliases, ranking, favourites/type/multi-country filters, sorts (a parent counts its imprints' editions), parent names, paging totals, and author search behaviour after the engine move.
- Full suite with every database suite: 503 passed. Typecheck, lint, production compile pass.
- Browser check on a preview against live data (read-only): typing "wakefeild" finds Wakefield Press with no Enter and the box keeps focus; "bahai" finds the Bahá'í publishers; country filter; no-results keeps the toolbar; Editions sort in grid and table.
- Found, not changed: many `publishing_houses.country_id` links are wrong (92 US publishers point to "United States Minor Outlying Islands"). The page uses the country text, which is right. Filed separately.
