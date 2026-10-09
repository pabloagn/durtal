# Task 0426: Image rotation

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-557 editor integration
**Blocks**: None

## Overview

Add reversible display rotation for the existing registered image subjects, preserving original bytes, crop coordinate semantics, image policies and filters. The approved scope rotates the whole stored raster when no crop is baked; an explicit saved crop rotates its selected region. Neutral framing must not silently crop a rotation-only save. Rotation rendering and controls are a later stage.

## Implementation Details

Stage 1 establishes the shared editor contract independently of its layout:

- Crop capability and aspect follow the resolved owner's policy, including contained perfumes, paintings, art objects and organization logos. The same policy is enforced on Save.
- Reads distinguish current display pixels from the retained preview base and expose baked-crop provenance.
- Opaque fingerprints are computed in SQL from the registered source and adjustment row with full timestamp precision. Save requires the loaded revision; advisory identity locks cover absent adjustment rows, actual row locks freeze the source/settings and work policy, and an in-transaction assertion rejects stale saves before paired writes. Media crop commits keep the same guard and cleanup path, returning the committed next revision.
- The current editor only retains/passes the revision and handles the fixed serializable stale-save result (so production error redaction does not hide the reload/review message). Its control layout, slider/filter behavior and preview rendering are unchanged. SLN-557 consumes this contract before rotation rendering proceeds.
- Existing JSON/schema remain unchanged. No new dependency, live migration, original rewrite or expanded editable-source policy.

## Completion Notes

Foundation-only checkpoint: 53 focused policy/action/query-compilation/commit-cleanup and existing filter/crop tests passed, with zero skipped. Static typecheck passed; changed-source lint passed with the existing preview-image warning and no errors. No real database was used. Disposable PostgreSQL regressions are prepared for competing first saves, sub-millisecond revisions, contained-policy refusal and stale-crop cleanup; their execution awaits the heavy-slot grant. Production/browser/full-suite gates and rotation pixel/persistence evidence remain required before landing.
