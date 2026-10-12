# Task 0455: All highlights page

**Status**: Completed
**Created**: 2026-10-12
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0451
**Blocks**: None

## Overview

SLN-500: the reader's annotations panel links "All highlights" to `/ebooks/highlights`, which did not exist (404). This adds the page: every live highlight, note and bookmark across the e-books, grouped by e-book, and each mark opens the reader at its place.

## Implementation Details

- `src/lib/ebooks/highlights.ts`: the URL contract (`q`, `color`, `kind`, `ebook`, `sort`, `order`, `page`, `perPage`) and three queries. The groups query pages books (not marks), the newest-marked book first or by `title_sort`, each with its five newest marks (500 when filtered to one book). Search uses `ebook_annotations_search_idx` (0083) on the text and note, without accents or case. Deleted marks never show or count.
- `src/app/(catalogue)/ebooks/highlights/`: the page (summary line, groups, pagination, empty and no-results states) and its filters (search, Kind, Colour, eBook, Newest/Title sort) on the shared `EntityFilters`.
- `src/components/ebooks/highlight-group.tsx`: one book's block, `SectionHeading` with the cover, title, count and authors; each mark with its colour bar, text in `Prose`, note, place line and "Open in the reader".
- The reader takes `?at=<mark id>`: once the book is painted and its controllers are ready, `useReaderAnnotations` resolves the mark and jumps to it, or says it is gone or could not be placed. `returnTo` brings Back to the same list page.
- `ebookSummaryColumns` and `normalizedDates` are exported from `library-queries.ts` so the groups carry the same card data as `/ebooks`.
- The eBooks page menu has a Highlights item. `scripts/qa/page-weight.json` budgets the page at 300 KB and 800 ms. `docs/04_ROUTES_AND_VIEWS.md` describes it.

## Completion Notes

- Tests: `src/__tests__/ebooks/highlights-params.test.ts` (URL contract, reader link), `src/__tests__/integration/ebook-highlights.test.ts` (grouping, ordering, per-book listing, accent-free search, colour/kind filters, title sort, paging, deleted marks, book choices) against a disposable PostgreSQL, and `src/__tests__/reader/open-at-mark.test.ts` (jump, unplaceable, deleted, waiting for the first sync).
- The reader waits for the first sync of marks (the controller's cursor) before saying a mark is gone: in a fresh browser the local store is empty at first, so the first check in the browser said "no longer in this book" for a mark that existed.
- Browser checks on a preview with nine seeded marks in three e-books: the alignment, design, overflow and touch audits pass in Chrome, Firefox and WebKit at 1440, 768 and 390px on the list, one book, a search with no result and a filtered title sort (36 of 36). In headless Chrome, "Open in the reader" opened the EPUB fixture at its chapter 3 highlight with "Back to p. 2"; an unplaceable mark and an unknown id each showed their notice.
- The mark rows first used `content-visibility: auto`; the design audit then found off-screen "Open in the reader" links without a name, so it was removed.
- No migration, no new package.
