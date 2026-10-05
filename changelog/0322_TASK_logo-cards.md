# Task 0322: Logo cards

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-441. Like a wallet turning any QR code into a tidy pass: drop a logo into
an organization's media dialog, see the finished card, adjust it, save. Every
card comes from one template, a 3:2 black card with the logo in one light ink
at the same visual size. No generative model: plain image processing with
sharp.

## Implementation Details

- `src/lib/media/logo-card.ts`: rasterize (an SVG is never stored as SVG),
  read the background from the border (a transparent logo is judged against
  white when dark, black when light), make a one-channel ink mask that keeps
  inner details as cut-outs, trim, size by ink area capped by a box, and
  centre on the ink's centre of mass. Switches: invert, keep colours, emblem
  only, smaller or bigger, badge. Masks stay single-channel through sharp's
  resize.
- `src/lib/media/logo-card-options.ts`: the switches, safe for the browser.
- `POST /api/media/logo-card`: preview (a PNG, nothing stored), save (the card
  becomes the active logo, the original kept beside it as lossless WebP, the
  switches in `processing_params.logoCard`), or run the switches again on a
  saved card's original (`mediaId`).
- `ingestMedia` takes `logoCard: { original, options }`.
- Media dialog (organizations, Logo tab): a drop zone, the card preview, the
  switches and Save; a saved card has "Adjust".
- Publisher card and header show a logo card full-bleed; a plain logo still
  sits whole in its tile.
- `docs/07_STORAGE.md`, Logo Cards.

## Completion Notes

- Tests: `src/__tests__/media/logo-card.test.ts` (Penguin's belly cut out with
  and without a background, NYRB's light letters, a wordmark and an emblem at
  one weight, a badge with no ring, the switches, a half-transparent border,
  PNG and JPG, a blank image refused) and
  `src/__tests__/integration/logo-cards.test.ts` (preview stores nothing;
  save keeps the original, never SVG; adjusting a saved card; bad input).
- Two faults the issue's first test found are covered: a resized one-channel
  mask that came back with three channels, and a transparent logo losing its
  inner details.
- Browser: Chrome, Safari and Firefox 157, at 1440, 768 and 390 px: drop a
  logo, the 1200×800 preview shows, a switch changes it. Saving needs S3,
  which the disposable preview has none of: the DB test covers it.
- `node scripts/qa/page-weight.js`: 17 of 17 routes within budget.
- Limit: a logo photographed on a busy background needs a background-removal
  model; not part of this task.
