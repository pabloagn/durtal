# Task 0389: Research queue: a book skipped for no author is researched later; a new edition queues no second research

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0360 (SLN-469 research stage)
**Blocks**: None

## Overview

SLN-530, follow-ups 4 and 5 from the review of PR #143. Two gaps in when the
research job is queued:

1. A book researched before it had an author was never researched again by a
   scope run. Its job finished as `done` with the outcome `skipped`, and a
   scope run of research left out every book with a done research job.
2. A new edition with an ISBN (`createEdition`) or a placeholder given its ISBN
   (`identifyEdition`) queued a second research job for a book already
   researched.

## Implementation Details

- `researchedCondition(workId)` in `src/lib/enrichment/queue.ts` is the one
  rule for "this book is researched": a research job of it is `done` and its
  outcome is not `skipped`. A done job with no outcome still counts, so no
  book researched before outcomes were stored is searched again.
- `enqueueScope` (`src/lib/enrichment/worker.ts`) uses it for the research
  scope rule. A book skipped for having no author is queued again by the next
  scope run; while it still has no author, its job is skipped again, which
  costs nothing (the plan makes no search).
- `queueNewBookEnrichment` reads the same condition with the book's priority,
  in the same query, and queues the research job only for a book not yet
  researched. Identity is still queued every time. This covers every caller,
  not only the two actions the ticket names; a new book has no research job,
  so it still queues both. To research a researched book again:
  `--enqueue research --only SLUG`, as before.
- docs/01 (the worker's scope rule) and docs/06 (the actions that queue jobs)
  say so.

## Completion Notes

- Two new tests in `src/__tests__/integration/research-agent.test.ts`, both
  failing before the change:
  - a book without an author is skipped by the real research stage (no
    search), gets an author, is queued by a scope run, is researched, and is
    then left out by the next scope run;
  - `createEdition` with an ISBN on a researched book queues identity only; on
    a book whose research was skipped for no author it queues research too.
- The existing scope test (a done job with no outcome counts as researched)
  passes unchanged.
- Built in a cloud session: no live data touched.
