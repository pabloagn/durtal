# Task 0847: Finish taxonomy browsing and linked term pages

**Status**: Completed
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-957, SLN-958, SLN-959
**Blocks**: None

## Overview

Complete SLN-960, SLN-936 and SLN-961: bounded family browsing, lean SQL-paged book cards, and connected hierarchy and edition navigation.

## Implementation Details

- Server-filtered and paginated large vocabularies; small hierarchies stay complete, large branches load on expansion.
- Load editor choices only when an editor opens; preserve sibling-only merge choices and all-scope deletion protection.
- Fetch only a page of linked books, select lean author/card columns and read availability alongside card data.
- Show ancestor breadcrumbs, immediate children, direct and descendant counts, edition-linked parent books and navigable custom terms.
- Redirect merged term addresses within their family; shaped skeletons and taxonomy page-weight budgets.

## Completion Notes

- Typecheck and production build pass; lint has no errors and 80 pre-existing warnings.
- Disposable PostgreSQL tests verify deletion/merge safety, stable reorders, 900-term pagination, 250-book natural ordering, ancestor/descendant counts, edition deduplication and family-scoped redirects.
- The complete shared-UI/database run passed 1,004 checks; its obsolete source-string empty-state assertion was replaced with a rendered check. All 31 targeted empty-state/filter checks pass, including slow-response focus retention. No Vitest suites skipped; byte-identical, previously passed Python preflight reused.
- Chromium, Firefox and WebKit pass 27 scenarios, including 63 route/width alignment and design audits, pagination, lazy branches, term links and creation.
- At 200 ms simulated database RTT: 900-term family 222 KB and 431–439 ms; 250-book subject 226 KB and 864–867 ms; tag 225 KB and 852–868 ms. The same routes also pass at 40 ms.
- Page-weight checks pass the taxonomy routes. The stress fixture exposes a separate pre-existing /people biography payload overrun (535 KB), tracked as SLN-974; no taxonomy waiver or budget increase was added.
- No deployment, live catalogue write or migration.
