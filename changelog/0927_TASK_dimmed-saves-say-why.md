# Task 0927: A dimmed Save says why, and is read with its reason

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-1057, from findings/dialogs-survey-2026-10-18.md, the reading survey, the films, perfumes and paintings survey, the screen-reader structure survey and the wording survey. Twenty-two dialogs dimmed Save while a required field was empty or a choice unpicked, and nothing said which. In the six forms that did show a line (`RequiredNameHint`), a screen reader did not read it with the button.

## Implementation Details

- `useSaveReason(reason, place)` (`src/components/shared/save-reason.tsx`) gives the line beside the action and the button's `aria-describedby`. `reason` is the first thing missing, or nothing when Save can go ahead. `RequiredNameHint` is removed; its six forms (person, film, perfume, painting, series, new collection) and the organization dialog use the hook.
- The reading dialogs' `DialogFooter` (`components/reading/dialogs/fields.tsx`) ties its `hint` to Save the same way. Log progress says "Enter where you are" when only minutes are typed, and Add a session "Give where the session ended".
- Each dialog in the ticket's table says its first missing thing beside Save: Edit work and edition (title; a new edition of a known book may leave it empty), place, recommender, collection, taxonomy item and family (name, then "Choose at least one place this family applies"), Add and Edit copy ("Choose a location"), New and Edit order ("Choose a book", "Add the order date"), Link an institution ("Choose an organization"), bottle or sample ("Choose a formulation", "Enter the size"), art object ("Choose the institution"), Whereabouts, so Record a move and Record a loan ("Choose the place", "Give the date of the move"), Add source, Add to your list ("Choose the version", "Choose a formulation", "Add the order date"), Link a work ("Choose the work"), Note a retailer, New book from an e-book, Choose a book's new edition, and Add books to a series or a collection ("Tick the books to add").
- Not for me and the note dialog already had their reasons through the footer's `hint` (SLN-945), so they now read with Save too.
- Field errors (bad dates, prices, sizes) keep their own messages under their fields.
- Tests: `src/__tests__/ui/save-reasons.test.ts` (the hook and the footer describe Save, a filled field says nothing, each listed dialog has its reason, every file that makes a reason ties it to its action, and no `RequiredNameHint` is left).

## Completion Notes

Checked at 1440, 390 and 320 in Chromium, Firefox and WebKit before the rebase onto current main; the rebase changed only Log progress (its page-total error also holds back the reason) and an import in Edit copy. "Choose the formulation" in Add to your list now reads "Choose a formulation", as the bottle dialog does, and the three order dialogs all say "Add the order date". A size of only spaces shows its field error alone. Self-review notes kept as they are: a dimmed button leaves the Tab order, so a screen reader meets the reason beside it rather than on focus; Edit copy's e-book choice already shows its error when it cannot go ahead.
