# Task 0217: Menu Triggers Are Real Buttons; App Dialog for Image Delete (SLN-391)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-390 (menu `label` prop and tooltip), SLN-418 (slider grids)
**Blocks**: None

## Overview
SLN-391 found three controls without a name: the card menus, the grid size
slider and the browser `confirm()` for image delete. SLN-390 and SLN-418 have
since named the card menus ("Actions") and the slider. Two parts were left:

- The `DropdownMenu` trigger was a `div role="button"`. A trigger that was
  itself a `<Button>` (Export, and Status, Priority, Marks and Rating in the
  bulk toolbar) put a button inside a button: two Tab stops.
- The media gallery deleted an image after the browser's own `confirm()`.

## Implementation Details
- `src/components/ui/dropdown-menu.tsx`: `trigger` is one `<button>` element.
  The menu clones it and adds `type="button"`, the ref, `aria-haspopup`,
  `aria-expanded`, the click handler and, with `label`, `aria-label` and
  `data-tooltip`. A native button opens on Enter and Space, so the custom key
  handler is gone. A disabled trigger is now really disabled.
- The card menus, `EntityActionMenu` and `TaxonomyItemRow` pass a `<button>`
  where they passed a `<span>`. The classes are the same.
- `src/components/media/media-gallery.tsx`: the trash button opens
  `DeleteConfirmDialog`. `onDelete` may return a promise; the dialog shows
  "Deleting..." until it settles.
- Step 4 of the issue (`eslint-plugin-jsx-a11y`) belongs to SLN-308.

## Completion Notes
Checked on a disposable preview (`scripts/qa/preview-local.py`, port 3410):
`/`, `/library`, `/library/against-nature-by-joris-karl-huysmans`, `/authors`,
`/authors/joris-karl-huysmans`, `/taxonomy`, `/taxonomy/subjects` and the
`/library` bulk toolbar. Every menu trigger is a `BUTTON`; the design audit
finds 0 unnamed, 0 nested and 0 low-contrast controls on each page. The
alignment audit finds 0 deviations, except one on the bulk toolbar's "Exit
selection" icon (12.34px). That control is not a menu and this change does not
touch it: the selection count wraps at the 800px preview width.

On a card menu, Enter opens the menu and focuses the first item. Escape
closes it and returns focus to the trigger. The preview catalogue has no
gallery images, so the image delete dialog was not opened in the browser.
