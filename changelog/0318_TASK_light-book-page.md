# Task 0318: SLN-510 A book page with many quotes, and every book page, carries less

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0343 (SLN-480)
**Blocks**: None

## Overview

A reading tracker follow-up (SLN-442, sub-issue SLN-510), seen during
SLN-480: the book page of a book with 200 quotes was 872 KB, over its
400 KB budget, and page-weight.js never measured such a page. Two causes.
The page drew every note's markup (436 KB for 200 notes). And every book
page sent the browser the full lists the edit dialogs choose from (13
lists, 2,247 items, about 183 KB), whether a dialog opened or not. The
scope grew to both causes, agreed with the coordinator.

## Implementation Details

- **Long quote groups** (`src/components/reading/notes-section.tsx`): a
  group of 12 or more (`LONG_GROUP`) draws its first 10 (`OPEN_AT`), then
  "Show all 200" under a rule. The button draws the rest in place: the
  page does not move and the focus goes to the 11th note
  (`focus({ preventScroll: true })`). Each note has its own anchor,
  `#note-<id>`: on arrival or on a new hash, a note in a closed group opens
  the group and comes into view once the group has drawn it. A
  `ResizeObserver` holds it in view while the page settles, for 5 seconds
  or until the reader scrolls, presses a key or touches the page: at 768px
  the passages above reflowed for about 150 ms after the scroll and left
  the note 1,722px above the screen.
- **Edit dialog lists on open**: the page sends only the book's own
  choices. `getEditOptions(groups)` (`src/lib/actions/edit-options.ts`, a
  server action like the others: behind Authelia, origin checked by Next)
  returns the asked lists as `{ id, name }`; an empty or unknown group is
  refused before any read. `useEditOptions(groups, open)`
  (`src/hooks/use-edit-options.ts`) shares one cache for the page: one
  request for the lists not loaded yet, a fresh load on an open a minute
  later with the old copy shown meanwhile, and `preloadEditOptions` on a
  pointer or focus on the actions menu and the edition buttons.
  `withChosen` (`src/lib/catalogue/edit-options.ts`) shows the chosen
  items at once and keeps them in the full list.
- Edit work, Edit taxonomy, Add edition and Edit edition use it.
  `OptionsNotice` (`src/components/shared/options-notice.tsx`) says
  nothing for 200 ms, then "Loading the lists…" at the footer's start, or
  "Could not load the lists." with Retry. An empty taxonomy section says
  "Loading…" or "Not loaded", never "No themes available". Edit taxonomy
  keeps one selection state for its eight sections.
- `src/app/library/[slug]/page.tsx` loads the work and the locations only,
  not the 13 lists.
- **page-weight.js**: `list` and `pick: "most"` measure the book linked
  most on `/reading/notes`: the book with the most quotes, under the same
  400 KB budget. `/library/new` has its own row.
- The date field keeps "YYYY-MM-DD" on one line (Firefox broke it at the
  hyphens at 390 px, 11.8 px off its icon).
- The reading journey seeds "Journey Notes" (14 notes, two subjects) and
  checks Show all in place, a note's address and Edit taxonomy.

## Completion Notes

Measured on a production build with the live-data rehearsal seed, before
(#126 head) and after (this branch merged with main at 7abd5c87):

| Book page | Before | After |
|---|---|---|
| Don Quixote QA, 200 quotes | 872 KB | 335 KB |
| Ten Notes QA, 10 quotes | 313 KB | 126 KB |
| Journey Reading, 2 quotes | 336 KB | 152 KB |

- page-weight.js: before, the 200-quote book fails (872 / 400 KB); after,
  every route passes (the book 335 / 400 KB). `/library` is at the edge
  with the QA seed: it failed at 300 / 300 KB before #130 merged and
  passes after. This task does not change `/library`.
- `test-local.py` on the merged head: 237 files, 2,622 tests. Typecheck,
  deadcode and lint (0 errors) are clean.
- Three browsers headless (Chrome, Firefox, WebKit) at 1440, 768 and 390,
  on the merged head:
  groups at 10 with Show all (0 px of scroll, 0.00 px between the button
  and the 11th note, the focus on the 11th), a note's address (in view),
  Edit taxonomy (2,228 items, the book's subject checked), Edit work, a
  failed load and Retry, Add and Edit edition. Safari itself was not run;
  WebKit ran through Playwright. The note's address shows the note 32 to
  80px from the top.
- The dialog headers' Expand and Close icons are flagged against the
  page's title behind the modal, as in earlier runs (SLN-446): an audit
  artifact, not a change here.
- Before the rebase onto main: the phone audit shows no overflow on the
  three book pages, and the interaction audit no failures on
  `/library/journey-reading` and `/library/ten-notes-qa`.
- Journeys: `perfumes`, `films`, `paintings`, `reading` and `import` pass
  before the rebase; `reading` passes again on the merged head.
