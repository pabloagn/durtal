# Task 0885: Delete a parent term, and term names that keep their words on phones

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0846 (SLN-957, SLN-959)
**Blocks**: None

## Overview

Since 0846 the delete dialog never offers a choice that fails, but a term with narrower terms and no records could not be deleted at all: the dialog said "Move the children first" and nothing on the page moves a term to another parent. Deleting such a term now moves its narrower terms up one level, to where it sat, in the same transaction. A term with records still moves them to a sibling first (a merge, which takes its narrower terms along), and the dialog now says so.

## Implementation Details

### Term names on phones (SLN-959 follow-up)

Since 0846 every row keeps a 44px column for the chevron on touch, beside a 44px drag handle, colour picker and menu, so on a 320 touch screen a top-level name kept about 46px and broke letter by letter ("Fictio n"), and a depth-2 name kept 86px ("Unbearabl e"). When the list is too narrow to keep names room beside their controls (under 26rem with touch, 20rem with a mouse), every name now takes its own line above its controls: `order-first basis-full` on the name under the named container `taxonomy-tree` (`taxonomy-tree.tsx`, `taxonomy-item-row.tsx`). The whole list switches together, so a child never starts left of its parent. The count carries `ml-auto`, so it and the menu keep the row's end. "Merge into..." reads "Merge into…".

### Deleting a parent


- `deleteTaxonomyItem(familySlug, itemId, reassignToId?, liftChildren?)` in `src/lib/actions/taxonomy-families.ts`: with `liftChildren`, after the link check refuses a term that records still use, the term's children take its parent, then the existing child check and delete run. One transaction under the table lock; the hierarchy trigger recomputes the levels of the moved subtree.
- `src/components/taxonomy/delete-item-dialog.tsx`: no links and narrower terms: "This item has 2 narrower items. They move up one level, to where Novel sits now, and Novel is deleted.", Delete enabled. Links: the reassign choice, plus "its N narrower items move there too" when it has any. The no-sibling note no longer suggests moving the term, which the page cannot do.

## Completion Notes

- Name boxes measured in Chromium, Firefox and WebKit on `/taxonomy/categories` (depths 0, 1, 2; widths in px): 320 touch 226 / 206 / 186 (before: 126 / 106 / 86 with letter breaks), 390 touch 296 / 276 / 256, 320 mouse 250 / 230 / 210; 1440 and 390 mouse unchanged (956 / 936 / 916, 210 / 190 / 170). Each depth steps exactly 20px in every case; only the unbroken 62-letter test word breaks inside. Browser audit 21 of 21 page loads pass (`/taxonomy/categories` and `/taxonomy/subjects` at 1440, 768, 390 and 320); no page scrolls sideways.
- `python3.12 scripts/qa/test-local.py`: 788 files, 8,087 tests passed, none skipped.

- Disposable PostgreSQL: a built-in family (levels recomputed, links still refuse with nothing moved) and a custom family's top-level parent (children reach the top level). The dialog's rendered test now expects Delete enabled for a parent without links.
- Headless Chromium, Firefox and WebKit at 1440, 390 and 320 (mouse and touch at 390/320) on `/taxonomy/categories`: dialog text right, Delete enabled, no sideways overflow, Escape (key code 27) closes it, no page errors; the Chromium delete moved Gothic novel and its sibling from level 3 to 2 under Fiction. Browser audit 9 of 9 page loads pass; page weight passes the taxonomy routes.
