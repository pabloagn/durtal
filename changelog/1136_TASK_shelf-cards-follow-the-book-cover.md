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
`src/lib/utils/edition-image.ts`). The shelf card (`RelatedBookCard`,
`src/components/books/work-carousel.tsx`) reads the poster first, so the
shelves' edition cards (`relatedGroupsFrom`, `src/lib/catalogue/related-groups.ts`)
dropped the book's media to let an edition's own cover show. An edition with
no cover of its own was then left with nothing.

The edition cards now carry `editionCard` and keep the book's media, and the
card picks its image in one place, `cardImage`: an edition's card goes through
`editionImage` (its own cover, else the book's poster), a book's card shows
its poster first, then its cover edition's cover, as before.

The other edition rows already fall back to the book's poster: the publisher
page's list, a collection's edition members and the reading lists.

Test: `src/__tests__/catalogue/related-shelf-covers.test.ts` covers an edition
that follows the book's cover, one with its own cover, one with a thumbnail
only, and a book's card with and without a poster.

Self-review (code-review, high): the first fix repeated the own-cover check in
`relatedGroupsFrom` and relied on hiding the poster; it moved into the card
through `editionImage`. Left as is: an edition that follows the book's cover
when the book has no poster shows the letter, as it does on the book page,
since "Use the book's cover" is offered only when the book has a poster.

## Completion Notes

Typecheck and lint clean. The suites without a database pass; the database
suites run in CI (the container's disk is full).
