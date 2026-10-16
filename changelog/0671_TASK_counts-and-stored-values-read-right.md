# Task 0671: Counts and stored values read right

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-857, from `findings/wording-survey-2026-10-15.md`, sections 1 to 4. Sentence case (section 5) is left to the Escape cancels everywhere sweep.

- **Plurals.** A stats bar chart's screen-reader summary put the unit once, after the last bar: "Books finished by month: Jan 0, Feb 1, ... Dec 0 books". Eight count templates never went singular ("1 works", "1 new authors", "1 minutes", "1 readings"). The rating charts' captions read "1 stars".
- **Numbers.** Harmonize read "Show 60 more · 3654 remaining", and offered 60 more when fewer were left. Four page-count messages left their thousands ungrouped ("1200 pages").
- **"0 pp."** The Add book confirm step showed a page count of "0", typed as text, as "0 pp.".
- **Pager and raw counts** (item 7, `findings/counts-survey-2026-10-16.md`). The pager never went singular: "Showing 1–1 of 1 publishers", "of 1 names". Six counts printed raw: the organization role chips ("All 1081"), Harmonize's tabs ("To resolve 5923") and impact rows, a location's item count, the selection toolbar ("1200 selected") and an edition's page count and limited-edition size.
- **Stored values.** Settings > About showed the migration's file name ("0088_ebook_upload"). Reader history recovery showed an operation's stored status ("pending"). A copy's location picker read "Study (physical)".

## Implementation Details

- `src/lib/utils/format.ts`: `countLabel(count, one, many?)`, "1 book", "1,107 books", grouped with `toLocaleString("en")`.
- `reading/charts/bar-chart.tsx`: the summary joins each bar's own caption with "; " ("January 2026: 0 books; ... August 2026: 1 book"), which already has its noun in the right form. The `summaryUnit` prop goes, with its eight callers on `/reading/stats` and `/statistics`.
- The rating charts there say "1 star".
- `countLabel` in `review-bulk-dialog.tsx`, `authors-map.tsx`, `series/suggestions/page.tsx` (with "1 book matches"), `merge-dialog.tsx`, `add-to-collection-dialog.tsx`, `bulk-action-toolbar.tsx`, `reading-settings.tsx`, `reader-history-recovery.tsx`, and for the page counts in `note-dialog.tsx`, `identify-queue.tsx`, `edit-reading-dialog.tsx` and `lib/actions/reading.ts` (the page a reader is on is grouped too).
- `harmonize/workspace.tsx`: "Show {the smaller of 60 and what remains} more · {remaining, grouped} remaining".
- `library/new/steps/confirm-step.tsx`: a count shows only when it is a number above 0, as "320 pages", the app's word elsewhere.
- `settings/about/page.tsx`: "Latest migration" shows the number alone ("0088").
- `reader-history-recovery.tsx`: "Not finished", "Complete" or "Undone".
- `books/instance-form.tsx`: "Study, physical".
- `shared/pagination.tsx`: `pagerNoun(noun, total)` says the one form for a total of 1: the plural without its "s", or "person", "series" and "quote or note". Every caller already passes a plural, so none changes.
- Grouped with `toLocaleString("en")`: `organization-filters.tsx` role chips; `harmonize/workspace.tsx` tabs, "Ready to fix" and the impact rows, and "1 linked record will be transferred" through `countLabel`; `locations/location-card.tsx` (`countLabel`); `shared/selection-toolbar.tsx`; `edition-detail-card.tsx` pages and limited-edition size.

Not changed, already right on main: the command palette's venue type goes through `VENUE_TYPE_LABELS`; an e-book file's state is worded by its page ("Verified 2026-10-01", "Missing from storage"); the perfume source lookup's kind is already "Brand", "Manufacturer" or "Perfumer".

## Completion Notes

- **Tests:** new `ui/count-wording.test.ts` checks `countLabel` and each fixed spot. `ui/reading-stats.test.ts` now expects the summary from each bar's caption, and `ui/review-bulk.test.ts` "1 new author".
- **Browser checks** on the seeded production preview, Chromium at 1440: `/reading/stats` charts read "Books finished by month: ... August 2026: 1 book; ..." and "Reading by weekday: Monday: 40 min; ..."; Settings > About reads "Latest migration 0088"; Harmonize reads "Show 60 more · 107 remaining".
- **Audits:** the alignment and design audits found nothing on `/reading/stats`, `/statistics`, `/settings/about` and `/harmonize` at 1440 and 390, in all three engines.
- **Page weight:** every route is within budget.
- `pnpm typecheck` is clean, and `pnpm test` passes.
- **Rebuilt on main after #399, #407 and #417 landed** and checked again: the chart summaries, the About page and Harmonize read as above, the audits found nothing on the touched pages, and every route is within its page weight budget.
- **Item 7, on main after #427:** the pager reads "Showing 1–1 of 1 name" on Publisher names; Locations read "1 item" and "15 items". The audits found nothing on Publisher names, Organizations, Harmonize and Locations at 1440 and 390 in all three engines, and every route is within its page weight budget.
- **Review of #448:** Harmonize's merge summary reads "1 missing field will be filled. 2 field choices will be applied." through `countLabel`; a dictionary's word count goes through `countLabel` too, grouped in English whatever the browser's language ("1 word", "152,340 words"); a recovery's date reads like other reading dates ("16 Oct 2026") through `formatReadingDate(calendarDate(...), "day")`, not the browser's `toLocaleDateString()`. `count-wording.test.ts` checks each.
