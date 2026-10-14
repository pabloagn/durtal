# Task 0525: E then a letter on every page

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0523, 0524
**Blocks**: None

## Overview

SLN-633. The Edit menu (E) opened only on the book page. On every other
detail page the keyboard could not reach the Edit or media dialogs. The
owner's own examples were E then C to edit a collection, and E then M for a
page's media.

## Implementation Details

- **The rule:** the letter is the first one of what it edits.
  - W is the work: a book, film, perfume or painting.
  - M is the page's media, images or artwork.
  - T is a book's taxonomy.
  - C is a collection.
  - P is a person, a publisher or a place. The three never share a page.
  - O is an organization, S a series and R a recommender.
- **Where the keys live:** `EDIT_KEYS` in `src/lib/shortcuts/shortcuts.ts`.
  - `editHint` gives the actions menu's "E C".
  - `editTooltipKeys` gives a button's tooltip keys, "e then c".
  - The shortcut sheet's Edit group lists every letter.
- **How a page binds them:** each page registers its entries with
  `useEditActions` in the component that owns the dialogs. Each entry runs
  the same state change as the visible button, so there is no
  keyboard-only edit path. The components are:
  - FilmActions, PerfumeActions and PaintingActions;
  - AuthorDetailHeader, PublisherHeader and OrganizationActions;
  - CollectionControls, SeriesActions, VenueActions and RecommenderActions.
  
  A publisher's E then P opens its editor page, as its Edit link does.
- **Where the keys show:** the actions menus show the keys beside Edit and
  Images or Manage media. The collection's Edit and Artwork buttons and
  the publisher's Edit link show them in their tooltips.
- **Not bound, with the reasons in `docs/15_KEYBOARD.md` section 3:**
  - Delete;
  - a place's Archive and a person's Merge;
  - the Add books buttons.
- **Docs:** `docs/15_KEYBOARD.md` (key map and page families) and
  `docs/04_ROUTES_AND_VIEWS.md` (the shortcuts paragraph).

## Completion Notes

`src/__tests__/ui/edit-keys.test.ts` covers the following:
- **Collections:** E then C opens Edit collection once. The same keys typed
  in its Description open nothing more, and E then M opens the artwork
  editor.
- **Films:** E then W opens Edit film and E then M its images. E then a
  letter the page lacks opens nothing.
- **Every page:** each of the 11 page components registers its letters and
  shows them in its menu or tooltip.
- **The sheet:** it lists every letter.

Browser checks ran on a production build of a disposable preview, in
headless Chromium, Firefox and WebKit, with all 228 checks passing:
- **Every page family:** on each of the 11, E opens the Edit menu, and
  each letter opens one dialog, or the publisher's editor page.
- **No second dialog:** the same keys pressed again open nothing more.
- **Esc** closes the dialog.
- **Client navigation:** after moving from a book to a collection, E shows
  the collection's entries and E then W opens nothing.

The opened actions menus with their key hints passed the alignment,
overflow and design audits at 390 and 1440px, 54 of 54.
