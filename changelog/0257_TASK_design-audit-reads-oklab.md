# Task 0257: The design audit reads oklab() colours

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

`scripts/qa/design-audit.js` read only `rgb()` / `rgba()`. A colour with an
opacity modifier (`bg-accent-blue/15`, `text-fg-muted/50`) compiles in
Tailwind 4 to `color-mix(in oklab, ...)`, and the browser computes it to
`oklab(...)`. The audit skipped that text, or used the wrong background,
so its contrast check reported 0 issues where text was under 4.5:1.

## Implementation Details

- `parse()` now reads `rgb()`, `rgba()`, `oklab()`, `oklch()` and
  `color(srgb ...)`, with or without `/ alpha`, and returns sRGB 0-255 plus
  alpha. Oklab goes to sRGB with the standard OKLab matrices; oklch first
  goes to oklab. Out-of-gamut values are clamped.
- No other part of the audit changed.

## Completion Notes

Checked against the browser: for every distinct `oklab()` value on `/`,
`/library` and `/provenance` (41, 24 and 10 values), the parsed colour is
within 0.5 of the canvas colour per channel.

Old and new audit on `next dev`, 12 pages, 1440x900 and 390x844. The pages
use `oklab()` (10 to 229 elements per page), and none use `oklch()`. Low-
contrast text, old audit → new audit:

| Page | 1440 | 390 |
| --- | --- | --- |
| `/` | 0 → 10 | 0 → 9 |
| `/library` | 0 → 17 | 0 → 16 |
| `/library/i-by-wolfgang-hilbig` | 0 → 1 | 0 → 1 |
| `/authors` | 0 → 2 | 0 → 2 |
| `/authors/jorge-luis-borges` | 0 | 0 |
| `/publishers` | 0 → 4 | 0 → 4 |
| `/places` | 0 → 2 | 0 |
| `/provenance` | 0 → 10 | 0 → 10 |
| `/locations` | 0 → 4 | 0 → 4 |
| `/collections` | 0 | 0 |
| `/taxonomy` | 0 → 14 | 0 → 14 |
| `/settings` | 0 | 0 |

What the new audit finds (not fixed here; open PRs #14, #16, #22, #26, #29
and #37 change these pages):

- Status chips on `/` and `/library`: "On Order" (`#b96b83`, 3.53 to
  4.04:1), "Tracked" (`fg-secondary`, 3.1 to 3.62:1), "Accessioned" letters
  (`accent-sage`, 4.0 to 4.41:1).
- Blue badges on a blue tint (`accent-blue`, 4.45:1): language ("English",
  "es"), "Imprint" on `/publishers`, "Online Store" on `/places`, "digital"
  on `/locations`.
- Book counts on `/authors` ("2 books", `fg-secondary`, 4.29:1).
- `/provenance`: "0" and "—" in faded `fg-muted` (1.18 to 1.41:1).
- `/taxonomy`: "|" separators in faded `fg-muted` (1.19:1). Separators are
  decoration, which `fg-muted` may be used for.
