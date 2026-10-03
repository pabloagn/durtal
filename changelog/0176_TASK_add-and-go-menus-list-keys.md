# Task 0176: Add and Go to menus, Enter in search lists

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0175
**Blocks**: None

## Overview
The owner could not remember single-key shortcuts and found that Enter did nothing in the app's search lists. Every "add" action is now under one key, A, which opens a menu that shows the choices. G does the same for sections. In every search list, ↑ ↓ move and Enter picks.

## Implementation Details
- `A` opens the Add menu: `B` book (`/library/new`), `A` author, `P` publisher (`/publishers/new`), `R` recommender, `S` series, `C` collection, `L` place. `G` opens the Go to menu (same letters as before). The menus stay open until a choice or Esc: press the letter, or ↑ ↓ and Enter, or click (`src/components/shortcuts/leader-menu.tsx`). An open menu takes the keys in the capture phase.
- `N` is gone; adding a book is A then B. The list lives in `ADD` and `GO_TO` (`src/lib/shortcuts/shortcuts.ts`); the menus, the shortcut sheet and the command palette read it. Icons: `SECTION_ICONS` (`src/components/shortcuts/section-icons.ts`), the sidebar's icons.
- The author, recommender, series, collection and place dialogs open on any page, mounted only while open so each starts empty. `CreateCollectionDialog` and `VenueCreateDialog` can now be controlled (like `AuthorCreateDialog`, `SeriesFormDialog`, `RecommenderFormDialog`); a collection's request id is made on first submit when the dialog was opened from outside.
- Search lists: in a field that searches or filters ("Search author by name...", "Search publisher...", "Filter genres...", or `data-picker`), ↑ ↓ move a highlight over the choices and Enter picks the highlighted one, else the first. `pickerOptions()` finds the list after the field or its wrappers (a scrolling or floating list, or choices that follow the field); choices have text, and a dialog's own buttons are never choices. Lists that handle their own keys (Add Book search, publisher picker, place search, palette) are left alone. The highlight (`[data-kb-active]`, `globals.css`) looks like a hovered choice.
- Enter on a checkbox outside a form ticks it. Enter in a filter field no longer goes to the next Add Book step.
- The order dialog's author field is marked `data-picker`.

## Completion Notes
- Browser on :3100, real key presses: A then A, R, S, C, L open the five dialogs with the cursor in the first field; A, ↓ ↓, Enter opens Add Publisher; G stays open, Esc closes it. Edit Work author search: ↓ ↓ highlights the second result, ↑ and Enter added Thomas Mann without saving the dialog (Cancel; the database still lists only Dostoyevsky). Library Filter, Publisher search "vint", ↓, Enter applied the Vintage filter (28 works).
- Alignment: menu icons and key caps 0 px off their label's line center; audit with the Go to menu open: 0 issues (38 icons); shortcut sheet key caps 0 px off.
- Typecheck, lint and all 604 tests pass.
