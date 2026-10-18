# Task 0885: Delete a parent term by moving its narrower terms up

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0846
**Blocks**: None

## Overview

Since 0846 the delete dialog never offers a choice that fails, but a term with narrower terms and no records could not be deleted at all: the dialog said "Move the children first" and nothing on the page moves a term to another parent. Deleting such a term now moves its narrower terms up one level, to where it sat, in the same transaction. A term with records still moves them to a sibling first (a merge, which takes its narrower terms along), and the dialog now says so.

## Implementation Details

- `deleteTaxonomyItem(familySlug, itemId, reassignToId?, liftChildren?)` in `src/lib/actions/taxonomy-families.ts`: with `liftChildren`, after the link check refuses a term that records still use, the term's children take its parent, then the existing child check and delete run. One transaction under the table lock; the hierarchy trigger recomputes the levels of the moved subtree.
- `src/components/taxonomy/delete-item-dialog.tsx`: no links and narrower terms: "This item has 2 narrower items. They move up one level, to where Novel sits now, and Novel is deleted.", Delete enabled. Links: the reassign choice, plus "its N narrower items move there too" when it has any. The no-sibling note no longer suggests moving the term, which the page cannot do.

## Completion Notes

- Disposable PostgreSQL: a built-in family (levels recomputed, links still refuse with nothing moved) and a custom family's top-level parent (children reach the top level). The dialog's rendered test now expects Delete enabled for a parent without links.
- Headless Chromium, Firefox and WebKit at 1440, 390 and 320 (mouse and touch at 390/320) on `/taxonomy/categories`: dialog text right, Delete enabled, no sideways overflow, Escape (key code 27) closes it, no page errors; the Chromium delete moved Gothic novel and its sibling from level 3 to 2 under Fiction. Browser audit 9 of 9 page loads pass; page weight passes the taxonomy routes.
