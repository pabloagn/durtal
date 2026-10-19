# Task 0972: Shared taxonomy families count and tag every kind

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1157 (taxonomy survey findings 1 and 11). A family that applies to books as well as to films, perfumes or paintings counted and showed books only: a theme on three films read 0 on its row and "Nothing tagged yet" on its page, while the family's card and the delete dialog counted the films. Films, perfumes and paintings could not be tagged with Subjects, Themes or Keywords at all, and the term page's empty state named every kind whatever the family applied to.

## Implementation Details

- `visibleKinds` (`src/lib/actions/taxonomy-browse.ts`) and `itemKinds` (`src/lib/actions/taxonomy-families.ts`) return every open collection the family applies to, in the order the collections are listed. Rows, term counts, the family list and the merge dialog now agree with the card and the delete dialog. `getTaxonomyTerm` sorts its kind counts the same way.
- Term page (`src/app/(catalogue)/taxonomy/[familySlug]/[itemSlug]/page.tsx`): book cards ("Books" when other kinds are tagged), then each other kind as a counted link to its list filtered by the item ("Films and paintings"). Art movements link to the painting list's `movement` filter. The empty state is built from the family's kinds ("No book or film is tagged …"); built-in edition families say they are chosen under Genres & tags in the edition form.
- `systemWorkTaxonomyMatch` (`src/lib/catalogue/taxonomy-storage.ts`): the film, perfume and painting list filters match built-in work families (and narrower items) as they match custom ones, so the term page's links list what it counts.
- `getTaxonomyAssignments` offers built-in families on film, perfume and painting pages (a book's keep the work dialog; perfume notes and a painting's movements keep their own editors). `searchTaxonomyItems` searches any family's table. `replaceTaxonomyAssignments` and `createTaxonomyItem` already wrote either store, and the database's scope triggers already allowed these links.
- The perfume page's section reads "Classification" once a family other than families and accords applies.

## Completion Notes

- New database case in `taxonomy-applicability.test.ts`: a theme on a book, three films and a painting counts 5 on its row, term page and card; a film-only theme counts 3; the film, painting and perfume lists filter by it; the film page offers Themes, Subjects and Keywords, the book page doesn't, the painting page leaves out Art movements; a custom Books and Films family counts the film tagged from its page.
- `book-domain-isolation.test.ts` now expects a family's items to count all four kinds, as its card does.
- Not covered: a custom family scoped to book editions has no editor anywhere, so its empty state names no place to tag one. Reported for a ticket.
