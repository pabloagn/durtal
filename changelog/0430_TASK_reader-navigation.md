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
