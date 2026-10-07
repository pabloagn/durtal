# Task 0362: Bulk Mark as read, the reading tracker checks and the feedback helpers

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0302, 0306, 0307, 0314
**Blocks**: None

## Overview

SLN-463, book enrichment 3/13, PR 1 (parts 1, 2, 4 and 5). On 4 Oct the agent
recommended The Brothers Karamazov, which Joris had read: Durtal knew nothing
of what he had read. The reading tracker (SLN-442) now holds every reading.
This PR checks what the tracker gives the enrichment epic, adds a bulk "Mark
as read" so his owned books get a read status fast, and adds the feedback
helpers that SLN-471 and SLN-472 use. Part 3 (his StoryGraph answers as
claims) follows in PR 2, changelog 0363.

## Implementation Details

### Part 2: bulk Mark as read

- **Action** `markWorksRead({ workIds, confirmDuplicates? })` in
  `src/lib/actions/reading-bulk.ts`. The input schema (`markWorksReadSchema`,
  `src/lib/validations/reading.ts`) is strict: 1 to 1000 UUIDs, confirmed ids
  only from the selection, and any other key (`source`, `sourceKey`) is
  refused before any database call. Then `requireBookWorks`.
- A book being read or paused (`readingStateSql`) gets no row and is reported:
  "being read: finish it on the book page".
- Every other book gets one finished reading, both dates unknown, through
  `writeReadings(rows, { source: "manual" })`, with no source key. The format
  is the one all its copies that are not deaccessioned read in
  (`formatOfCopies`, built on `formatOfCopy`), else print.
- A possible duplicate (`duplicateVerdicts`: a book already read gives an
  undated finished row "Undated read") is reported with the read it matches,
  and written only when Joris confirms that book (`allowPossibleDuplicate` on
  that row alone). This PR adds no duplicate rule.
- The rows go 100 at a time, one `writeReadings` call (one `atomic`) each.
  When a call fails, the earlier ones stay written and recorded, and the error
  says how many: "Marked 100 before an error. Mark the same books again for
  the rest." The same selection again writes the rest, and the books written
  before come back as possible duplicates.
- Up Next is left as it is, as Log a past read leaves it: `writeReadings`
  takes a book off Up Next only when an open reading starts it, so a planned
  re-read stays queued.
- `work.reading_finished` (`past: true`) is recorded for each reading written,
  after its commit. `CACHE_TAGS.works` and `CACHE_TAGS.reading` are
  invalidated.
