# Task 0129: Shared pagination

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-313 replaces duplicated previous/next footers with shared pagination and safe URL handling. All links preserve current query parameters, including publisher filters.

## Implementation Details

- Shared numbered links, first/last, stable disabled endpoints, page jump, range summaries, 24/48/96/192 page sizes and per-list remembered preferences. Compact controls above lists; full controls below. Mobile controls collapse to previous/current/next with a jump input.
- Keyboard paging outside interactive fields, labelled navigation/current page/focus styles, real Next links and list-position scrolling after streaming finishes.
- Shared integer parsing prevents negative/non-finite/overflowing SQL offsets. Out-of-range database pages redirect to the last page; already-loaded collections clamp before slicing. Search/sort/filter changes share the first-page helper.
- Applied to library, authors, places, reader, publishers, series, collections, author works, taxonomy items/works, and acquisition history. Map/timeline modes and activity cursor loading remain unchanged.
- Series/collections now query counts and bounded rows in parallel. Existing database lists retain parallel count/page queries. Stable ID tie-breakers avoid ambiguous page boundaries.
- Taxonomy paginates flattened visible rows after building the full tree and keeps the complete reorder ID sequence. Author-detail/taxonomy work lists paginate data already loaded for the parent view.
- Acquisition history uses the existing order timeline query below the active pipeline.

## Completion Notes

- 32 new helper tests include malformed values, framework search-param proxies, repeated/unknown query parameters, filter preservation, page ranges and empty/out-of-range collections.
- Full default suite: 340 passed, 43 opt-in database tests skipped. Typecheck, full lint and diff checks passed.
- Read-only browser checks against existing catalogue: jump directly to author page 30; switch 24 to 96 and reset to page one; return to Authors and restore 96; preserve US nationality and last-name sort when paging; list anchor rests 16 px from the top.
- HTTP checks cover zero/negative/non-numeric/out-of-range pages across library, authors, places, reader, publishers, series, collections and provenance. No failed queries or NaN pagination.
- Browser checks used the existing catalogue read-only, not a local database copy. Full phone-shell layout is still the separate SLN-312 issue; no claim of end-to-end phone validation.
- No migration, new dependencies or catalogue mutations.
