# Task 0428: Book related sections and genuine cross-kind similarity

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Separate genuine cross-kind similarity from author, translator, publishing-house, collection and mark browsing on the book page. Empty subsections disappear and similarity explanations are removed.

## Implementation Details

- Similarity uses exact scoped subjects/themes/keywords/literary movements/art movements, requires two shared items after hierarchy collapse, weights distinct enabled-work frequency and caps each family. Exact original work-year proximity contributes at most 10%; editions, approximate/range dates and unrelated associations do not establish similarity.
- Contributor groups isolate author/coauthor and translator roles. Canonical publisher families expand only the linked identity and descendants. Groups deduplicate before their limits and translator/publisher cards identify matching editions.
- Mixed shelves use existing BookCard and DomainTileCard/WorkCardArt anatomy, full identifying text and type-correct routes. Shared carousel geometry, editions/instances, reading controls, collections and real relationships remain.
- Focused disposable database tests cover positive cross-kind evidence, sparse/negative controls, hierarchy, deterministic ranking, original dates, collection independence, roles and matching editions.

## Completion Notes

Source checkpoint: typecheck passes; four focused PostgreSQL suites pass 44 tests with zero skips; two focused card UI suites pass 6 tests. Scoped lint has no errors (the existing native image warning remains; test files are excluded by repository lint configuration). The tests use newly created loopback-only PostgreSQL 16.15 containers on an owned Colima profile, pinned to the previously approved image digest, with automatic container cleanup. Independent source review, native journeys, responsive/alignment/contrast/touch/page-weight checks and final full validation remain pending. No merge or live-data operation has occurred.
