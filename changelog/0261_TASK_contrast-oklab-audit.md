# Task 0261: Every text passes 4.5:1 by the oklab-aware audit

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0248 (stacked on the final sweep, #37)
**Blocks**: None

## Overview
`scripts/qa/design-audit.js` could not read `oklab()` colours, which every Tailwind colour with an opacity modifier computes to, so it reported 0 low-contrast texts on pages that had them. #42 fixes the audit; on `main` it finds 72 low-contrast texts at 1440px over the 36 pages of the final sweep.

With all of this pass's PRs combined (#14, #16, #17, #19, #22, #26, #28, #29, #37), 38 were left at 1440px, in four groups. This task fixes those four, so the 36 pages have no low-contrast text at either width.

## Implementation Details
- `src/styles/globals.css`: `--color-accent-blue-text` (`#7293a2`), like `accent-rose-text` and `accent-red-text`: `accent-blue` is 4.44:1 on its own badge tint over `bg-secondary`; this is 5.41:1 (4.9:1 even over `bg-tertiary`).
- `src/components/ui/badge.tsx`: the blue badge uses it. That covers the language badges ("English", "es"), "Imprint" on `/publishers`, "Online Store" on `/places` and "digital" on `/locations`.
- `src/app/provenance/provenance-shell.tsx`: a pipeline column's count is `fg-secondary` when empty and `fg-primary` when not (it was `fg-muted` at 50%, 1.41:1), and an empty column's "—" is `fg-secondary` (it was `fg-muted` at 30%, 1.18:1).
- `src/components/taxonomy/family-card.tsx`: the "|" separators in a family card's stats row become a 1px vertical rule (`bg-glass-border`, hidden from screen readers): the same look, and no text left under 4.5:1.
- `src/app/places/[slug]/page.tsx`: the first letter in a place's no-photo frame is `fg-secondary` (it was `fg-muted` at 20%, 1.12:1).

## Completion Notes
`scripts/qa/preview-local.py` (2026-10-03 backup) serving a local merge of every PR of this pass plus this branch, headless Chrome, the design audit from #42 and the alignment audit from #26, the 36 pages of the final sweep:

| | `main` (live app) | All PRs of this pass | Plus this task |
|---|---|---|---|
| Low-contrast texts, 1440px | 72 | 38 | 0 |
| Low-contrast texts, 390px | 60 on #42's 12 pages | not measured | 0 |
| Alignment rows over 0.5px | 6 pages at 1440, 6 at 390 | 0 at 1440 | 0 at 1440 and 390 |

- The only finding left is the nested "Export" control on the book and author pages, which #4 fixes.
- The local merge also showed that the PRs of this pass merge together cleanly once three doc and comment lines moved (#14, #19, #26).
- `pnpm typecheck`, `pnpm lint` and `python3 scripts/qa/test-local.py`: see the PR.
