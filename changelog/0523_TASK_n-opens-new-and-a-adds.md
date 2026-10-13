# Task 0523: N opens New, and A then a key adds

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0522
**Blocks**: SLN-571

## Overview

SLN-632. A opened the Add menu, so A could not start a sequence. Now N
opens the menu (titled "New"), and A is only a prefix: A then B adds a book,
A then P a perfume, A then A a person, as the owner asked. A alone opens
nothing.

## Implementation Details

- `src/lib/shortcuts/shortcuts.ts`: `SHORTCUTS.newMenu` (N) replaces
  `addMenu` (A). The sheet's Menus row reads "New: book, perfume, person...";
  its Add group lists A then each key. A publisher is A then U now: P is
  Perfume.
- `src/lib/catalogue/domains.ts`: a perfume's `keys.add` is P (was E). Its
  Go key stays G then E.
- `src/components/shortcuts/shortcuts-provider.tsx`:
  - N opens the menu that A opened.
  - A records when it was pressed. The next key adds when it is an Add key,
    unshifted and within 1.5 seconds (`ADD_PREFIX_MS`); any other key, Esc,
    a late key, a modifier chord, a held key, a key while typing or in a
    dialog ends the wait and does nothing. Shift, Ctrl, Alt and Meta alone
    keep it waiting.
  - A client navigation closes an open leader menu and drops a pending A.
- The palette's "Add a …" entries keep their A then key hints, from the same
  list.

## Completion Notes

- `src/__tests__/ui/new-menu-and-add-keys.test.ts`: N opens New and A
  nothing; A then B, P, U and A; Esc, an unknown key, Shift, ⌘ and Ctrl, a
  late key; Shift alone; typing and a held A; a page change; the sheet, the
  menu and the registry agree.
- Updated: `domain-navigation.test.ts` (perfume's Add key),
  `edit-menu-shortcuts.test.ts` and `reading-menu-shortcuts.test.ts`.
- Not here: A then F and A then C for the open item's favourite and
  collections (SLN-571). Until then they are Add film and Create collection.
- Docs: `docs/04_ROUTES_AND_VIEWS.md` (shortcuts), `docs/15_KEYBOARD.md`
  (key map).
