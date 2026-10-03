# Task 0175: Name-order button and keyboard shortcuts

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0173
**Blocks**: None

## Overview
Two speed features. An author name field gets a button that puts a catalogue-order name in natural order ("Huxley, Aldous" becomes "Aldous Huxley"), the same fix as the harmonizer. The whole app gets keyboard shortcuts for the frequent work: add a book, add an author, find a book, move between sections, and confirm or save forms.

## Implementation Details
- Name order: `naturalNameParts()` / `naturalAuthorName()` in `src/lib/utils/author-names.ts` use the harmonizer's `displayName()` (`src/lib/harmonization/normalize.ts`), so the button and the harmonizer always agree, with the same guards ("Smith, Jr.", "Sade, Marquis de", more than one comma stay). A name in all capitals or all small letters also gets capitals ("HUXLEY, ALDOUS", "de beauvoir, simone"). Tests: `src/__tests__/utils/author-names.test.ts`.
- `AuthorNameInput` (`src/components/shared/author-name-input.tsx`): on the Add Book author field and the Add Author name field. The button is lit only when the name has a name-order comma. In Add Author it also fills Sort Name, First Name and Last Name when they are empty.
- Field buttons share `FieldActionButton` and `replaceFieldText()` (`src/components/shared/field-action.tsx`): soft gold when the button can act, muted gray (`fg-muted`) when not. The edit is typed in, so Cmd+Z undoes it. The capitalize title button (task 0173) now uses it too. Tab skips the buttons; ⌥F presses the button of the focused field.
- Shortcuts: `src/lib/shortcuts/shortcuts.ts` (the list, key labels, field and button rules) and `ShortcutsProvider` (`src/components/shortcuts/shortcuts-provider.tsx`, mounted in `Shell`, one window listener in the bubble phase, so a page handler that takes a key wins).
  - ⌘K palette; `/` focuses the list search (`data-shortcut-search`), else opens the palette; `N` Add Book; `A` Add Author from any page (one global `AuthorCreateDialog`, which can now be controlled); `G` then a letter goes to a section, with a hint panel; `?` opens the shortcut sheet; `E` and `T` edit the work and its taxonomy on a book page (`useShortcut`, listed under "This page").
  - Single keys never fire while typing, with a dialog open, or in the reader view.
  - Enter in a one-line field presses the main (primary) button of the nearest group around the field, so an "Add" row wins over the dialog's "Save". Search and suggestion fields, native forms and fields that handle Enter themselves are left alone. ⌘Enter presses the dialog's main button. A disabled button blocks: the keys never skip to another button. In Add Book, Enter goes to the next step (`data-shortcut="next"`) and ⌘Enter runs Fast Track, or adds the book on the last step.
  - `Button` carries `data-variant`, so the keys find primary buttons in every dialog without changes to each dialog.
- Dialogs open with the focus in the first field (the browser focused the header's first button), or on the dialog when it has no field.
- Command palette: searches books (title, series, author, ISBN; accents and typos tolerated) and authors through `quickSearch()` (`src/lib/actions/quick-search.ts`), about 80 ms. It also has "Search the library for ...", "Add an author", "Keyboard shortcuts", and shows each action's keys.

## Completion Notes
- Browser on :3100: N, A, E, G then L, `/`, ⌘K search and Enter to open a book, ⌥F on title and author fields, Enter to the next Add Book step, all with real key presses. `?` and `/` were sent as page events (the test tool cannot press them). Enter and ⌘Enter rules checked on a test dialog: Save from a field, Add from an add row, nothing from a search field, nothing when Save is disabled.
- Alignment: field buttons 0.18 px from the input text's cap-height center, inset 4 px on three sides; palette audit 0 issues (44 icons), its key caps 0 px off; shortcut sheet key caps 0 px off their label's first line.
- Typecheck, lint and all 602 tests pass.
