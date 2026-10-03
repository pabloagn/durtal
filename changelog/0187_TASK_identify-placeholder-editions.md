# Task 0187: Identify placeholder editions

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0170, 0179, 0184
**Blocks**: None

## Overview
Step 4 of the publishing house and editions proposal. The old import left 222 placeholder editions (metadata source `phantom_canon`): no ISBN, no publisher, no cover. 99 of them hold copies, 46 sit in collections, and 9 belong to books that already have an identified edition. Placeholders now show "Edition not identified", and a queue identifies them one at a time from ISBNdb: pick one of the best editions, and the copies stay attached.

## Implementation Details
- `/library/identify` (`src/app/library/identify/page.tsx`, `src/components/books/identify-queue.tsx`): one placeholder at a time, books with copies first. The book (poster, authors, status, copies with locations, collections, the house it already links to), the book's identified editions, and the best 3 ISBNdb editions (up to 12 on demand) with cover, publisher, year, format, pages, language, ISBN and notes. Pick saves at once, with Undo in the message. Skip, "No ISBN: keep it as it is" (with Undo), "Other sources" (Match), "Open the book". The next book's search loads in the background.
- Ranking (`src/lib/match/identify.ts`, pure): drops results without a valid ISBN, results whose title and authors both differ (kept with notes when the reader typed the ISBN), and ISBNs another edition holds. Ranks by title, author, language, format (print first, e-books first only when every copy is digital, audiobooks last), the house the placeholder already links to (same house, same group, or "Not Vintage"), cover, publisher and page count.
- Actions (`src/lib/actions/identify.ts`): `getIdentifyQueue`, `findEditionCandidates` (50 ISBNdb results per search, or one lookup for a typed ISBN), `identifyEdition` (placeholders only; every field Match would tick, through the shared `saveMatch`; a cover that cannot be downloaded is left out), `keepWithoutIsbn` (metadata source `manual`), `undoIdentification` (refused when the edition changed after it; removes an uploaded cover from S3), `moveToExistingEdition` (copies and collection memberships move to the book's identified edition, the empty placeholder is deleted, one transaction; refused when anything else refers to the placeholder).
- `src/lib/match/save.ts`: Match's load, plan and save moved out of the server action file, so Match and the queue share one guarded save. `applyMatch` behaves as before.
- Edition card: "Edition not identified" badge with an "Identify" link; bindings show their label. Library header: "Identify editions".
- Activity: `work.match_undone`, `work.edition_kept_without_isbn`, `work.placeholder_replaced`.
- No schema change. Docs: `docs/02_DATA_MODEL.md` (metadata source values), `docs/04_ROUTES_AND_VIEWS.md`, `docs/06_SERVER_ACTIONS.md`.

## Completion Notes
- Tests: 12 unit tests (`src/__tests__/utils/identify-candidates.test.ts`); 3 PostgreSQL tests in `publishers.test.ts` (identify in place with copies kept and undo, keep without ISBN and undo, move to the identified edition and the refusals). Full suite on a disposable database: 1206 passed.
- Browser check on a private copy of live (no S3 keys, so no cover was written): 2666 picked and undone; the house the reader set ("Vintage") shows, and other houses get "Not Vintage"; Ice's placeholder copy moved to its Pushkin Press edition and the placeholder was removed; a typed ISBN of another book shows with "Another title", "Another author" and "Pick anyway". The alignment audit finds nothing on the queue page and the library header.
- ISBNdb text search does not match publisher names, and some editions (2666 in UK Vintage) are not in its first 50 results. For those, type the ISBN or use "Other sources".
