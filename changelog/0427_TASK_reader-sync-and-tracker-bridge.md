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


### Source review correction

Forward Tab now enters Copy only from a book document. Subsequent Tab presses in the host toolbar retain native traversal through plugin actions and out of the toolbar. The focused view/input/bridge batch passes 31 tests in 3 files with zero skips; the new regression explicitly allows second Tab, two plugin actions and exit. Native focus movement remains pending the heavy-work slot. Typecheck without incremental cache writes, explicit non-ignored lint of both changed TypeScript files, and diff checks pass.

### Storage merge acceptance — 9 October 2026

Normally merged SLN-569 main `94140915` into the reader branch; verified-gold/native-readable filtering and per-device history selection are both retained. The first full local run on combined source `ae7bf3a5` completed all 323 files: 3,498 tests passed, one reader-sync fixture test failed, zero skipped; all Python checks passed. That fixture used a noncanonical `files/<hash>.<format>` key, correctly refused by the merged delivery validation. It now uses `ebookFileKey`, with the existing history assertions and application validation unchanged. Fresh final-source full-suite, default production/Docker and native acceptance remain pending. No migration, dependency change or live operation.

### Preview bucket acceptance correction

Source `ad9e955e` passed all 3,499 tests in 323 files with zero skips, four Python suites, typecheck/lint/dead-code and default Mac/Docker production builds. The initial Docker run exhausted the owned 3 GiB VM; an unmodified retry passed with 6 GiB. A read-only served-byte binding check then found the alternate PDF fixture returned 404: SLN-569 moved the base fixtures and configured preview bucket to `durtal`, while the SLN-493 alternate PDF still used `durtal-ebooks`. The seed now writes both formats into `durtal`; the Python regression checks both exact fixture byte paths. Application code and native assertions are unchanged. Those passed-source artifacts and the failed binding remain preserved; corrected-source native acceptance remains pending.


### Required functional controller readiness — 10 October 2026

After independent approval of combined source `cb097c04`, the registry can declare required eager functional controllers and retain their feature-owned failure elements when loaders fail. `useReaderController` installs the stable activity/location/end/selection handlers together in a layout effect before acknowledging an epoch-scoped permit. Reader input and engine opening await that permit while engine code and file-byte preloading remain parallel. An empty required registry retains its immediate path; the production registry remains empty pending SLN-454's real controller.

A single 5,000 ms readiness watchdog marks missing controllers failed without fabricating readiness. Degraded opening requires a connected, visible feature-owned failure surface in a display frame; the existing 30,000 ms opening limit remains. Retry, file changes and StrictMode invalidate waits, tokens and queued events. Runtime withdrawal fences new input, cancels pending navigation and holds bars visible so a failure surface can display; no committed save is rolled back. The bus resets first/end/activity deduplication when a destroyed generation restarts, without buffering or replay.

Meaningful registry, atomic-install, stale-permit, watchdog, StrictMode and synchronous-first-engine-event regressions are prepared. Validation is paused for root's QUIET-494 measurement window; the earlier typecheck passed before the last source/test amendments and is not final-source evidence. Full database/native/default-build/CI/UI/performance acceptance and actual SLN-454 integration remain pending. Existing `cb097c04` V5/matrix packets and earlier rapid-turn failures are preserved and must be rebound after independent approval of this final source.


#### Controller crash boundary correction

Independent source review found that the failed controller boundary could be reused for its own failure element, retaining `failed=true` and rendering nothing. Controller and failure renderers now have distinct boundary keys. The new React regression throws from the eager controller, requires the real failure component to mount, and waits for its visibility acknowledgement before degraded engine opening. This correction remains untested during QUIET-494; the final checkpoint still needs focused/static and native validation after the window is released.


#### StrictMode engine mock fixture correction — 10 October 2026

The exact `fc81ff8a` focused run passed type checking and source lint, with 69 unit tests passing and one StrictMode barrier test failing. Retained bounded diagnostics showed correct controller epoch invalidation/reacquisition: the obsolete epoch was cancelled and the live epoch had a current permit. After explicit import settlement, the cancelled import received the expected mock factory but the live import received the real `createFoliateEngine`, instantiated `FoliateEngine`, and tried to parse the fixture's fake JSON response as an EPUB, failing with `End of central directory not found`. The final identity/error trace SHA256 is `ff8d30bbca7947b3e577c2b56c831b9b61be5a1a415a6a165ea0a7e29aa39bf0`; all temporary observations were restored and owned diagnostic children exited.

The test now explicitly resolves and checks the mocked engine export before rendering StrictMode, keeping its intended fake engine stable across the replayed imports. The original render, three-frame bus flush, and exact-once opening/location/activity assertions remain unchanged. No product startup, controller barrier, mock handler, or assertion was relaxed, and no diagnostic hooks remain in source. This corrected test still awaits its source-bound barrier-file/lint check; real cold engine imports, actual SLN-454 integration, and full/native acceptance remain separate pending gates.
