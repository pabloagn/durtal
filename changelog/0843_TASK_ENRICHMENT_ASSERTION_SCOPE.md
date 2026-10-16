# Task 0843: Scope enrichment claims to texts and components

**Status**: In Review
**Created**: 2026-10-16
**Priority**: HIGH
**Type**: Improvement
**Depends On**: SLN-969
**Blocks**: SLN-971, SLN-972, SLN-973

## Overview

SLN-970 extends the existing claim/evidence model so a translation, one story
or an introduction cannot be treated as an unrestricted Work assertion.

## Implementation Details

- Contract-1 scope identifies baseline/text, languages, publication link,
  component type and relation. Unknown identity retains its source anchor.
- Knowledge/coverage is separate from the review decision. Missing evidence
  does not manufacture absence. Exact scope participates in deduplication,
  conflict, merge, undo and immutable database guards.
- Public-source extraction defaults to unresolved source-local text unless
  an explicit source scope is supplied. Evidence from different versions or
  components cannot be pooled to pass the independence check.
- Scoped assertions cannot enter catalogue application or identity auto-rules.
  Historical rows and accepted owner corrections remain intact.
- Generated migration 0089 is for source review and local disposable tests
  only. No live migration, catalogue write, automatic acceptance, vocabulary
  load or full-book transfer is performed.

## Completion Notes

Type checking and lint pass. After incorporating the reviewed SLN-969 fixes,
the affected enrichment/network/service suite passes 358 tests in 20 files,
zero skipped, through the repository's disposable-database harness. Python
preflight passed in the earlier standard run; the unchanged FIFO check later
stalled on repetition, so this latest run reused that historical result. The
disposable container is removed. Full final-head CI remains a merge gate.
Synthetic fixtures cover the original/translation boundary, same versus
different publication, Labyrinths-style aggregates, unknown translations,
coverage, concurrent deduplication and direct database bypass attempts.
The generated migration was exercised only in these disposable databases.
