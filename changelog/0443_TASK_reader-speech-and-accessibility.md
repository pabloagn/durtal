# Task 0443: Reader speech and accessibility

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-499, SLN-500, SLN-501, SLN-502, SLN-503
**Blocks**: SLN-509

## Overview

SLN-508 adds sentence-by-sentence read aloud and complete keyboard/accessibility paths. The approved pure helpers start from reviewed reader source `626f4870`. The next source checkpoint adds a browser speech driver and unmounted player/accessibility components. The full ticket remains open; reader adapter/mounting, audits and deployment depend on accepted upstream runtime contracts and validation.

## Implementation Details

- `src/lib/reader/speech/player.ts`: pure player reducer with declarative commands. Preparation never starts first playback automatically; Play emits the prepared real sentence's speak command synchronously. Current/previous/next sentence state and one queued successor are bounded. Generation/utterance tokens reject stale callbacks after navigation, pause, restart, stop or failure. Native event ordering, delayed section preparation, rapid skips, active and queued voice failures, one retry per sentence, EOF and paused selection are covered.
- `cancellation.ts`: pure callback identity and monotonic generation helpers. No AbortController, timers or native speech effects are introduced here.
- `voices.ts`: exact/primary language ranking, local-service/default tie breaking, explicit cross-language choices, passage fallback, grouped language menus and the six allowed rates. Versioned injected preference storage rejects malformed/oversized records, bounds remembered languages/URI lengths, and handles storage failure and disappeared voices. No browser globals are accessed.
- `segmentation-policy.ts`: containing-sentence starts for explicit locators, first-intersecting-sentence starts for visible pages, nearest valid language inheritance, semantic note/page/ruby exclusion, accepted-text assembly, linear-section policy and extraction scheduling limits. DOM extraction and Intl.Segmenter implementation remain adapter work.
- Automatic speech movement policy saves real position but supplies no human tracker activity, pace sample or automatic completion confirmation. The bridge/navigation integration that enforces this remains pending.

Accepted root contracts: prepare lazy speech chunks and the first real sentence after reader first paint in bounded idle work; enable Start only after readiness; keep native first speak synchronous in the trusted handler and measure preparation separately. Five empty sampled PDF pages mean sampled absence, never proof of an entirely textless document; capabilities must recover when mixed/sparse PDF text is discovered. Physical device/screen-reader evidence must be distinguished from browser observations.

No schema, migration, dependency, reader adapter, backend, AWS or live data changes are included in these source checkpoints.

## Completion Notes

Pure checkpoint validation on the Mac using existing dependencies, without installs:

- Three focused Vitest suites: **65 passed, 0 failed, 0 skipped** (25 player, 19 voices/storage, 21 segmentation/cancellation policies).
- Scoped TypeScript check extending the repository config and including all four helper modules and three test files: passed.
- ESLint on the four helper modules with `--max-warnings 0`: passed. Repository lint excludes test files.
- Prettier check on helper/test files and `git diff --check`: passed.

Full-project `pnpm typecheck`, `pnpm lint`, `pnpm deadcode`, unfiltered zero-skip `pnpm test:local`, production/Docker builds, CI, native three-engine/three-width testing, trusted touch, accessibility/interaction/design/alignment/page-weight audits and speech performance measurements are **not run at this gated checkpoint**. No physical speech or screen-reader proof is claimed. No deployment has occurred.

Remaining Done gates are the accepted complete plan: all text formats and cross-section speech, PDF capability truthfulness, selections/decorations, native lifecycle and language voices, every keyboard/a11y/reduced-motion feature, 1440/768/390 px Chromium/Firefox/WebKit audits, 200% zoom and text spacing, speech-start/turn/section/idle budgets on both profiles, full zero-skip DB suite, exact-head CI/build gates, required docs and root-authorized deployment. This checkpoint is ready for source review, not ticket completion.

Source-review correction (2026-10-09): independently reported retry identity leakage was reproduced by two new failing regressions on checkpoint `9422f02e`. When Previous/Next required preparation after the current sentence had used its retry, the newly prepared sentence inherited `retry: 1`. The `prepared` transition now retains the retry count only when the incoming locator identifies the same sentence; a different sentence starts with `retry: 0`. Tests exercise both skip directions, the new sentence's first failure retry and second failure pause, old utterance/extraction callbacks remaining inert, and the same-sentence preparation retaining its bounded retry. Updated focused validation: **68 passed, 0 failed, 0 skipped** (28 player, 19 voices/storage, 21 policies); scoped types, helper ESLint, formatting and diff whitespace checks pass. Effectful integration and all full/native/heavy gates remain deferred.


### Approved pure source and effectful source preparation

Root independently approved exact pure checkpoint `053960b435ffefb15703402e451165b20efe58dc` (`PURE_SOURCE_APPROVE`), reproducing its 68 focused tests. That approval is source-only, not feature acceptance.

The native driver uses real browser speech API types and the approved reducer commands. It calls `speak()` synchronously, holds at most two utterances, detaches native callbacks before cancellation, rejects stale generations, refreshes voices, and cancels on hide/pagehide/disposal. One-shot start/completion deadlines surface missing native callbacks as errors; they never fabricate native start/end events. A queued successor does not inherit the first utterance's start deadline. Physical/browser speech evidence remains pending.

Unmounted player components reuse existing app popover/dialog controls, provide the six speeds and grouped voice choices, expose named icon controls and error recovery, restore menu focus, report occupied height, and accept actual inset input. One atomic polite reader announcer coalesces rapid turns, reports jumps and speech state transitions, and avoids per-sentence chatter. Reader mounting, key dispatch, extraction, progress ownership and decorations remain integration work.

Reviewed SLN-502's proposed `pdfPageText({ fileHash, pageIndex, signal })` and `locatorForPdfTextOffsets({ fileHash, pageIndex, signal, start, end })` contract. Speech offsets must remain UTF-16 offsets in the exact source text; a missing measured locator is null, never invented glyph geometry. Each speech extraction owns only its cancellation/measurement lease and cannot cancel visible PDF rendering or shared document transport. This checkpoint does not implement or pretend to use that unimplemented provider.

Lightweight source validation: 14 native-driver test-double cases and 12 React/DOM component cases pass without skips. These checks establish callback ownership and component behavior, not native browser, screen-reader, touch-device, viewport/alignment or performance evidence. Full/heavy gates remain reserved to the root slot.
