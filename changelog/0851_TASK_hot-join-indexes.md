# Task 0851: Index hot reverse junction lookups

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: Migration 0089
**Blocks**: None

## Overview

SLN-935: the People list repeatedly scans `work_authors` when joining each
person to their works. The existing composite primary key starts with
`work_id`, so it does not efficiently serve lookups by `author_id`.
Five other hot junction lookups have the same problem.

## Implementation Details

- Add non-unique B-tree indexes to `work_authors.author_id`,
  `edition_contributors.author_id`, `edition_tags.tag_id`,
  `work_subjects.subject_id`, `custom_taxonomy_item_works.work_id`, and
  `work_art_movements.art_movement_id`.
- Document the lookup direction each index serves in `docs/02_DATA_MODEL.md`.
- Cover all six reverse lookup columns with schema regression tests that
  require an unconditional B-tree index with the lookup column first.
- Rehearse the migration on a guarded disposable database, checking that all
  six indexes are valid and ready, existing joins survive, and a second
  migration run changes no rows.

## Validation

Migration `0090_hot_join_indexes` was generated on the frozen PR #467
dependency (`d42f0249`), after its genuine migration 0089. Source inspection
confirms exactly six non-unique B-tree indexes, no other snapshot changes,
and an unchanged journal prefix followed by 0090. This branch depends on
PR #467 and must not merge before it.

Validated source: `3902a42cc6491aaf0677cf4d9646900224f6278f`.
The 71 focused tests passed with zero skips, including populated-junction
preservation, valid/ready indexes, repeated migration application, the full
reader migration chain, People credits, search and taxonomy applicability.
Typecheck also passed. All 11 Python prerequisite scripts were verified
byte-for-byte against prior passing evidence before that evidence was reused.

A separate disposable PostgreSQL comparison used a deterministic replacement
fixture: 5,006 works (5,000 books and six paintings), 5,503 people and 5,000
editions. Its junctions contain 6,000 work credits, 6,666 edition credits,
10,000 edition tags, 15,000 subjects, 10,000 custom-item links and 12 movement
links. This is not the lost historical survey fixture.

After two warmups, seven samples per operation gave these local-driver
medians. These are database/action measurements, not HTTP page timings.

| Operation | Before indexes | After indexes |
| --- | ---: | ---: |
| People list | 624.74 ms | 10.21 ms |
| People search: `scale` | 597.01 ms | 10.80 ms |
| People search: `contributor` | 87.77 ms | 13.84 ms |
| People search: no match | 21.80 ms | 18.59 ms |
| People sorted by work count | 11.08 ms | 3.84 ms |

The additional six reverse-join probes had no measured regression. Query
plans use the new lookup indexes where useful; the twelve movement links
remain small enough for a sequential scan. All 144 public tables retained
their row counts and content hashes. Every compared query returned exactly
the same result, and applying the migration again changed nothing. The
separate benchmark's semantic test passed. Both disposable containers and
temporary test files were removed; no live database was changed.

Evidence: `/private/tmp/durtal-sln935-validation-r1/summary.json`,
`scale-comparison.json`, and `validation-cycle.json`.

Still pending: full hosted CI, the PR #467 dependency, and an exact-build
5k `/people` browser/page-weight acceptance run. Keep this task unfinished
until those gates are reconciled.
