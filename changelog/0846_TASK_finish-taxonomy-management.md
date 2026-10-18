# Task 0846: Finish taxonomy management and hierarchy controls

**Status**: Completed
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-957, SLN-958, SLN-959, SLN-942
**Blocks**: SLN-960, SLN-961

## Overview

Offer valid taxonomy deletion and merge choices, preserve the selected ordering, and make the hierarchy readable and keyboard accessible.

## Implementation Details

- Return expected taxonomy refusals through the shared UI boundary while preserving unexpected-error protection.
- Keep linked items and parents protected in direct deletion, including custom families whose foreign keys allow cascades.
- Offer sibling merge/reassignment targets and explain when children must move first.
- Respect incoming sort order; allow dragging only in the unfiltered manual view of orderable families.
- Reorder selected slots without moving unlisted rows or introducing tied positions; append new items under the same lock.
- Reserve identical hierarchy control space for leaf/parent rows, use fixed 20px indentation, wrap names and name controls per item.

## Completion Notes

- Typecheck and production build pass; lint has no errors and 80 pre-existing warnings.
- Disposable PostgreSQL tests verify deletion/merge safety, stable reorders, 900-term pagination, 250-book natural ordering, ancestor/descendant counts, edition deduplication and family-scoped redirects.
- The complete shared-UI/database run passed 1,004 checks; its obsolete source-string empty-state assertion was replaced with a rendered check. All 31 targeted empty-state/filter checks pass, including slow-response focus retention. No Vitest suites skipped; byte-identical, previously passed Python preflight reused.
- Chromium, Firefox and WebKit pass 27 scenarios, including 63 route/width alignment and design audits, pagination, lazy branches, term links and creation.
- At 200 ms simulated database RTT: 900-term family 222 KB and 431–439 ms; 250-book subject 226 KB and 864–867 ms; tag 225 KB and 852–868 ms. The same routes also pass at 40 ms.
- Page-weight checks pass the taxonomy routes. The stress fixture exposes a separate pre-existing /people biography payload overrun (535 KB), tracked as SLN-974; no taxonomy waiver or budget increase was added.
- No deployment, live catalogue write or migration.
