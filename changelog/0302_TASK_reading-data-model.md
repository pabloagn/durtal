# Task 0302: Reading tracker data model, rules and services

**Status**: In Progress
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: Reading tracker steps 2 to 15 (SLN-442)

## Overview

Step 1 of 15 of the reading tracker (SLN-442, sub-issue SLN-444). A book gets
readings: one read-through each, with its own dates, edition, copy, sessions,
rating and review. Reading is book-only consumption state. It never reuses
`catalogue_status`, which is about buying. No page changes in this step except
the book delete confirmation, which now names the reading history it deletes.

## Implementation Details

- Schema: `readings`, `reading_sessions` and `reading_status_history`
  (`src/lib/db/schema/readings.ts`). One open reading per book
  (`reading_open_unique`). One running timer (`reading_session_timer_unique`).
  `reading_sessions.pages_read` is generated.
- `works.rating` becomes `numeric(2,1)` with half steps (`works_rating_check`).
  Raw SQL that selects it casts to `float8`: film, perfume and painting cards,
  and the publisher book cards.
- Migrations: a custom pre-check that stops on a rating outside 1 to 5 and names
  the work, then the generated schema with the guards appended:
  `public.reading_period_end`, `reading_dates_check`, `book_parent_required` on
  `readings`, `reading_guard` and `reading_session_guard`. The guards let an
  update that only sets references to null go through, so deletes of an
  edition, a copy or a place need no code change.
- Pure modules in `src/lib/reading/`: `constants.ts` (statuses, formats,
  transitions), `dates.ts` (reading day with a 04:00 day start, imprecise
  dates), `positions.ts` (share of the work, remapping, one progress input),
  `source-keys.ts` (import and seed keys, checked against a fixture built by an
  independent Python reference), `duplicates.ts` (the one duplicate rule),
  `summary.ts` (SQL fragments: state, read count, ordinal, counted pages,
  taste rating).
- `src/lib/reading/service.ts`: every reading write goes through it. Each write
  reads, computes, then runs one atomic batch that locks the reading and
  asserts its fingerprint. `recordProgress` without a fingerprint retries once.
  `writeReadings` writes at most 100 rows per atomic and is idempotent by
  source key.
- Page actions in `src/lib/actions/reading.ts`, validation in
  `src/lib/validations/reading.ts`, history entries in
  `src/lib/activity/event-config.ts` (progress once per reading day).
- Other code: a book merge refuses two open readings; `updateEdition` clears a
  moved edition from the old book's readings; `moveToExistingEdition` carries
  readings and sessions to the real edition.
- Delete confirmation: `workDeleteCascadeMessage` in
  `src/components/books/delete-cascade.ts`, with counts from
  `getReadingCounts`. The bulk dialog names the reading history.
- `scripts/ingest/seed_books.py` no longer writes Priority into `works.rating`.
- Docs: 00, 02, 06, 09 and 14.

## Completion Notes

- Tests: TODO
- Rehearsal: TODO
- Suspect seed ratings: TODO
- Browser audits: TODO
