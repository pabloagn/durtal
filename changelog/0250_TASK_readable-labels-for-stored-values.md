# Task 0250: Readable labels for stored values

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-400. The book page, author pages, author cards and the activity list
showed stored values as the database holds them: language codes ("en"),
status keys ("on_order"), source keys ("isbndb", "phantom_canon") and
official country names ("United Kingdom of Great Britain and Northern
Ireland"). They now show readable labels.

## Implementation Details

- `src/lib/utils/labels.ts` (new, pure): `catalogueStatusLabel` and
  `priorityLabel` (from `STATUS_CONFIG` / `PRIORITY_CONFIG`),
  `metadataSourceLabel` ("isbndb" → "ISBNdb"), `enumLabel` for other keys
  ("lent_out" → "Lent out", "ebook" → "E-book") and `countryDisplayName`
  (English name of the ISO code: "GB" → "United Kingdom", else the official
  name before its comma). Languages keep `languageName`
  (`src/lib/utils/language.ts`); bindings keep `bindingLabel`.
- Book page: header chips, Details, Links ("Metadata from ISBNdb"), order
  status and acquisition method in the record, copy format, condition,
  status (badge and status menu) and acquisition type.
- Activity: language, status, priority and gender changes use the labels;
  the value chips no longer use the code font.
- Author page: short country name in the header, official name as its
  tooltip; gender moves from the header to the record panel; metadata
  source and contributor roles use labels.
- Author cards, list, timeline and home page: short country name. The
  author queries now also select `countries.alpha2`.

## Completion Notes

No schema, route or data change. New unit test:
`src/__tests__/utils/labels.test.ts`. Checks: typecheck, lint, `pnpm test`
and the full DB suite (`scripts/qa/test-local.py`, 1493 tests) pass. On
`next dev` at 1440×900, the book page, Borges, `/authors?nationality=GB` and
`/` show no snake_case or lowercase key as text; all 48 British author cards
show "United Kingdom" without truncation. `alignment-audit.js`: no issues on
the four pages. `design-audit.js`: no low-contrast or unnamed controls; the
one nested control (Export inside Export) is in the export menu, which this
change does not touch.

Overlaps open PRs on shared files (#3, #6, #7, #11, #23, #26, #28, #29, #31);
the edits here are limited to the lines that render the stored values.
