# Task 1136: A shelf card follows the book's cover

**Status**: Completed
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-999. On a book page, the "More from <publisher>" and "More translated by
<name>" shelves show one card per edition. When an edition was set to use the
book's cover (SLN-638), its card showed the cover letter instead of a cover.

## Implementation Details

Using the book's cover clears the edition's own cover keys, so the edition
then shows the book's active poster (`editionImage`,
`src/lib/utils/edition-image.ts`). The shelves' edition cards
(`relatedGroupsFrom`, `src/lib/catalogue/related-groups.ts`) dropped the
book's media, so that a poster would not hide an edition's own cover, and an
edition with no cover of its own was left with nothing. The card now keeps
the book's poster when the edition has no cover of its own, and still drops
it when the edition has one.

The other edition rows already fall back to the book's poster: the publisher
page's list, a collection's edition members and the reading lists.

Test: `src/__tests__/catalogue/related-shelf-covers.test.ts`, an edition that
follows the book's cover and one with its own. It fails without the fix.

## Completion Notes

Typecheck and lint clean. The suites without a database pass; the database
suites run in CI (the container's disk is full).
