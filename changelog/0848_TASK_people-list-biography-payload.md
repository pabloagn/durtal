# Task 0848: Keep full biographies out of the People list payload

**Status**: Completed
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-974: the People list sends complete biographies even when no biography is shown, exceeding its 300 KB budget on the recovery stress fixture.

## Implementation Details

- List reads opt out of biographies; existing API/detail reads retain complete content.
- The optional Bio table column loads the current page's biographies when enabled, with loading and retry feedback.
- No schema or data changes.

## Completion Notes

- The synthetic scale fixture's People response fell from 535 KB to 221 KB without truncating biography content.
- All 40 seeded page-weight routes pass; eight routes lack seeded content and are explicitly skipped.
- Nineteen affected database checks and four lazy-view state checks pass. Database runs used fresh disposable databases; the unchanged Python preflight result was reused because of the known host Python FIFO hang.
- Production build, TypeScript and lint pass (80 pre-existing warnings, no lint errors).
- Nine Chromium/Firefox/WebKit scenarios pass: hidden payload, full optional column, full detail biography, and grid alignment/design audits at 1440/390/320 px.
- Viewport assertions wait for responsive controls to settle after resizing; no persistent overflow was found.
- No migrations, provider requests, catalogue writes, or deployment.
