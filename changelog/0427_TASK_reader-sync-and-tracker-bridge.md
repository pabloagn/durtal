# Task 0427: Reader places across devices and tracker bridge

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-490, SLN-518, SLN-491, SLN-492
**Blocks**: SLN-454, SLN-499, SLN-507, SLN-509

## Overview

SLN-493 adds cross-device opening/resume offers and the reader's typed plugin bridge, notice strip and Copy selection toolbar. The production plugin list stays empty; the reader never touches tracker tables or APIs. No migration, dependency or live operation.

## Implementation Details

- One page query includes own file history and newest other place; GET lists every device/file with cookie flags, while POST preserves stale-save/furthest semantics.
- Pure difference/newest rules; persistent decline watermark; cross-format fraction opening and Go there. Visibility/online refresh awaits queue flushing, coalesces triggers and discards responses after local intent.
- Event bus defers dispatch through a frame then microtask, throttles visible activity and uses actual end visibility with 98% rearming. Provider/context and ordered portals isolate plugins and preserve engine/frame identity.
- Reserved/guarded frame shortcuts, native Shift+Arrow selection and Space/Enter buttons. Bounded display-only iPad touch hint on the shared fetch/beacon URL leaves body and HttpOnly identity unchanged.
- Settled selection host bounds and full-quote context, Copy/Copied, keyboard Tab/Escape; reader notice precedence and fixed bottom status slot.
- Guarded `/sln493_reader_sync` database regressions and a disposable same-e-book EPUB/PDF seed are prepared for the runtime slot.

## Completion Notes

Source checkpoint only. `pnpm exec vitest run src/__tests__/reader`: 148 tests in 20 files passed, zero skipped. `pnpm typecheck`, scoped reader lint (zero warnings/errors) and `git diff --check` pass. These are focused source checks only. Full local/database/Python, production/Docker/CI, native two-device/browser matrix, alignment/design/page weight/performance and source-map/served-chunk provenance remain pending an explicit heavy-work slot and final-head independent review. No runtime evidence is claimed yet. Existing phone opening performance misses remain SLN-553 scope.
