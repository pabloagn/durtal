# Task 0872: Preserve edition drafts across section expansion

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-981
**Blocks**: SLN-930

## Overview

SLN-982: expanding Language in Edit edition registered an unsaved change before any value was edited. The draft tracker captured the form before the collapsed section mounted its controls; restoring English still left two added fields. Native diagnosis confirmed the same behavior before and after SLN-981.

## Implementation Details

- FormSection offers an opt-in persistent field container. Collapsed fields stay in the draft inventory while hidden, inert, and disabled. Disabling the collapsed fieldset preserves existing native validation behavior; expanding restores normal validation.
- All eleven EditionForm sections opt in, including nested identifiers. Create and edit edition share this form. Controlled values, genuine conditional fields, and contributor removal retain their existing state semantics.
- The hidden Cover preview uses lazy image loading. No new data query, draft reset, or global tracker behavior is introduced.
- Mounted regressions use the real EditionForm, Dialog, FormSection and Select. They cover untouched expansion, change/restoration, real edits across collapse, conditional and contributor removal, native outside/Tab dismissal, validation and default non-opted-in behavior.

## Completion Notes

Source-only implementation on reviewed Select head f8fc8b34. Unit tests, full typecheck, build and native acceptance are pending a validation grant. InstanceForm retains the default mounting policy and is outside this repair. Original browser failures and the two-build diagnostic are preserved under `/private/tmp/sln930-grant25c-browser-retry1` and `/private/tmp/sln982-draft-diagnosis-retry1`.

The first unit attempt exposed a section-title test selector mismatch; the corrected run passed 95 of 96 tests and full typecheck. Its remaining failure was happy-dom's input validation ignoring an ancestor disabled fieldset. The DOM regression checks the actual collapsed fieldset flags and retained value, while still checking invalidity when expanded. A separate real three-engine FormSection fixture must verify open-invalid, collapsed-valid and reopened-invalid behavior before acceptance. These original failures remain preserved; native validation has not yet run.
