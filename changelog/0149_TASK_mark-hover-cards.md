# Task 0149: Book page marks as icons with hover cards

**Status**: Completed
**Created**: 2026-09-27
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0147
**Blocks**: None

## Overview

SLN-340: the book page showed the rare date as text beside the gem ("2026-09-25"). The marks are now icons only. Their details, and the rare date, show in a small hover card.

## Implementation Details

- `MarkToggle` (`src/components/books/mark-toggle.tsx`): the icon alone in a 28px button; mark color when set, muted when not. Click marks or unmarks.
- Hover (250ms) or keyboard focus opens a card under the icon, in a portal so the hero never clips it: the mark's icon and name, the date on the same line for dated marks ("15 Sep 2026"), the meaning, then "Change date" and the mark or unmark action. Down arrow moves keyboard focus into the card; Escape, an outside click or leaving both icon and card closes it.
- "Change date" edits the date inside the card: date field, save, Today.
- `formatMarkDate()` writes "25 Sep 2026" the same way in every browser and time zone.
- `HuntAssessmentControl` (Rare, dated) and `PoisonToggle` (Anathema) both use it; marking Rare dates it today and opens nothing. Words come from the marks vocabulary.

## Completion Notes

Typecheck and lint pass. Browser check on a local copy of live data: icons only in the header; the Rare card shows the date, meaning and actions without wrapping; "Change date" saved 15 Sep 2026 and the card showed it; the Anathema card opens when the pointer moves to the skull and the Rare card closes.
