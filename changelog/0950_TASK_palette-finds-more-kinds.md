# Task 0950: The palette finds series, collections, recommenders and taxonomy

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Typing a series, a collection, a recommender or a taxonomy item (a subject, a movement, a custom family's item) in the command palette found nothing, so the only way to one of their pages was through its list. The palette now searches them with the rest and opens the page. Fixes SLN-966.

## Implementation Details

- `src/lib/actions/quick-search.ts`: four more searches run alongside the others, each limited to the palette's per-kind count and ranked as the rest are (`search_normalize`, so accents and case are ignored).
  - Series, collections and recommenders match their name, word prefixes and close spellings, and open `/series/{id}`, `/collections/{id}` and `/recommenders/{id}`.
  - Taxonomy reads every system family's table through the taxonomy registry, plus `custom_taxonomy_items`, in one query, and keeps only families that apply to a kind the palette shows. Each item opens `/taxonomy/{family}/{slug}` and names its family beside it. It matches whole words and prefixes only: a typo measured against every item of every family took 75 ms a keystroke at 7,000 items, against 28 ms for whole words.
- `src/components/layout/command-palette.tsx`: the four groups show after Places, each with its section icon; the first result may be one of them when nothing above matched.
- No schema change.
- Tests: `src/__tests__/integration/quick-search.test.ts` (series, collection, recommender, a system and a custom taxonomy item, and a family that applies to no kind left out) and `src/__tests__/ui/palette-record-groups.test.ts`.

## Completion Notes

Checked on a production build with the large seed and a series, a collection, a recommender, a subject and a custom item added, in headless Chromium, Firefox and WebKit at 1440 and 390: each search shows its group, Enter opens the right page, and the alignment audit finds no deviation. Timings on a local PostgreSQL 16 with 1,000 series, 1,000 recommenders, 300 collections and 7,000 taxonomy items: series 14 ms, taxonomy 28 ms. Page weight within budget. `pnpm test`: 6,743 passed; the quick-search database suite passes locally.
