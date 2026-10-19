# Task 0909: Recommenders polish: one name per control, plain delete wording, names in numeric order

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1123, from item 9 of `findings/recommenders-acquisitions-survey-2026-10-18.md`.

## Implementation Details

1. **One name per control.** On a recommender's page, the header's menu and
   each book card's menu were all named "Actions", and each card's copy
   button was "Copy book title and author". Now:
   - The header's menu is "Actions for Harold Bloom".
   - A book card's menu is "Actions for Watt", and its copy button is "Copy
     the title and author of Watt", wherever book cards show. Their tooltips
     stay short ("Actions", "Copy book title and author"). `DropdownMenu`
     takes a `tooltip` for that.
   - `FocusKeeper` matches a row's control by the first word of its name, so
     the focus after a delete still lands on the next card's menu.
2. **Pagers.** The recommenders list and the wanted books already follow the
   shared rule of SLN-766, so nothing changes. When everything fits on one
   page, they show no arrows, page numbers or "Go to page". The page size
   stays while a smaller size would split the list (more than 24): above
   the list with the count, and below it alone. With 24 or fewer, only the
   count shows. Checked with 12 and with 32 recommenders, and with 4 wanted
   books.
3. **Delete wording**, without capitals, the count from `countLabel`:
   - Recommender: "Its 24 books stay in your library; only this
     recommendation goes."
   - Series: "Its 2 books stay in your library; only the series goes."
   - Person, from the page and from the selection bar: "Their books, films,
     perfumes and paintings stay in your library; only their credits go." A
     person's works span kinds, so this one names the kinds and gives no
     count.
4. **Numeric order.** Recommender names sort with their numbers in numeric
   order (`naturalOrder`): in the list by name either way, as the tie-break
   of the other sorts, and in the cached list the pickers use.

## Completion Notes

- **Browsers.** Checked on a private preview with 32 numbered recommenders,
  in Chromium, Firefox and WebKit at 1440, 390 and 320:
  - The list reads Recommender 9, 10, 11.
  - A recommender page with 24 books has no two controls with one name.
  - Each of the three delete confirms reads as above.
  - Nothing scrolls sideways.
- **Audits.** The browser audit passes 45 of 45 loads, covering the
  recommenders list, a recommender, the library, a series and a person, in
  three browsers at 1440, 390 and 320. Page weight passes every route.
- **Tests**:
  - `integration/recommenders`: numeric order, ascending and descending,
    and in the cached list.
  - `ui/card-reading`: the card menu's and the copy button's names and
    tooltips.
