# Task 0203: Long reading text in EB Garamond

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0190
**Blocks**: None

## Overview

SLN-397. Book descriptions, the author bio, and collection and series descriptions used Inter 14–16px in `fg-secondary`, the same as labels and help text; a book description ran about 78 characters per line. Long text now reads like a page of a book: EB Garamond 21px on 32px lines, in `fg-primary`, about 65 characters per line, with true italic and old-style figures.

## Implementation Details

- Font choice (owner's decision): the app's serif is PP Cirka, a display face with no italic, no old-style figures and no small caps (read from the font files' GSUB tables). Two options were previewed on a real description: Cirka Regular (from `PPCirka-Variable.ttf`) and EB Garamond. The owner chose EB Garamond. Headings keep PP Cirka.
- `src/components/shared/prose.tsx` (`Prose`): declares EB Garamond (`next/font/google`, weight 400, normal and italic, `--font-prose`) outside the root layout, so the font CSS and its files load only on routes that render `<Prose>`. Latin files are preloaded; other scripts load only when a text needs them. Bold (2 descriptions) is synthesized, not loaded.
- `src/styles/globals.css` (`type-prose`): `font-family: var(--font-prose, var(--font-serif))`, `text-lg` (21px), 32px line height, `fg-primary`, `max-width: 26em`, `text-wrap: pretty`, `hanging-punctuation: first`, old-style proportional figures; paragraphs 0.75em apart; links in `accent-rose-text` (the book description used `accent-rose`, below 4.5:1); lists, bold and italic.
- Used on the book page (description), the author page (bio), the series page and the collection page (descriptions, `whitespace-pre-wrap` kept).
- The author bio is now sanitized with `sanitizeDescriptionHtml`, like book descriptions; before, its HTML went into the page unchecked. The one bio in the data is plain text, so nothing changes in it.
- `docs/03_DESIGN_LANGUAGE.md` (families, font loading, roles) and `CLAUDE.md` now say what ships: PP Cirka for headings, EB Garamond for long text. They named EB Garamond as the heading serif (part of SLN-395).

## Completion Notes

Measured on the dev server at 1440x900:

- `/library/i-by-wolfgang-hilbig`: EB Garamond 21px / 32px, 546px wide, 66 characters per line (was Inter 16px, 672px, about 78), old-style figures, `text-wrap: pretty`. Layout shift on load: 0.
- `/library/the-origins-of-totalitarianism-by-hannah-arendt`: the true italic face renders "Washington Post" and "Nineteen Eighty-Four"; bold is synthesized; 6 paragraphs 0.75em apart.
- `/authors/octavia-e-butler`: the bio at 64 characters per line. A collection description (21 film adaptations, line breaks kept) at 57.
- Font weight: the book page loads 48.1 KB of EB Garamond (Latin normal 23.3 KB, italic 24.8 KB). `/library` and the dashboard load no Garamond file and no Garamond CSS.
- Contrast: `fg-primary` on `bg-primary`, about 11.7:1.
- `scripts/qa/alignment-audit.js`: no deviations on the book, author, series and collection pages.
- `pnpm typecheck` and eslint pass. The type scale keeps its seven sizes (21px is `text-lg`).
- During verification the dev server went stale again (it served CSS without `type-prose`). I restarted it with a fresh Turbopack cache and measured on the served code.
