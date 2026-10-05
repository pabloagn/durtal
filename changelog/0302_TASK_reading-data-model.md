# Task 0302: Reading tracker data model, rules and services

**Status**: Completed
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

- Tests: `src/__tests__/reading/` (positions, dates, source keys against the
  fixture, duplicates): 33 unit cases, and `delete-cascade.test.ts`. The
  database suite `src/__tests__/integration/reading.test.ts` (36 cases) covers
  every case of the spec: books only, the guards, deletes of an edition, a
  copy, a place and the book, open readings and ordinals, the constraints and
  `reading_period_end`, half-step ratings and number types from the film,
  perfume, painting and publisher cards, start positions, progress, going
  back, undo, finish and the closing session, reopen with the book's rating,
  mixed formats, edition switches, totals, the running timer, time zones,
  fingerprints and the retry under concurrency, `writeReadings` (250 rows in 3
  atomics, idempotent, duplicates, book rating), source keys, delete and
  restore, session edits, history entries, merges, `updateEdition` and
  `moveToExistingEdition`. `work-kind-migration.test.ts` checks the pre-check
  on a rating of 0 and the rating type; `book-domain-isolation.test.ts` covers
  the new tables. Full suite (`test-local.py`): 160 files, 1862 of 1866 on
  the first run; the 4 failures were older tests that read the rating as a
  whole number (`book-saves`, `book-links-migration`, `publisher-migration`),
  updated for the half-step type and then 8 of 8. `pnpm typecheck` clean;
  `pnpm lint` 0 errors, 82 warnings, none in this change's files;
  `pnpm deadcode` clean.
- Source keys: one prefix table. No Calibre key: `readerReadingKey(ebookId)`
  takes the reader's own e-book id (opaque, trimmed, non-empty).
- Rehearsal (`--from-dump` of `live-before-0060-20261004-222648.dump`, pending
  0060 from main and the two reading migrations): migrations apply cleanly;
  110 tables, 21,513 rows, 1 table with differences: `works`, 71 removed and 71
  added (the 71 rated works, `'4'` now `'4.0'`). The three new tables are
  empty. `select count(*) from rehearsal_before.works b join public.works w
  using (id) where b.rating::numeric is distinct from w.rating` returns 0.
- Suspect seed ratings: 47 seed books have a rating equal to their acquisition
  priority (5 urgent, 4 high, 3 medium) and no reading. Samples (rating,
  priority): Amalgamemnon (4, high), Baumgartner (3, medium), Berlin
  Alexanderplatz (4, high), Day (4, high), Discipline and Punish (4, high),
  Don't Look Now and Other Stories (3, medium), Down Below (4, high),
  Hopscotch (4, high), House of Leaves (5, urgent), In the Realms of the Unreal
  (4, high). The question went to Joris; this PR changes no rating.
- Browser, same preview with two readings and three sessions on 2666: the book
  delete dialog reads "This will also delete 1 edition, 2 instances and 2
  readings (3 sessions)."; the bulk dialog names the reading history.
  `alignment-audit.js` and `design-audit.js` at 1440, 768 and 390 px in Chrome,
  Firefox 157 and Safari 26 find nothing new: every finding is the same on main
  (the related carousel arrows at 390 px, Safari's title-row icons 0.55 px off
  the 46 px heading, decorative 38 px cover initials under the dialog veil).
  `phone-audit.mjs`: the book page is 8 px wider than 375 and 390 px on main
  too (the ambient crystals layer). `interaction-audit.mjs --disposable`: no
  failures. `page-weight.js` before and after: the same, with `/library` at
  304 of 300 KB on main; the book page HTML grows by 56 bytes.
