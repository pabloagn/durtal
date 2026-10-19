# Task 0816: Save in view on phones and on the add pages

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The forms survey and the adding survey found Save out of view when a form opened. On a phone (390 and 320 wide) eight dialogs opened with Save below the dialog's scrolling body: Add a quote, Edit reading, Log a past read, Add version and Add reproduction on a painting, Add formulation, Add version on a film, and New family in taxonomy. The add pages for films, perfumes, paintings and publishers kept Save at the end of a long form, below the screen at any size. Fixes SLN-943.

## Implementation Details

- `src/components/reading/dialogs/fields.tsx`: the reading dialogs' `DialogFooter` now wraps the shared `DialogFooter` from `ui/dialog.tsx`, so Cancel and Save portal into the dialog's footer slot under the scrolling body. Save names its form with `form={id}`; each of the ten reading dialogs (abandon, edit reading, finish, log progress, note, past read, session, start reading, reading goal, not for me) gives its form `id={useId()}`. A `notice` prop carries what Save turned up (the past read's "Save anyway" box) over the buttons, so it is seen.
- The film version, perfume formulation, art object, whereabouts and taxonomy family dialogs move their button row, and the save error, into `DialogFooter`.
- `ui/dialog.tsx` exports `PINNED_PAGE_FOOTER`, a glass bar pinned to the bottom of the page with the safe-area inset. The film, perfume and painting add forms use it as `DialogFooter`'s `outside` class.
- `publisher-editor.tsx` gains the same pinned footer with Cancel (back to where the editor came from) and a primary Save named "Save publisher" or "Add publisher".
- Test: `src/__tests__/ui/save-in-view.test.ts`.

## Completion Notes

Measured in Chromium, Firefox and WebKit at 1440, 390 and 320: on main Save opened at 0% in view in the eight dialogs at 390 and 320 and on the add pages; with this change it is wholly in view in all 162 measurements, plus Finish, Abandon and Add a quote. Alignment audit: no deviations. Page weight within budget. The route audit's one finding, the "Add the page count for an estimate" button reading as a plain command, is on main already and is reported separately.
