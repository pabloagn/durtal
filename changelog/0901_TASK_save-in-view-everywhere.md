# Task 0901: Save in view in the rest of the dialogs, and on Add book's steps

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0816
**Blocks**: None

## Overview

SLN-1056, from section 3 of `findings/dialogs-survey-2026-10-18.md`. Task
0816 (SLN-943) moved Save under the dialog's body in the eight dialogs and
four add pages it measured. About thirty more dialogs still had their button
row at the end of the scrolling body, so it scrolled away once the body was
taller than the screen: a long form, or a phone held sideways. Add book's
steps put their actions after the last section.

SLN-1051 asked the same of the reading dialogs; Task 0816 had already done
it, so it needed nothing more.

## Implementation Details

- **Dialogs.** The row moves into `DialogFooter` (`src/components/ui/dialog.tsx`),
  which renders it under the body, always in view. The reason a save failed
  moves into the row with it, over the buttons (`basis-full`), as in 0816.
  - Long forms: a film's copy, a perfume's bottle, a wish and its order
    (`wanted-section.tsx`), Link a work, Add source, the three Wikidata or
    museum look-ups' review, an order's edit and New order, New location,
    Edit location and Delete location, and the image adjustment dialog.
  - Short forms: series, recommender, a taxonomy item, a family's edit,
    a collection's edit and Add collection, Link an institution, and a
    perfume's retailer and price.
  - Pickers: Add books to a series and to a collection, Configure columns,
    Reorder families, Merge item and Merge people.
- A form's submit button sits outside the form now, so it names it
  (`form={formId}`). Enter in a field still submits: the button still
  belongs to the form.
- **Rows with something at the start.** New order keeps Back or Cancel at
  the start (`mr-auto`), and Add books to a collection keeps its count
  there.
- **The image adjustment editor** (`image-adjustment-editor.tsx`) also
  shows inside the media manager, which has more under it, so its row moves
  only in its own dialog (`pinned`). Compare still starts on the sliders'
  edge.
- **Add book** (`StepFooter`, `library/new/step-progress.tsx`): the row
  is pinned to the bottom of the page with `PINNED_PAGE_FOOTER`, as the
  other add pages are.

## Completion Notes

- **In the browser** (survey dump), Chromium, Firefox and WebKit at
  390 × 760, 320 × 640 and 844 × 390 (sideways): the main button of each of
  the 23 dialogs opened, and of the image adjustment dialog, is in view with
  nothing scrolled, and none is inside the scrolling body. On main, 15 of them start below the screen, in
  Chromium at 844 × 390 (Add copy's at 876px of 390) and two at 390 × 760
  as well (Add copy and Add bottle). The look-ups' review needs Wikidata
  and the price form a retailer, so those three were read from the source.
- **Add book**: the details step and the copies step keep their row in view
  at 1440, 390, 320 and 844 × 390, in three browsers.
- **Image adjustment**, opened from an edition cover's media manager: in
  the same three browsers and sizes, Compare's label starts 0px from the
  sliders' edge, on Save's row.
- **Keys**: Enter in the series title still adds the series. Ctrl+Enter
  saves the collection's edit in Chromium and Firefox; in headless WebKit
  neither main nor this change saves on Meta+Enter.
- **Alignment.** The audit reports nothing with each dialog open, except
  Merge item at 320 and 844 × 390: "Journey Symbolism" 13px off in the
  page's tree behind it, the same on main.
- **Unit test** (`ui/save-in-view`): each listed file keeps its main button
  and error in its footer, the forms name themselves, and Add book's row is
  pinned.
- **Audits.** The browser audit passes 45 of 45 loads of `/library/new`,
  `/locations`, `/series`, `/collections` and `/provenance`. Page weight
  passes on every route.

### Review on current main (2026-10-20)

- Main had since given each dialog's Save its reason (`useSaveReason`, #601,
  SLN-1057): the line that says what is missing, read with the button. In the
  fifteen dialogs both changes touched, the reason now sits in the footer at
  the row's start, and the button keeps its `aria-describedby`. The footer's
  own missing-field hints gave way to it, so each dialog says one reason.
  Add books keeps its count where no reason shows.
- **Browsers.** On a private preview, with Add series and Add collection
  open, the Add button sits in the footer, in view and outside the scrolling
  body, naming its form, in Chromium, Firefox and WebKit at 844 × 390,
  390 × 760 and 320 × 640.
- **Checks on main after #620:** `pnpm typecheck` and `pnpm lint` clean,
  `pnpm test` (every suite without a database, 753 files) and `pnpm build`
  pass. The change touches no database code; CI's database run is the full
  check, as the container's disk no longer fits a local one. The browser
  audit passes 54 of 54 page loads of `/library/new`, `/locations`,
  `/series`, `/collections`, `/provenance` and `/taxonomy`. `page-weight.js`
  passes.
