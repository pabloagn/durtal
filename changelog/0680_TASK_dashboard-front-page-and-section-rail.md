# Task 0680: The dashboard as a front page, with a section rail

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-739 (dashboard revamp), SLN-740 (a section progress indicator) and
SLN-741 (sections with a clear role). Joris: the dashboard should read as a
magazine, not a literal dashboard; its sections felt added for their own
sake. Proposal: `/mnt/project-files/design/dashboard-2026-10-15/proposal.md`.

## Implementation Details

- `src/components/shared/section-rail.tsx` (new): the page's sections as
  ticks on the window's right edge, as Notion draws a long page's outline.
  The section being read is the longest and brightest tick, those passed
  brighter than those ahead. Hover or Tab opens the outline on glass; a
  name scrolls there and moves the focus. On touch screens and phones, a
  glass button at the bottom right ("2/6 Recent additions") opens the same
  list as a menu, from the first section on.
- `src/components/ui/dropdown-menu.tsx`: a menu of choices opens with the
  focus on the checked item, not the first. No other menu passes `checked`
  yet.
- `src/app/(catalogue)/page.tsx`: the four count blocks (a heading, stat
  tiles and add buttons per collection) become one index under the title;
  Add book and Import books move to the header with today's date. The
  sections follow in a set order (Reading, Recent additions, the slot for
  SLN-742's Statistics, Collections, Highest rated, Wanted, Recent people),
  each under a rule, without icons. Each has an id, a scroll margin and
  `tabIndex={-1}` for the rail. The loading screen is the index with its
  figures held.
- `src/components/reading/reading-tiles.tsx`: Currently reading and
  Recently finished become one Reading section. Each open book's card shows
  its cover at 80px (was 44px), title in the card title role, author, and
  "Paused" when paused; Log and Open eBook sit at the card's foot.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Section rail),
  `docs/04_ROUTES_AND_VIEWS.md` (Dashboard).

## Completion Notes

- Checked on a production build with the synthetic catalogue plus 20 demo
  books (covers, 3 open readings, 5 finished, 4 collections, a goal):
  `/` is 229 of 300 KB; the browser audits pass in Chromium, Firefox and
  WebKit at 1440, 768 and 390; no page scrolls sideways at 375 or 390; the
  interaction audit finds nothing on `/`.
- The audits caught the reading card's cover link, which had no name; the
  cover is a picture again and the title is the card's link.
- Under 375px each collection of the index takes its own row, so no label
  breaks mid-word at 320.
