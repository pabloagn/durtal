# Task 0819: Palette options announced in full, and from the start

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A book's option in the palette held its "Read" link, so a screen reader read the link and the "Ctrl ↵" hint with every option, and the option held interactive content. The selected first result was not announced: the input's `aria-activedescendant` stayed empty until an arrow key moved the selection. Source: the shortcuts survey, finding 4. Fixes SLN-965.

## Implementation Details

- `src/components/ebooks/catalogue-read-action.tsx`: the palette's Read link is `aria-hidden` and out of the Tab order (`tabIndex={-1}`); the pointer still clicks it, and its tooltip still shows.
- `src/components/layout/command-palette.tsx`: an option whose book has an e-book to read is described by a hidden "Command Enter to read" (or "Control Enter to read") text, the keys that already read it.
- cmdk sets `aria-activedescendant` only when an arrow key moves the selection, never for the selection the palette sets itself (the best match, and the selection kept while the options change). The palette now names whichever option is selected: a MutationObserver on the list sets the input's `aria-activedescendant` to the option with `aria-selected="true"`.
- Tests: `src/__tests__/ui/palette-options-announced.test.ts` (all four fail without the change); the two existing palette Read tests find the link by its reader entry.

## Completion Notes

Checked on a production build in headless Chromium, Firefox and WebKit: on opening, after typing, after ↓, after typing more and after deleting, the input's `aria-activedescendant` names the selected option, and no option holds an exposed link. Chromium's accessibility tree resolves it to the option "Against Nature · Joris-Karl Huysmans 1884" as soon as the results show. The seed has no e-book to read, so the Read link and its description are covered by the tests only. Palette audit (empty, "seed", "a", "settings") at 1440, 390 and 320 in all three engines: no alignment deviation, no cut text. Page weight within budget. `pnpm test`: 6,729 passed.
