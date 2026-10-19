# Task 0886: A taxonomy item cannot be added beside its accented twin

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1016. Item names were unique only on exact text, so "Decadentisme" could be added beside "Décadentisme" (search survey, 18 Oct, section 4). A new or renamed item whose name matches another item of its family apart from accents, case or punctuation is now refused with the existing item's name, and the add dialog offers to open it as the name is typed.

## Implementation Details

- `src/lib/actions/taxonomy-families.ts`: `search_normalize(name)` compared within the family (`twinCondition`). `createTaxonomyItem` and a rename in `updateTaxonomyItem` refuse a twin with `This family already has "Décadentisme"`; the create re-checks under its table lock, so two saves at once cannot both pass. A name that normalizes to nothing (symbols only) matches nothing. `findTaxonomyNameTwin` serves the dialog. No migration and no unique index: existing twins stay as they are, and Harmonize can merge them.
- `src/components/taxonomy/create-item-dialog.tsx`: a 300 ms lookup as the name is typed; a twin shows "This family already has "Décadentisme". Open Décadentisme" and Create waits for another name.
- `src/components/taxonomy/taxonomy-assignments.tsx`: the picker treats a listed twin as the typed name, so it offers the existing item and never "Create".

## Completion Notes

- Disposable PostgreSQL: accented, upper-case and punctuated twins refused with the item's name; a rename to its own accented form allowed; other families and symbol-only names unaffected. The two existing duplicate-name tests now expect the item's name in the message.
- Two creates of "Décor" and "Decor" at once: exactly one is saved (the existing Unicode test now uses "Café" and "Café noir", since "Café" beside "Cafe" is what this refuses).
- Headless Chromium, Firefox and WebKit at 1440, 390 and 320 on `/taxonomy/themes` with "Décadentisme" stored: typing "Decadentisme" shows "This family already has "Décadentisme". Open Décadentisme" (linking `/taxonomy/themes/qa-decadentisme`) and Create waits; "Decadence" clears it. No sideways overflow, no page errors; browser audit 9 of 9 page loads pass.