- **Undo** `undoMarkWorksRead({ readingIds })`, same file, strict schema. The
  toast's Undo sends the ids one call returned. It deletes only those
  readings, only while each is as written: source `manual`, no source key,
  finished, both dates unknown, `updated_at = created_at` and no session (the
  import undo's rule, SLN-450). The check is repeated inside the delete, 100
  at a time, each in `atomic` inside `withReadableErrors`. A reading changed
  since is kept and reported: "it changed since it was marked" or "a session
  was logged since". `work.reading_deleted` is recorded for each reading
  removed.
- **Toolbar** (`bulk-action-toolbar.tsx`): a Reading menu after Rating, with
  "Mark as read". The bar already wraps onto a second row and stays inside the
  screen (SLN-452), so no folded Edit menu is needed.
- **Dialog** (`mark-read-dialog.tsx`): a confirm, then the counts ("Marked 3 ·
  1 possibly read already · 1 left out"), each possible duplicate with its
  match ("already read: finished 14 Apr 2019") and a Confirm for that book
  alone, and each book left out with its reason. The toast's Undo removes the
  reads of that write.

### Part 4: feedback helpers

`recommendation_feedback`, `FEEDBACK_REASONS` and its merge case exist since
0073 (SLN-457). This PR adds no table, no migration and no merge case, and
writes no feedback row. `src/lib/enrichment/feedback.ts`:

- `FEEDBACK_REASON_DIMENSIONS`: too long and too short point at `pages`,
  `prose` at `prose`, `genre` at `speculative_level`, `too_popular` at
  `popularity` (vocabulary v1's keys, its section 8); the other codes point at
  none. Until 2/13's v1 seed lands, the unit test checks the four keys
  against a list in the test.
- `feedbackExclusionCondition(workIdSql, today)`: the SQL twin of
  `hiddenByFeedback`. It hides Never, Not for me, and a Not now whose day is
  after `today` or that has no day.
- `feedbackPausedAuthorCondition(workIdSql, today)`: the SQL twin of
  `pausedAuthors`. Two Not for me books by one writer within 30 days
  (`AUTHOR_PAUSE_DAYS`) pause the writer until 30 days after the second.
- The database suite runs each helper and its TypeScript twin on the same
  rows, with the engine's own loader (`loadBooks`), and expects the same books.

### Part 1: what the reading tracker gives the epic

| Sub-issue | Check | Result |
| -- | -- | -- |
| SLN-444 | An undated finished row for a book already read is `possible_duplicate`, and written only with `allowPossibleDuplicate` | Passes: `reading.test.ts:626-627`, and this PR's suite through `markWorksRead` |
| SLN-444 | `tasteRatingSql` ignores a rating on a book with no finished reading | Passes: `reading-suggestions.test.ts:136` |
| SLN-444 | The seed-priority count and Joris's answer are on record | The count is on record (changelog 0302: 47 seed books with a rating equal to their priority and no reading). Joris's answer is not on record: SLN-444 has no comment, and 0302 says "The question went to Joris". Left open; passed to the coordinator |
| SLN-446 | Clear on a selection sets `works.rating` to null | Passes: Clear rating calls `updateWork(id, { rating: null })` for each book, and `rest-write-routes.test.ts:278-284` shows a null rating clears `works.rating` |
| SLN-447 | Finish, Abandon and Log a past read work on a book with no copy and on one with several | Passes: added to this PR's suite |
| SLN-449 | `GET /api/works?reading=unread&holding=owned` returns the unread books he owns, with a matching `total` | SLN-449's route test (`reading-library.test.ts:245-254`) has a book whose only copy is deaccessioned but no unread book with no copy, so this PR's suite adds the case: an owned unread book is returned, and a read one, an unread one with no copy and an unread one whose only copy is deaccessioned are left out; `total` is 1 |
| SLN-450 | Importing the same file twice writes nothing | Passes: `reading-import.test.ts:283-288` |
| SLN-450 | A StoryGraph row keeps its moods, pace, content warnings and tags in `reading_import_rows.data` | Passes: one assertion added to the StoryGraph import test (`reading-import.test.ts:220-221`) |
| SLN-454 | The reader's finish and the backfill | Not merged yet (it waits on SLN-489); passed to the coordinator |
| SLN-457 | `recommendation_feedback` matches SLN-442's definition | Passes: id; `work_id` unique, on delete cascade, `book_parent_required`; the verdict, source and reason lists; note at most 500; `until`; `created_at`, `updated_at` (migration 0073, `src/lib/db/schema/readings.ts`) |

### Part 5: coverage report, before

Read-only counts, plain SELECTs on a local restore of
`live-before-0078-20261007-033858.dump`. The "after" counts come from a fresh
dump once Joris has marked his books.

- Owned books (`ownedBookCondition`): 212. By reading state: 211 unread, 1
  reading, 0 paused, 0 read, 0 abandoned. Readings of owned books by source:
  1 manual.
- Owned books whose rating is taste evidence (`tasteRatingSql`): 0. Owned
  books rated with no finished reading: 14, which is every rated owned book.
- The six 5-star books: 2666, Blindness, Maldoror (the Complete Works
  edition) and Satantango are owned, rated 5, with no finished reading. House
  of Leaves is owned with no rating and no reading. Blood Meridian is not
  owned and is rated 5, with no reading. None is taste evidence yet.
- StoryGraph: no StoryGraph import exists, so there are no claims to propose
  and no values to map. Feedback rows: 0.
- SLN-471's replay preconditions both fail. Kaputt is owned but has one
  reading (open). The Brothers Karamazov is owned but has no finished
  reading. This PR writes neither; Joris was told through the coordinator.

## Completion Notes

- Tests: unit `src/__tests__/reading/mark-read.test.ts` (19: both actions
  refuse a bad id, an empty or oversized list, a `source`, a `sourceKey`,
  unknown keys and a confirmed book outside the selection, before any database
  call; the format rule; `FEEDBACK_REASON_DIMENSIONS`). Database suite
  `src/__tests__/integration/personal-signals.test.ts` (8: three books marked
  at once; a possible duplicate written only when confirmed, and marking again
  writes nothing; 150 books with the second chunk made to fail, then the rest;
  the undo keeping a reading edited since and one with a session, and never
  touching a read logged on its page; SLN-447's copies check; the owned and
  unread route; each feedback helper against its engine twin).
  `markWorksRead` is in the book-only mutations of
  `book-domain-isolation.test.ts`.
- Page weight, production build on the dump: `/library` is 300 of 300 KB
  before (main, d9f81a91) and after; it passes and is unchanged, since the
  toolbar renders only with a selection. SLN-524 (PR #142) trims the page.
- Browsers: headless Chrome, WebKit and Firefox (WebKit in place of Safari, by
  the house rule), compiled CSS, `/library` on the dump with three books
  selected, one of them already read. At 1440, 768 and 390 px, with the
  toolbar open, the Reading menu open, the Mark as read dialog, and its result
  listing the possible duplicates: `alignment-audit.js` finds 0 deviations
  over 0.5 px, and `design-audit.js` finds 0 low contrast and 0 unnamed or
  nested controls, in every browser. With the selection open,
  `overflow-audit.js` gives overflow 0 and no offenders at 375, 390, 768 and
  1024 px in all three. `phone-audit.mjs` and `interaction-audit.mjs
  --disposable` pass on `/library`.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
  `pnpm test`: 170 files passed, the database suites skipped as designed.
- `scripts/qa/test-local.py`: 254 files, 2,839 tests, all passed.
