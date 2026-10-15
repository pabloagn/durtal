# Task 0642: Chips, role menus and checkbox lists are 44px on touch

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-734, second main audit findings 2 and 3 (`findings/audit-2-2026-10-15.md`).
On a phone, the film, painting and perfume forms (their edit dialogs and add
pages) had 16px Remove crosses on every chip: countries, languages,
organizations, genres, movements, notes. A perfume house's role menu was
20px tall. The date fields' "Approximate", Edit organization's type
checkboxes and New taxonomy family's "Applies to" checkboxes were 24-32px.
A place's institution Remove was 16px too.

## Implementation Details

- `record-fields.tsx`: `RemoveButton` always grows to 44px on touch
  (`CapAligned` `coarseHeight={44}`, `pointer-coarse:size-11`); the
  `touchTarget` opt-in that only the credit rows used is gone. `CHIP` is one
  44px line on touch (`pointer-coarse:py-0 pointer-coarse:leading-11`), so a
  chip holds its cross and stays one line high.
- The row's label and Add take the same first line: Add and the label are
  `pointer-coarse:leading-11`, and both take `pt-px` for the chip's 1px
  border, so their text sits on the chips' text (it sat 1px high before,
  at every width). The painting and perfume credit rows, where a person's
  name has a line of its own on touch, pad that line to the same center
  (`pointer-coarse:py-2.5`).
- `perfume-fields.tsx`: a house's role menu is `pointer-coarse:h-11`, as the
  people's role menu already was.
- `catalogue-date-field.tsx` ("Approximate"), `organization-dialog.tsx`
  (types) and `family-form.tsx` (scopes): the labels are 44px on touch.
- Test: `src/__tests__/ui/chip-touch-targets.test.ts`.

## Completion Notes

- Measured on a production preview in Chromium, Firefox and WebKit. On the
  audit's build of main, at 390 and 320 the touch audit listed the crosses
  at 16 × 16, the role menu at 20px and the labels at 24-32px in Edit film,
  Edit painting, Edit perfume, Edit organization and New family, and the
  institution cross on a place page.
- With the fix, at 390 and 320: the touch audit is clean in all five
  dialogs, the add pages and the place page in all three engines. No two
  crosses overlap, and nothing scrolls sideways. Each row's label, chips,
  crosses and Add measure 0.00-0.01px apart at 1440, 390 and 320 (the
  label was 1px off at every width on main, and 9px off on touch for a
  credit row before the padding). Desktop chips are unchanged: 26px, crosses
  16px.
- On touch a credit chip is 94px (78px on main): the name line and the
  role, credited name and cross line are each 44px.
- Alignment audits on the same dialogs and pages at 1440: clean in all
  three engines. One audit run in Firefox and WebKit read every cap-aligned
  icon in Edit painting and Edit perfume 0.52-0.56px off at once, which is
  the dialog's top landing on a half pixel; measured again, the same dialogs
  are clean, at whole and half-pixel tops alike. `page-weight.js` passes. Typecheck clean, lint no errors,
  UI tests pass (95 files). No migration, no new package.
