# Task 0439: Fixed-format reader policies

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: SLN-499, SLN-500, SLN-501 for runtime integration
**Blocks**: SLN-503, SLN-507, SLN-508, SLN-509

## Overview

SLN-502 extends the existing Foliate reader for PDF, CBZ and fixed-layout EPUB.
This checkpoint contains only root-authorized pure policies and focused tests,
based on reviewed reader commit `626f4870`. No adapter, UI, storage route,
annotation persistence, preference schema or vendored asset is changed.

## Implementation Details

- `canvas-budget.ts`: DPR policy, independently capped raster backing size,
  16 Mi-pixel per-page and 128 MiB aggregate limits, and three/four page-canvas
  and two/one cached-spread limits. `otherCanvasBytes` must include live and
  in-progress reservations. A caller must reserve before rendering; null means
  defer or evict. CSS/text-layer geometry remains at the requested zoom.
- `pdf-options.ts`: absolute versioned asset URLs and prescribed document
  options for the installed, pinned pdf.js 6.4.299; the worker CSP policy.
  Installed display source ignores `isEvalSupported`. The option is retained
  for compatibility, but is not credited as an effective security control.
  Source checks confirm the installed worker uses PostScript wasm/IR execution
  without native JS eval/Function construction; annotation scripting is opt-in.
  HTTP CSP enforcement and adapter application still require runtime checks.
- `pdf-range.ts`: exclusive-end ranges split into at most 256 KiB requests,
  six-read concurrency policy, exact 206/header/body validation, and a
  whole-file 200 policy requiring cancellation before body reads and app retry.
- `pdf-crop.ts`: median paper tone, strict 40-level difference, 0.4% density,
  2% padding, 25% side limits and 40% minimum area, with first-page Auto policy.
- `pdf-geometry.ts`: rotation/crop/zoom-aware coordinate conversion, normalized
  and merged user-unit rectangles, PDF locator construction and healing order.
- `pdf-text-geometry.ts`: detached offset-to-user-unit mapping from supplied
  measured glyph/ligature quads. Missing coverage returns null; no DOMRect or
  proportional division is substituted. The adapter's measurement producer
  remains gated and unimplemented in this checkpoint.
- `pdf-text-policy.ts`: unknown, sampled-no-text, has-text and confirmed-no-text
  evidence. Five empty sampled pages never disable whole-book search or speech.
  Current-page actual text controls selection; discovered sparse text recovers
  capabilities. Idle sampling is capped at five distributed pages.
- `fixed.ts` and `comic.ts`: fit/zoom/spread calculations, printed PDF size,
  deterministic segment ordering, Manga direction, folder contents and pure
  twelve-image LRU transitions.

## Completion Notes

Focused validation: nine test files, 75 tests passed, zero skips. Fixtures in
these tests are synthetic arrays/geometry; installed pdf.js source is read
directly for security compatibility checks. No performance or native-browser
proof is claimed.

Scoped TypeScript and lint checks cover the new files only. Full typecheck,
lint, deadcode, unfiltered zero-skip database suite, default Mac build, Docker,
CI, real large fixtures, all nine browser/width combinations, audits and every
performance row remain required after root authorizes integration and the
heavy slot. No migration or new dependency is introduced.

Upstream contract dependency: `locatorSchema` at the base commit still caps
`text.highlight` at 2,048 characters; SLN-500's shared validation must accept
the specified 10,000-character annotation quote before these locators are
integrated. That schema is intentionally unchanged here.
