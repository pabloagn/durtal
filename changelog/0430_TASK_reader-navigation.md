# Task 0430: Reader navigation, contents and running lines

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493
**Blocks**: SLN-500, SLN-501, SLN-502, SLN-503, SLN-508, SLN-509

## Overview

SLN-499 gives the open reader a contents tree, preview scrubber, Go to, exact Back/Forward, publisher page labels and browser-only running lines and pace. Source is isolated on the approved SLN-493 checkpoint. No migration, dependency, deployment or live operation.

## Implementation Details

- One session owns jump serialization, cancellation, origin recovery and the relocate-plus-two-frame paint barrier. Failed, same-place and cancelled movements publish nothing. Ordinary turns queue through renderer transition/paint. History is capped at 100 entries; search chains share an origin; Back draws an 80-character paragraph-clipped or clicked-link outline.
- Contents is a responsive modal/non-modal side panel with a roving tree, current fragment, print/percent labels and linear-spine heading fallback. The scrubber previews locally, follows RTL, filters nearby ticks and commits only on release/Enter. Go to validates print pages, locations, percentages and accent-insensitive chapters. Shortcut help observes registered handlers; cross-layer guards reserve the epic keymap and keep direct jumps in the controller/adapter.
- Adobe page-map fallback is installed before view opening. Locators carry print labels and fresh one-based locations; legacy numbers never address a place. Non-linear locators retain true anchors and the last linear reading projection across UI, bridge, persistence and resume. End/100% use the actual final linear page.
- A file-hash position cache and bounded idle scans keep lookup work out of UI controls. Large EPUB inflation/decode/scan runs in a worker. Minimal documented MOBI/FB2 patches expose serialized text; KF8 retains unescaped fragment identifiers.
- Renderer-owned head/foot choices and primary-language pace learning stay in localStorage. Five eligible continuous forward samples establish an EMA; jumps, cancellation, hidden tabs and reflow interrupt it. Clock scheduling is visibility-aware with a 30-second minimum. The page query exposes existing character count without adding a query.
- Public-domain Huysmans navigation fixtures cover three-level/shared-spine contents, Roman/numeric page-list, Adobe page map, missing contents and trailing non-linear notes. Source generators prepare 2,100 TOC entries and a 2MB chapter. Native functional assertions and nine navigation/idle performance rows are added to the existing harnesses, including rapid-versus-paced ordinary turns.
- docs/02, docs/03 and docs/04 describe locator semantics, Quiet Glass controls, input ownership and the complete reserved keymap. Later layout/speech integration must extend command ownership and publication origin centrally; this checkpoint adds no typography or speech feature.

## Completion Notes

Source checkpoint only. Focused reader and cross-layer tests: 186 passed in 26 files, zero skipped, including late-arrival paint, rapid-turn queuing and non-linear UI/bridge/save projection regressions. Typecheck without incremental writes and explicit non-ignored scoped lint pass with zero warnings/errors; dead-code passes with two existing configuration hints. Harness JavaScript syntax and diff checks pass. Native fixture assertions, full local/database/Python, production/Docker, browser matrix, alignment within 0.5px, design, page weight and performance remain pending the coordinator's runtime slot and final-source review. No runtime measurements or acceptance are claimed. Existing phone opening misses remain SLN-553 scope. Main must be normally merged after SLN-493 lands before final acceptance.

### Source review revision

Independent review of `9a69cfd3` reproduced premature boundary turn activity, unowned reflow becoming a human turn/pace sample, and an unreachable recovery abort signal. The original failures remain review evidence. The review's 38ms rapid-turn queue regression passed; no paginator/view vendor edit is needed.

Input now publishes only genuine key/pointer activity. A matching owned turn publishes turn activity once after engine completion and paint. The adapter tags human/layout/speech origin; unowned reflow retains reading progress and updates its anchor/context quietly. Layout/speech cannot sample pace or produce human completion, stale/unowned arrivals cannot replace an active turn, and human scroll still publishes after paint. Session teardown aborts recovery/passive paint and immediately settles active/queued promises. The native rapid-turn comparison now waits for visible history controls to become idle instead of an acceptance sleep; the 38ms reproduction gap remains.

Regression coverage adds actual 100ms lock/promise semantics, stale/layout/speech arrival rejection, passive cancellation, hidden recovery teardown, boundary/failure/cancellation silence, one successful turn publication, quiet reflow and non-human pace suppression. The revised focused reader/cross-layer batch passes all 198 tests in 26 files, zero skipped. Typecheck without incremental writes, explicit non-ignored scoped lint (zero warnings/errors), dead-code, harness syntax and diff checks pass; dead-code retains the same two configuration hints. Native and heavy gates remain pending independent revision review and a runtime slot.

Exact revision files for rereview:

- Runtime: `src/lib/reader/navigation.ts`, `src/lib/reader/input.ts`, `src/lib/reader/pace.ts`, `src/lib/reader/history.ts`, `src/lib/reader/engine.ts`, `src/lib/reader/engines/foliate/engine.ts`, `src/app/reader/[ebookId]/reader-view.tsx`.
- Regressions: `src/__tests__/reader/navigation.test.ts`, `src/__tests__/reader/navigation-models.test.ts`, `src/__tests__/reader/reader-view.test.ts`, `src/__tests__/reader/foliate-bridge.test.ts`, `src/__tests__/reader/input.test.ts`, `src/__tests__/reader/fixtures/fake-engine.ts`.
- QA/docs: `scripts/qa/reader-navigation-checks.mjs`, `docs/04_ROUTES_AND_VIEWS.md`, this changelog.

API delta: turn methods now accept an optional navigation owner; relocate adds `layout` reason and optional human/layout/speech origin; owner accepts an optional origin. Current navigation operations publish human movement only. SLN-501 still needs its awaitable owned layout command; SLN-508 still needs an owned automatic-navigation command and speech-specific location/end publication. This revision guards those origins without implementing either feature.

### Section-boundary review correction

Independent rereview of `8618499` confirmed the original three findings were fixed, then reproduced a genuine section-boundary turn being classified as layout: the renderer emits `navigation` while its next/previous operation crosses the spine. The adapter now retains turn scope until that operation settles and translates its navigation arrival to a turn. Scrolled keyboard turns with an absent raw reason use the same operation scope. Unowned navigation and anchor reflow remain layout, including anchor reflow during an active turn. No vendor source changes or API changes are needed.

Two regressions cover that distinction and forward/backward spine transitions through the real adapter and controller. They assert publication only after paint, the owned human origin, a forward pace sample, no backward sample, no recovery and no extra history entry. The focused reader/cross-layer batch now passes all 200 tests in 26 files, zero skipped. Typecheck without incremental writes, scoped non-ignored lint with zero warnings, formatting, dead-code and diff checks pass; dead-code retains the same two configuration hints. Independent extension review and all native/heavy acceptance gates remain pending.

Exact correction files: `src/lib/reader/engines/foliate/engine.ts`, `src/__tests__/reader/foliate-bridge.test.ts`, this changelog.
