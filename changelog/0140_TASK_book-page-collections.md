# Task 0140: Book page shows its collections

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0139
**Blocks**: None

## Overview

SLN-327: A book page gives a peek of everything related to the book. Next to "More by {author}", it now shows the collections that contain the book, and the other books in those collections.

This is the first signal of a "similar works" mechanism: two books in the same collection are similar. More signals (authors, subjects, themes, movements, recommenders) can join later.

## Implementation Details

- `getCollectionsForWork(workId)` (`src/lib/actions/collections.ts`): collections holding any edition of the work, once each, ordered like the collections page, with edition count, active artwork and the work's editions they hold.
- `/library/[slug]`: a "Collections" carousel under "More by …", using `CollectionCard` (poster, or member-cover collage). When the book has several editions, each card names the edition(s) it holds. Hidden when the book is in no collection.
- `getSimilarWorks(workId, limit)` (`src/lib/actions/similar-works.ts`): other works that share a collection with the work, best first, each with its reasons (the shared collections). One SQL query builds a `signals` table of (work, reason, weight) rows and ranks: more shared collections first; at an equal count, smaller shared collections first (weight 1/size); then the collections' own order. Several editions of a work count once. New signals join `signals` with a `union all`.
- `/library/[slug]`: under "Collections", a book row. In one collection it is "More in {collection}", in the collection's order, and the title links to the collection. In several collections it is "More from these collections", and each card names the shared collections.
- `WorkCarousel` (`src/components/books/work-carousel.tsx`) renders both "More by …" and the new row. `workCardWith` (`src/lib/actions/utils/work-card-query.ts`) is the shared card query shape.

## Completion Notes

- PostgreSQL test: two editions across two collections, dedup, ordering, held editions, active poster only, unrelated collections excluded, empty result.
- PostgreSQL test `similar-works.test.ts` (`sln327_test`): ranking by shared count, collection size and collection order; one entry per work with several editions; reasons; card data; empty results; input checks.
- Browser check on a local copy of live data with migration 0029: Haunted shows "More in Transgressive Fiction" with the 7 other books in collection order. With Crash in a second test collection, "More from these collections" lists The Atrocity Exhibition (both collections) first, then Demons (smaller collection), then the rest, each with its shared collections. A book in no collection shows neither section.
- Browser check: Satantango (two editions) lists both collections with "Satantango, 2012" and "Satantango, 2013"; a single-edition book shows no edition line.
