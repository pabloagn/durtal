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
- Existing JSONB storage is retained. No new dependency, live migration, original rewrite or expanded editable-source policy.
- Foundation review corrections normalize empty full/thumbnail keys consistently in SQL and resolution, and return the fixed stale result when a former display alias disappears after a crop/reprocess. Known originals/documents and arbitrary database/validation errors retain their rejection paths. Exact thumbnail-only venue and removed-alias database regressions are prepared for the later disposable database gate.

## Completion Notes

Source-only rotation core now adds finite integer angle validation/defaults in the existing settings JSONB, canonical half-turn normalization, pure whole-raster/crop geometry and a React-owned image frame. The zero path returns the original node without observers or wrappers; only nonzero frames observe their content slot and actual decoded image dimensions. The containing layer owns rotation, leaving the image filter and outer animation/placement layers separate. No editor layout or image callers are changed in this stage. A standalone additive foundation correction preserves unchanged framing on filter-only saves, including legacy zoom, under the same guarded atomic commit. Explicit changed crops continue rebuilding from the retained base.

Rotation-core checkpoint: 103 focused tests passed, zero skipped, including every integer slider angle's four-corner containment, explicit crop rounding, source/resize/ref lifecycle and invalid-angle action boundaries. Source lint passed without warnings. Prepared disposable PostgreSQL regressions separately cover whole-raster rotation persistence/reset, legacy framing/bytes and explicit crop-plus-rotation. Native preview/plain image/Next Image/both-lightbox proof, broad caller integration, database/full-suite/build/browser gates and final review remain pending; this is not a completed feature.

Foundation-only checkpoint: 58 focused policy/action/query-compilation/commit-cleanup and existing filter/crop tests passed, with zero skipped, including foundation review corrections. Static typecheck passed; changed-source lint passed with the existing preview-image warning and no errors (the two corrected source files lint without warnings). No real database was used. Disposable PostgreSQL regressions are prepared for competing first saves, sub-millisecond revisions, contained-policy refusal, stale-crop cleanup, empty-full-key venue identity and removed aliases; their execution awaits the heavy-slot grant. Production/browser/full-suite gates and rotation pixel/persistence evidence remain required before landing.
