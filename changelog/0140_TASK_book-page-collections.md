# Task 0140: Book page shows its collections

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0139
**Blocks**: None

## Overview

SLN-327: A book page gives a peek of everything related to the book. Next to "More by {author}", it now shows the collections that contain the book.

## Implementation Details

- `getCollectionsForWork(workId)` (`src/lib/actions/collections.ts`): collections holding any edition of the work, once each, ordered like the collections page, with edition count, active artwork and the work's editions they hold.
- `/library/[slug]`: a "Collections" carousel under "More by …", using `CollectionCard` (poster, or member-cover collage). When the book has several editions, each card names the edition(s) it holds. Hidden when the book is in no collection.

## Completion Notes

- PostgreSQL test: two editions across two collections, dedup, ordering, held editions, active poster only, unrelated collections excluded, empty result.
- Browser check: Satantango (two editions) lists both collections with "Satantango, 2012" and "Satantango, 2013"; a single-edition book shows no edition line.
