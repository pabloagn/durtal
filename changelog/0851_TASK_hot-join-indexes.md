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

Disposable database tests and catalogue-scale before/after measurements
remain pending. The migration has not been applied to any database.
No live database changes are part of this task.
