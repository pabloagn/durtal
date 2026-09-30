# Task 0154: Library harmonization

**Status**: Completed
**Created**: 2026-09-29
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-343 adds `/harmonize`: an evidence-led workspace for catalogue cleanup across 27 entity types and 36 heuristic rules. Sidebar and command palette navigation expose the page. Categories distinguish duplicates, artwork, metadata and relationship integrity.

## Implementation Details

- Extensible entity capabilities and pure scan rules under `src/lib/harmonization`. Identity checks normalize names, diacritics, initials and recorded aliases; corroborate identifiers and book authorship; respect geography, taxonomy families, edition identity and numbered volumes. Generic collective placeholders and ambiguous suffixes do not become automatic identity matches. Non-comma author names are enforced as the canonical survivor.
- Missing covers/posters/backgrounds, existing-image reuse, identifier checksums, dates, costs/currency, hierarchy loops, series positions and links, location/shelf consistency and acquisition relationships receive explicit findings. Locked metadata requires individual review.
- Searchable, filterable two-pane queue with J/K and slash navigation, survivor selection, explicit field decisions, readable linked-reference values, merge impact, confirmation, batch fix review, dismiss/restore and downloadable before/after history. Mobile stacks the panes and collapses navigation without replacing saved desktop width.
- Merge reference discovery uses Drizzle foreign keys plus explicit polymorphic relationships. Atomic operations union junctions, retain editions/copies and acquisition history, preserve media and redirect old bookmarks. Paired metadata, map coordinates and image/thumbnail fields stay together. Original records and linked rows are archived in the same transaction.
- Snapshot checks under ordered locks reject stale requests; unknown future database references fail closed. Colliding active acquisition targets require reconciliation. Editions, individual copies and orders remain distinct and receive manual review. No remote artwork lookup or automatic merge.
- Drizzle migration `0032_harmonization` adds decisions, audit and redirect tables, with narrowly audited acquisition/publisher guard exceptions and final compatibility checks. Applied successfully to the configured database. `docs/02_DATA_MODEL.md` updated.

## Completion Notes

- Full unit suite: 488 passed; database-dependent suites are skipped unless explicitly configured.
- Harmonization suite: 44 pure rule/planning tests and 21 isolated PostgreSQL integration tests passed. Integration cases cover linked-record preservation, competing merges, changed snapshots, rollback after a late trigger failure, future unknown FKs, cancelled orders, provenance, locations, collections, taxonomy, redirects and forged fix inputs.
- Typecheck and targeted ESLint passed. Browser interaction QA covered filtering, author conflict selection, confirmation, batch selection, mobile overflow and alignment. Measured desktop and mobile icon alignment has zero deviations over 0.5px.
- Temporary alignment instrumentation removed after verification. Existing concurrent author-picker/book-editing changes were preserved. Development did not confirm cleanup mutations in the live catalogue.
