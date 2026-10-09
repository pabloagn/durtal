# Task 0422: Similar books from catalogue signals

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: SLN-327
**Blocks**: None

## Overview

SLN-334 extends the book page's collection-based similarity with explicit catalogue metadata and readable reasons. Reading predictions and sourced work relationships stay separate.

## Implementation Details

- The ranking query expands only the target book's sources through `UNION ALL`: collections, subjects, themes, literary movements, series, recommenders, authors/co-authors, edition translators and canonical publisher links. Unresolved publisher text is not treated as evidence.
- Each distinct book/kind/source contributes `baseWeight / distinctBookCount`, including the target in the denominator. Series: 2; collections, subjects, themes, movements and authors: 1; translators and recommenders: 0.75; publishers: 0.25. Continuations have stronger evidence; broad publishing affinity has weaker evidence. Multiple sources and kinds sum, with total weight ahead of source count.
- Duplicate edition membership and credit roles collapse before counting. Other work kinds are excluded from targets, candidates and source sizes. Equal scores retain collection member order, then bytewise title and UUID. Reasons sort by contribution, then kind/name/UUID.
- Only ranked IDs up to the requested limit load card relations. No schema migration, new dependencies, reading-prediction changes or new exploration page.
- The existing book-card carousel becomes “Similar books”. Two strongest reasons are visible in bounded two-line previews. “All reasons” opens a scrolling dialog with complete names, available on keyboard and touch. Complete titles and all author names wrap naturally in the existing 208px minimum card family.
- Impact audit: `getSimilarWorks` has one caller (book detail). `WorkCarousel` has four book-detail rows (series, author, similarity, marks); showing all author names affects those rows, with no shared card-style edits. Long/short/absent reason behavior is covered by focused UI tests; actual-app geometry and responsive checks remain required.

## Completion Notes

Implementation prepared. Focused UI/regression tests: 10 passed across three suites, zero skipped (similarity reasons, Escape handling and cap-aligned menus). Typecheck passed. Lint passed with zero errors (75 existing repository warnings). Supplemental reason previews reserve a consistent four-line area to keep card footers aligned across short/long reasons. Disposable PostgreSQL integration checks, production/Docker builds, actual-app responsive/interaction/alignment/page-weight evidence and the complete zero-skipped local suite await the coordinator's heavy-validation slot. No merge authorized.
