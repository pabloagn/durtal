# Task 0443: Reader speech and accessibility

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-499, SLN-500, SLN-501, SLN-502, SLN-503
**Blocks**: SLN-509

## Overview

SLN-508 adds sentence-by-sentence read aloud and complete keyboard/accessibility paths. The approved pure helpers start from reviewed reader source `626f4870`. The source checkpoints add a browser speech driver, reflowable extraction, and mounted player/accessibility components. The full ticket remains open; reader adapter/mounting, audits and deployment depend on accepted upstream runtime contracts and validation.

## Implementation Details

- `src/lib/reader/speech/player.ts`: pure player reducer with declarative commands. Preparation never starts first playback automatically; Play emits the prepared real sentence's speak command synchronously. Current/previous/next sentence state and one queued successor are bounded. Generation/utterance tokens reject stale callbacks after navigation, pause, restart, stop or failure. Native event ordering, delayed section preparation, rapid skips, active and queued voice failures, one retry per sentence, EOF and paused selection are covered.
- `cancellation.ts`: pure callback identity and monotonic generation helpers. No AbortController, timers or native speech effects are introduced here.
- `voices.ts`: exact/primary language ranking, local-service/default tie breaking, explicit cross-language choices, passage fallback, grouped language menus and the six allowed rates. Versioned injected preference storage rejects malformed/oversized records, bounds remembered languages/URI lengths, and handles storage failure and disappeared voices. No browser globals are accessed.
- `segmentation-policy.ts`: containing-sentence starts for explicit locators, first-intersecting-sentence starts for visible pages, nearest valid language inheritance, semantic note/page/ruby exclusion, accepted-text assembly, linear-section policy and extraction scheduling limits. DOM extraction and Intl.Segmenter implementation remain adapter work.
- Automatic speech movement policy saves real position but supplies no human tracker activity, pace sample or automatic completion confirmation. The mounted bridge/navigation integration enforces this; native and full acceptance remain pending.

Accepted root contracts: prepare lazy speech chunks and the first real sentence after reader first paint in bounded idle work; enable Start only after readiness; keep native first speak synchronous in the trusted handler and measure preparation separately. Five empty sampled PDF pages mean sampled absence, never proof of an entirely textless document; capabilities must recover when mixed/sparse PDF text is discovered. Physical device/screen-reader evidence must be distinguished from browser observations.

No schema, migration, dependency, backend, AWS or live data changes are included in these source checkpoints.

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


### Reader mounting on approved navigation source

Normal-merged exact independently approved SLN-499 `f1c4cadf994592755b3ac214f291c9e4e7fc1eea` (merge `b71f6519`), preserving speech source checkpoint `e1727f92` and approved pure `053960b4`. No primary-checkout changes or history rewrites.

- Foliate now concretely implements optional `prepareSpeech({ target, signal })` for reflowable formats. It walks real text nodes, segments per block/language with `Intl.Segmenter`, creates exact CFI/range locators, and returns bounded current/previous/next sentence records. Traversal yields after 128 nodes or an 8 ms slice; a pathological block above one million characters fails visibly. It holds no persistent document/sentence cache, never reads image alt text, excludes semantic notes/page markers/ruby readings, rejects another file's anchor, and skips non-linear sections in automatic extraction. Requests own late delivery and do not destroy or move the renderer. Live visible ranges and explicit containing locators have focused regressions, including a reproduced/fixed boundary-comparison error.
- The coordinator lazy-loads after first reader paint/idle scheduling, prepares actual text before enabling Start, then invokes native speak directly in the trusted handler. Latest `reader-speech-preparation` and `reader-speech-start` Performance entries separate extraction from the native start callback; no performance budget is asserted without native measurements.
- `speechTo` uses the existing navigation ownership/paint/recovery path with a speech origin. It reanchors current history without human jump steps and suppresses activity/EOF publication. The reader updates actual context, sync place and position queue, while avoiding tracker location/activity/end events and pace samples. Human navigation cancels speech/extraction immediately, preserves already-authorized playback intent until the painted landing, and resumes only prepared landing text. Hidden/disposed/stale work cannot resume.
- Player and announcer are mounted. Actual key routing handles a/comma/period and reserves Escape layering. Menus own input, the player reports actual height, the book reserves its occupied inset, and speed/voice choices retain actual preference storage. Focus restoration and reduced-motion classes reuse app controls.

