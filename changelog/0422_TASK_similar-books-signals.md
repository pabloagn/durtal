# Task 0422: Similar books from catalogue signals

**Status**: Completed
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
- The existing book-card carousel becomes “Similar books”. Two strongest reasons are visible in bounded two-line previews. “All reasons” opens a scrolling dialog with complete names, available on keyboard and touch. Complete titles and distinct author names wrap naturally in the existing 208px minimum card family.
- Impact audit: `getSimilarWorks` has one caller (book detail). `WorkCarousel` has four book-detail rows (series, author, similarity, marks); showing all author names affects those rows, with no shared card-style edits. Long/short/absent reason behavior is covered by focused UI tests. Actual production QA exposed unbroken taxonomy-name overflow and the single-control native-dialog Tab cycle: book taxonomy chips now wrap in full, and the reasons dialog retains forward/reverse focus. Shared dialog/card styling remains untouched.

## Completion Notes

Implementation and focused database validation completed. All 29 similarity PostgreSQL tests pass with zero skips, including every new signal, rarity, combined weighting, duplicate roles/editions, deterministic ties, empty data and book-kind isolation. Disposable fixtures explicitly confirm canonical publisher links and configure the film literary-movement taxonomy scope, respecting existing database guards. Final exact-head production/browser, Docker, full-suite and CI evidence is recorded in the PR and local validation checkpoint; merge remains subject to independent review and coordinator authorization.
