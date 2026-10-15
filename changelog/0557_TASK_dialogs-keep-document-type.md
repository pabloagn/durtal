# Task 0557: Dialogs on detail pages keep the document's type

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: 0555 (its alignment check of the image editor)

## Overview

A regression from #289 (SLN-641 piece 2). A detail page's controls now sit in its title row, which carries `type-page-title`. A native `dialog` opens in the top layer but inherits type from where it is mounted. So every dialog opened from that row (Images, Edit and the rest, on every detail kind) set its text in Cirka, at the title's -0.025em tracking, wherever a dialog's element did not set its own font. Its icon buttons sat 1.5px off their labels' cap height (alignment audit).

## Implementation Details

- `src/styles/globals.css`: in the base layer, `dialog` takes the document's type: Inter (`--font-sans`), 16px (`--text-sm`) at its line height, normal tracking, weight 400.
- It is in the base layer, so a dialog's own classes (a `type-dialog-title`, a `text-xs`, a reader dialog's serif) still win.
- `src/__tests__/ui/dialog-type.test.ts` checks the rule is there and is not unlayered.

## Completion Notes

Found while auditing the image editor (0555) on `/films/[slug]`: the button text in the Manage media dialog computed to `cirka` with `-1.15px` letter spacing, inherited from the `type-page-title` div that holds the page's controls. Menus were not affected: they already set their own type.

Checked on a production build with the seeded preview, in Chromium, Firefox and WebKit at 1440 and 390:

- Edit and Images (where offered) from the title row on a film, a person, a perfume, a painting, a place, an organization and a series, and Edit Work and Edit Taxonomy on a book. Every dialog computes to Inter with normal tracking, with no text left in Cirka, and the alignment audit finds nothing over 0.5px.
- A dialog that sets its own type still wins in all three engines, mounted in the same title row: `text-xs` gives 14px, `font-serif` gives Cirka, `tracking-tight` gives -0.4px.
- The publisher's Edit is a page, not a dialog.
