# Task 0443: Reader speech and accessibility

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-499, SLN-500, SLN-501, SLN-502, SLN-503
**Blocks**: SLN-509

## Overview

SLN-508 adds sentence-by-sentence read aloud and complete keyboard/accessibility paths. This checkpoint implements only the root-authorized pure helpers on reviewed reader source `626f4870`. The full ticket remains open; adapter, UI, native speech, audits and deployment are gated on upstream contracts and further authorization.

## Implementation Details

- `src/lib/reader/speech/player.ts`: pure player reducer with declarative commands. Preparation never starts first playback automatically; Play emits the prepared real sentence's speak command synchronously. Current/previous/next sentence state and one queued successor are bounded. Generation/utterance tokens reject stale callbacks after navigation, pause, restart, stop or failure. Native event ordering, delayed section preparation, rapid skips, active and queued voice failures, one retry per sentence, EOF and paused selection are covered.
- `cancellation.ts`: pure callback identity and monotonic generation helpers. No AbortController, timers or native speech effects are introduced here.
- `voices.ts`: exact/primary language ranking, local-service/default tie breaking, explicit cross-language choices, passage fallback, grouped language menus and the six allowed rates. Versioned injected preference storage rejects malformed/oversized records, bounds remembered languages/URI lengths, and handles storage failure and disappeared voices. No browser globals are accessed.
- `segmentation-policy.ts`: containing-sentence starts for explicit locators, first-intersecting-sentence starts for visible pages, nearest valid language inheritance, semantic note/page/ruby exclusion, accepted-text assembly, linear-section policy and extraction scheduling limits. DOM extraction and Intl.Segmenter implementation remain adapter work.
- Automatic speech movement policy saves real position but supplies no human tracker activity, pace sample or automatic completion confirmation. The bridge/navigation integration that enforces this remains pending.

Accepted root contracts: prepare lazy speech chunks and the first real sentence after reader first paint in bounded idle work; enable Start only after readiness; keep native first speak synchronous in the trusted handler and measure preparation separately. Five empty sampled PDF pages mean sampled absence, never proof of an entirely textless document; capabilities must recover when mixed/sparse PDF text is discovered. Physical device/screen-reader evidence must be distinguished from browser observations.

No schema, migration, dependency, adapter, UI, native speech, backend, AWS or live data changes are included.

## Completion Notes

Pure checkpoint validation on the Mac using existing dependencies, without installs:

- Three focused Vitest suites: **65 passed, 0 failed, 0 skipped** (25 player, 19 voices/storage, 21 segmentation/cancellation policies).
- Scoped TypeScript check extending the repository config and including all four helper modules and three test files: passed.
- ESLint on the four helper modules with `--max-warnings 0`: passed. Repository lint excludes test files.
- Prettier check on helper/test files and `git diff --check`: passed.

Full-project `pnpm typecheck`, `pnpm lint`, `pnpm deadcode`, unfiltered zero-skip `pnpm test:local`, production/Docker builds, CI, native three-engine/three-width testing, trusted touch, accessibility/interaction/design/alignment/page-weight audits and speech performance measurements are **not run at this gated checkpoint**. No physical speech or screen-reader proof is claimed. No deployment has occurred.

Remaining Done gates are the accepted complete plan: all text formats and cross-section speech, PDF capability truthfulness, selections/decorations, native lifecycle and language voices, every keyboard/a11y/reduced-motion feature, 1440/768/390 px Chromium/Firefox/WebKit audits, 200% zoom and text spacing, speech-start/turn/section/idle budgets on both profiles, full zero-skip DB suite, exact-head CI/build gates, required docs and root-authorized deployment. This checkpoint is ready for source review, not ticket completion.