Final source checkpoint validation: **163 passed, 0 failed, 0 skipped across 13 affected lightweight suites**; scoped TypeScript (including adapter/reader integration), scoped zero-warning ESLint, formatting and whitespace checks pass. Test doubles/DOM checks are not native browser or physical screen-reader/device evidence.

Still gated: measured PDF text/capability recovery from SLN-502; independent speech decoration groups from SLN-500; non-semantic note detection and note/table keyboard paths from SLN-503; completed presentation/contrast/inset contracts from SLN-501. No fake geometry or competing PDF text API was added. Full keyboard/accessibility ticket completion, native three-engine/three-width audits, real performance budgets, zero-skip full DB suite, full static/build/CI gates and deployment remain unclaimed and root-controlled.


### Accessibility and selection source checkpoint under QUIET-494

- The concrete reflowable adapter exposes `speech().segments(from, { signal })` over its actual bounded preparation method. It yields exact plain-text records, follows section successors only as consumed, rejects canceled owners and stops when the engine closes. A non-advancing extractor surfaces an error. This uses no PDF stand-in, SSML, native calls or persistent sentence cache.
- Skip to the book is the first reader link and delegates focus to the actual current book document. DOM order is top bar, book, speech player, bottom bar. Loaded frames receive title/chapter names and normal tab stops; declared document languages are preserved, with publication language fallback. Focus entering text outside the visible range requests an owned human turn without adding a jump-history step. In-book focus-visible CSS uses the foreground token, and reduced-motion document CSS suppresses smooth scrolling, animations and transitions. Contrast, native focus/AX behavior and zoom/text-spacing results remain unmeasured.
- Pausing can create a real native selection from the exact current CFI after owned navigation paints. Generation and sentence checks reject stale effects. A user selection prepares its containing sentence, and Read aloud from here remains disabled until that selection is ready; its handler then speaks synchronously. Selection present before lazy coordinator startup is retained. Existing native selection APIs are used directly; no SLN-500 decoration runtime is imitated.
- Inspected SLN-502 producer `1ee0c65279d29a6cb405a4e6695081256f51a209` read-only. Its text preserves exact UTF-16 offsets, and glyph quads come from actual pdf.js TextLayer Range measurements converted into PDF user units. Missing measured coverage produces a null locator. The producer is not independently approved and its public text/offset methods, leases and teardown wiring are not mounted here. No upstream PDF source was merged and no competing geometry API was created.

Before QUIET-494 was requested, **45 tests passed, 0 failed, 0 skipped across five affected suites**, and the scoped TypeScript check passed for that intermediate source. Earlier checkpoint `1640c284` had 163 passing lightweight cases across 13 suites. Subsequent additions (the engine enumeration cancellation cases, selection-toolbar readiness case, initial-selection preservation and foreground focus-ring token) have **not been run**. Root requested all local tests, static checks, browsers, builds and font processing pause for SLN-494 measurements. This committed source snapshot is reviewable but does not carry a final validated test count. All native/full/heavy acceptance and deployment remain pending.


## Historical checkpoint moved from the development guide (29 October 2026)

The following preserves the earlier source checkpoint and its outstanding acceptance at that time; it is not a new completion claim.

### Reader speech source validation boundary (SLN-508)

Checkpoint `1640c284` passed 163 lightweight cases across 13 affected suites using existing dependencies. The subsequent accessibility/selection mounting passed 45 cases across five suites and scoped TypeScript before the root's QUIET-494 window. Follow-up engine enumeration and selection readiness tests are committed but unrun. Resume tests, scoped types/lint/formatting and full acceptance only after root releases the quiet window; a source-only commit is not final test acceptance.

The remaining acceptance includes approved PDF/decorations/presentation/note runtimes, native Chromium/Firefox/WebKit at 1440/768/390, full accessibility and interaction audits, trusted touch, 200% zoom/text spacing, real speech/turn/section/idle measurements, the full zero-skip DB suite, project static/build/CI gates and root-authorized deployment. Test-double speech callbacks and happy-dom frame assertions establish source behavior only. Keep physical device/screen-reader proof separate. Do not run these against the primary checkout or manual port 3100, and do not install dependencies for a gated checkpoint.
