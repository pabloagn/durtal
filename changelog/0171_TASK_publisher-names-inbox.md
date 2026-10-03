# Task 0171: Publisher names inbox and ISBN prefix rules

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0125, 0170
**Blocks**: 0172

## Overview
Step 2 of the publishing houses and editions rework. Matching links an edition to a house only when its publisher text equals a house name or alias. No house had an alias, so ISBNdb spellings ("New York Review of Books", "Penguin Books, Limited") stayed unlinked: 298 editions, one review row per edition. This task decides once per name, not once per book, and adds the ISBN publisher prefix as a second clue.

## Implementation Details
- Migration `0034_publisher_name_rules`: tables `publisher_isbn_prefixes` (prefix digits → house, CASCADE) and `ignored_publisher_names` (names that are not publishers). `refresh_edition_publishers` skips ignored names and, when no name identifies exactly one house, links through the longest ISBN prefix rule (`edition_isbn_digits`). The edition trigger also fires on ISBN changes; rule and ignored-name changes recompute unconfirmed editions.
- `/publishers/review` is now "Publisher names" (`src/lib/actions/publisher-names.ts`, `src/components/publishers/publisher-name-inbox.tsx`): one row per name carried by unconfirmed editions without a house, with book count, covers, titles, ISBN prefixes and suggestions:
  - similar name: loose keys without company words, accents, punctuation or parentheses; aliases included (`src/lib/publishers/names.ts`);
  - ISBN: the prefix (`isbn3` ranges) is shared only by linked books of one house.
- Actions per row: link to a suggestion (saves the name as an alias), choose another house (search box, with create), create a house from the name, or "Not a publisher". An ISBN-only suggestion and an ambiguous name confirm each edition instead of saving an alias, so a distributor's name never becomes a house's name.
- The ISBN prefix rule is a checkbox per row, on by default only when it reaches no other edition now. It is skipped for a prefix that books of another house use. Big groups share prefixes across imprints (978-0-14 Penguin), so a rule can reach many books; the row says how many.
- Aliases, rules and ignored names are each saved as one statement, so the automatic matching runs once per kind. (A first version had bulk selection of similar-name rows; task 0172 replaced it with guarded safe decisions.)
- Publisher page: other names, ISBN prefixes, and "N more editions without a publishing house look like X. Review" (`/publishers/review?publisher=<slug>`). The publisher editor edits ISBN prefixes like aliases.
- `/harmonize` "Publisher is only plain text" skips names marked "Not a publisher" and editions confirmed without a house, and points to the inbox.
- `getPublisherReview` removed (replaced by `getPublisherNameInbox`).
- `docs/02_DATA_MODEL.md` updated.

## Completion Notes
- Local copy of live data: 290 editions without a house carry 124 names. Similar-name suggestions: a first bulk save of 10 names linked 22 editions and saved 7 ISBN rules. ISBN suggestions: "OUP Oxford" → Oxford University Press, "Knopf Doubleday Publishing Group" → Vintage. "National Geographic Books" (an ISBNdb distributor label on Penguin and Knopf books) gets no suggestion because its prefixes point at different houses.
- NYRB on the fresh copy: 4 books, and the page says 22 more editions look like NYRB.
- Penguin: 10 spellings and 93 editions suggest Penguin Classics by ISBN only. This is left for the owner: the house structure for Penguin and its imprints is a decision, not a match.
- Tests: `src/__tests__/utils/publisher-names.test.ts`; publisher database tests for grouping, suggestions, alias plus rules (a distributor-named edition links through the NYRB prefix), ISBN-only confirmation without alias, ignore and restore, create, ambiguous names and inbox paging. All 20 database suites and the unit suite pass: 696 tests.
- Alignment audit: 0 deviations on `/publishers/review` (48 checkboxes within 0.5px), `/publishers`, a publisher page, its editor. One-line toasts only: a toast icon sits off-center when the text wraps.
- Live activation 2026-10-01 with task 0172 (see there).
