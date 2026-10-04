# Task 0281: Publishers Use the Shared Controls (SLN-332)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0280 (SLN-427 leftovers: the founding fields)
**Blocks**: None

## Overview
The publisher forms and pickers were built from raw `<input>`, `<select>`,
`<textarea>` and `<button>` elements styled by hand (`fieldClass`). They now
use the shared `Input`, `Select`, `Textarea`, `Button` and
`MultiSelectSection`, with the same labels (`type-label`) and field height as
the other forms. No data or behaviour changes. The publisher page itself
already used the shared header, buttons, menu and book cards (task 0231).

## Implementation Details
- `publisher-editor.tsx` (add and edit): shared fields; the Type select;
  specialties through `MultiSelectSection` (its own search); the founding year
  now sits beside the city search, both 32px high.
- `publisher-picker.tsx`: the publisher search box is the shared `Input`
  (still a combobox with its listbox); the chosen-publisher label uses
  `type-label`. `fieldClass` is gone.
- `order-target-fields.tsx` and `acquisition-targets.tsx`: shared `Select`
  for the target, edition and copy choices; "Record return" and the remove
  icon are shared `Button`s (the icon with its `aria-label` and tooltip).
- `edition-publishers.tsx` and `publisher-name-inbox.tsx`: the text buttons
  (Link publisher, Undo, Restore) are shared ghost `Button`s; the inbox's
  cover links get an `aria-label`.
- `/publishers/review`: the shared back link ("Back to publishers") and link
  color.

## Completion Notes
Checked on a disposable local database: adding a publisher with a founding
year and a specialty saves and shows both; the book page's Hunting for form
and the review inbox work. Alignment and design audits on `/publishers/new`,
`/publishers/review` and a book page at 1440, 768 and 390px: no new
deviation, 0 unnamed and 0 nested controls (one older alignment report on the
book page's edition row is unchanged). The native checkboxes stay: the app has
no shared checkbox.
