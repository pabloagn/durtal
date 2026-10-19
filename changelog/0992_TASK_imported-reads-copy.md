# Task 0992: Imported readings take the book's only copy or edition

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1171, from the statistics survey (findings/statistics-survey-2026-10-18.md, finding 5). A Goodreads row matched by title and author named only the book, so all 3,027 readings of the survey's import had no edition and no copy. Where and how then called them all Print and "No copy (borrowed, library)". The translation share disappeared, and the own copies against borrowed insight could never appear.

## Implementation Details

- **At the commit** (`commitImport` in `lib/reading/import/store.ts`, `singleCopyLinks` in the new `lib/reading/import/single-copy.ts`): a Goodreads or StoryGraph row with no edition from the file is linked as follows.
  - A book with exactly one copy (deaccessioned ones aside) gets that copy and its edition.
  - Otherwise, a book with exactly one edition gets the edition.
  - Anything else stays unlinked.
  - One query covers every book in the commit.
  - A Goodreads reading takes the linked copy's format (`formatOfCopy`), since Goodreads keeps none. StoryGraph keeps the format its file gives.
  - A linked edition's page count is the reading's total when the file has none, as with ISBN matches.
  - Durtal files name their own edition and copy and are left alone.
- **Where and how** (`whereAndHow` in `lib/reading/stats.ts`, the stats page): a Goodreads reading with no copy and no sessions counts as "Format not recorded", never Print. Copies says "Copy not recorded" rather than "No copy (borrowed, library)".
- **Insight:** the copies insight says "Books with no copy recorded get higher ratings than your own copies", not "Borrowed books…".
- **Existing imported readings** are left as they are; a backfill would be a live-data job for Joris.

## Completion Notes

- Reading import DB suite: a new test imports five title-matched rows and checks each book:
  - one e-book copy: that copy, its edition, format ebook and the edition's page count;
  - one edition and no copy: the edition only;
  - three editions, one of them with an active audiobook copy and one with a deaccessioned copy: the active copy and its edition, format audio;
  - two editions and no copy: nothing linked;
  - one edition with two copies: the edition only.
- Reading stats DB suite: a Goodreads reading with no copy counts as "unknown", a linked one under its copy's format, and a reading by hand stays Print.
- The survey's 3,030-row export was not re-imported here (it is not in the repo). The DB test covers the same single-edition and single-copy cases.
