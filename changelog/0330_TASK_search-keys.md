# Task 0330: S opens search, Esc closes every search

**Status**: Completed
**Created**: 2026-10-05
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview
SLN-477. Joris: "S, so open the search dialogue to search quickly, and Esc to exit ANY search dialogue, and I MEAN ANY". A bare `S` opens the command palette on any page; Escape closes or leaves every search surface, one layer per press.

## Implementation Details
- `S` (`SHORTCUTS.openSearch`, `src/lib/shortcuts/shortcuts.ts`; handled in `shortcuts-provider.tsx` with the other single keys): it opens the palette, as `⌘K` does. Like every single key it does nothing while typing, with ⌘, Ctrl, Alt or Shift held, while a dialog is open, or in the e-book reader, where `S` keeps opening the reader's settings. An open menu takes every key first, so `G S` (Series), `A S` (a series) and `R S` (start reading) are unchanged. `/` is unchanged.
- The shortcuts sheet (`?`) lists `S`; the Esc line reads "Close a search, a list, a menu or a dialog".
- Escape, one layer per press: a popover or a list takes Esc first and calls `preventDefault`, which keeps the native `<dialog>` around it open (its `cancel` is the key's default action); the next Esc closes the dialog. Fixed where Esc closed two layers at once or none:
  - Google Places search, the collection icon picker, the date picker, dropdown menus, the work form's author search: Esc closed the popover and the dialog around it.
  - The filter panel (`filter-dropdown.tsx`): Esc did nothing; it now closes the panel and focus goes back to the Filter button.
  - The place picker: Esc closed the dialog around it; it now clears the field and so closes its list, as the publisher picker does.
  - The Add book search: Esc clears the results when there are some; with none, it leaves the field.
  - The select (`ui/select.tsx`): Esc closed its list only when its button had focus. Safari does not focus a button on click, so there one Esc closed the list and the dialog around it. The open list now takes Esc wherever focus is, and focus goes back to the button.
- A search field on a page (no dialog around it, no list of its own that took the key: the list, collection, taxonomy, harmonize and reader library searches): Esc leaves the field and keeps its text (`shortcuts-provider.tsx`).
- The command palette: Esc closes it, and focus goes back to what had it before it opened.
- Unchanged, as they already close on Esc and keep the layers apart: the dialogs (native `<dialog>`, `src/components/ui/dialog.tsx`), the search picker, the publisher picker, taxonomy assignments, the leader menus.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (keyboard), `docs/04_ROUTES_AND_VIEWS.md` (shortcuts).

## Completion Notes
- The search for search surfaces finds the 31 of SLN-477 and no new one. 23 already closed on Esc, one layer at a time: the dialogs (native `<dialog>`), the select on a focused button, the search, publisher and taxonomy pickers, and the leader menus. 9 needed a fix (above). The page search fields now use the shared Esc rule.
- Tests: `src/__tests__/ui/search-keys.test.ts`, 15 tests.
  - S opens the palette. S does nothing while typing, with a modifier or Shift, with a dialog open, or in the reader.
  - G S still goes to Series, and R S still starts a reading.
  - Esc closes the palette. In a page search field, Esc leaves the field and keeps its text. In a dialog's search field, Esc is left to the dialog.
  - One layer per press: the place picker's list, the date picker, a dropdown menu, the filter panel, a select's list, and a select whose button has no focus.
- Browsers, on a production build (`pnpm build`, `preview-local.py --start`), at 1440 and 390px. Each run checks seven things:
  - S opens the palette with an empty field and focus in it.
  - Esc closes the palette.
  - `/` goes to the page search.
  - Esc leaves the page search and keeps the typed text.
  - A then A opens the Add person dialog.
  - Esc closes a select's list in that dialog, and the dialog stays.
  - A second Esc closes the dialog.
- Results:
  - Chrome (headless): all pass at both widths.
  - Firefox (headless): all pass at both widths.
  - Safari: checked in real Safari before Joris asked for no more Safari windows. At 1440, everything passes after the select fix. Before the fix, one Esc closed the list and the dialog. At 390, Safari's WebDriver click sent no events to the select, so the list did not open; a script click opened it. Everything else passes at 390. Headless WebKit was not installed on the Mac, and its installation was not allowed in this session.
- `page-weight.js`: `/` 242 / 300 KB, `/library` 298 / 300 KB, all routes within budget.
- `pnpm typecheck` clean, lint 0 errors, `test-local.py` 2,145 tests pass.

Review fixes:
- Closing the palette did not give focus back: the palette's own effect read the focus after its field had taken it. The shell now reads the opener when the palette opens, before it renders, and gives focus back one frame after it closes, unless a pick moved focus on (a dialog).
- The new order's author suggestions (`order-create-steps.tsx`): Esc closes the suggestions and keeps the name; typing shows them again. The next Esc reaches the dialog.
- A held `S` (key auto-repeat) never opens the palette again; no single key runs on a repeat.
- A focused combobox counts as typing (`isTyping`), so `S` and the other single keys leave it alone.
- An Esc that ends an input method composition (`isComposing`) is left to the input method in every Esc handler this task touched.
- Tests: `search-keys.test.ts` (19) and `palette-focus.test.ts` (2).
- Safari is now checked in headless WebKit (Playwright 1.63, WebKit 26.6), with no window; Joris allowed its install.
- After the review fixes, on a production build at 1440 and 390px in Chrome, Firefox and WebKit (all headless): every step passes in all three. That includes the palette giving focus back to the button that had it, and Esc closing a select's list in the Add person dialog before a second Esc closes the dialog. `test-local.py` 2,151 tests pass; lint 0 errors; page weight within budget (`/` 242, `/library` 298 of 300 KB).
- Second review: holding `S` typed "ssss" into the palette after the first `S` opened it; the palette now drops the repeats of `S` (a fresh `S` still types). Safari sends the key that ends a composition with keyCode 229 and isComposing false: `isComposing()` in `src/lib/shortcuts/shortcuts.ts` checks both, and every Esc handler of this task and the provider use it.
- Page weight: after the merge of main (the reading timer, quotes and goals), `/library` weighs 307,250 bytes on the backup, 50 over its 300 KB. This branch added 21 of them, an `aria-expanded` on the Filter button; it is dropped, so the branch adds nothing to `/library`. The other 29 bytes come from main.
