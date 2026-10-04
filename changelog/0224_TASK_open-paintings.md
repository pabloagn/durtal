# Task 0224: Open the Painting Collection

**Status**: In Progress
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0223 (painting pages, SLN-368), 0222 (open perfumes), 0213 (films)
**Blocks**: None

## Overview

Part of SLN-382 (staged activation). With the painting pages built (task 0223), this task turns the painting collection on: `/paintings` and its pages stop answering 404, and the sidebar, the Go and Add menus (`G I`, `A I`), the collection switch and the dashboard name Paintings.

## Implementation Details

- `src/lib/catalogue/domains.ts`: `painting.enabled: true`.
- Tests: `domain-navigation.test.ts` (Paintings in the sidebar and menus; the `/paintings` layout lets requests through; perfumes and films still 404 on this branch) and `work-kinds.test.ts` (`["book", "painting"]` on this branch).
- Docs: `docs/02_DATA_MODEL.md`, `docs/04_ROUTES_AND_VIEWS.md`, `docs/14_CURATED_LIBRARY_PLAN.md`.

**The migration is not in this change yet.** `works_kind_enabled_check` is written by the perfume activation (PR #10, `0053_open_perfumes`, books and perfumes) and the film activation (PR #12, its own `0053`, books and films). The painting migration is generated after both have merged, from the then-current schema, listing `book`, `perfume`, `film` and `painting`, with the number the coordinator gives. Until then `work-kind-migration.test.ts` fails on this branch: it asserts that the database accepts exactly the open kinds, and the database still accepts only books. The test is kept as it is.

- `curation-holdings.test.ts` asserted that the painting `artObjects` capability is unusable; it now asserts that a capability follows its domain's switch, and that `reading` stays unusable for paintings.
- `book-domain-isolation.test.ts`: a taxonomy family's card counts every open collection's records, so the subject on one book and one painting counts 2. Its items still count books only.

## Completion Notes

**Verification so far:** `pnpm typecheck` passes. `python3 scripts/qa/test-local.py`: 1,510 of 1,511 tests pass; the one failure is `work-kind-migration.test.ts` "registers all explicit kinds but enables only the ready domain", as expected until the migration exists. `alignment-audit.js` and `design-audit.js` on `/`, `/library`, `/paintings`, `/paintings/new` and `/settings/about` at 1440, 768 and 390 px with Paintings in the sidebar: 0 deviations, 0 low-contrast texts, 0 unnamed or nested controls, no horizontal scroll, no console errors. The painting pages themselves were checked in task 0223.

Draft. To finish: rebase onto main after #10, #12 and #15 merge; generate the migration; rerun the suite (the kind test then passes); apply the migration to live after the merge (backup first, read-only check after).
