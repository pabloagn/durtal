# Task 0186: Readable text contrast

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0181
**Blocks**: None

## Overview

SLN-388. Counts, dates, labels, metadata and links used `fg-muted` (#4a4f4d, 2.2–2.5:1) or `accent-rose` (#7d3d52, 2.3–2.6:1) for text. On `/provenance` 221 of 408 text elements were under the 4.5:1 minimum; on `/places` 105 of 232. `accent-red` text (destructive actions, errors) was 3.3–3.8:1.

## Implementation Details

- New tokens in `src/styles/globals.css`: `--color-accent-rose-text` (#b96b83, 4.7–5.3:1) and `--color-accent-red-text` (#cf5f5e, 4.7–5.3:1). `accent-rose` and `accent-red` stay for fills, borders, rings and icons.
- Text that a reader needs moved from `text-fg-muted` to `text-fg-secondary` (368 uses), rose text to `text-accent-rose-text` (48), red text to `text-accent-red-text` (34), including `hover:` and `group-hover:` variants.
- Kept dim on purpose: placeholders, disabled text, opacity variants (`text-fg-muted/30` and so on), separators, decorative icons and icon-only buttons (94 uses).
- A script classified every use by the element it sits on: a text element changes; an element that holds only Lucide icons, only a separator, or nothing stays. Style constants (status colors, badge, button and menu variants, cover chips, date picker weekday row, command palette headings) were changed by hand.
- Where a control went from `fg-muted` to `fg-secondary` and its hover was `fg-secondary`, the hover now goes to `fg-primary` (28 class lists), so hover still shows.
- CSS: bio and comment links use rose text; comment blockquotes use `fg-secondary`.
- `docs/03_DESIGN_LANGUAGE.md` and `CLAUDE.md` state the rule: text a reader needs is at least 4.5:1; `fg-muted` is for decoration only.

## Completion Notes

Measured with the design audit on the dev server at 1440×900, visible text under 4.5:1 (3:1 at 24px and up):

| Page | Before | After |
|---|---|---|
| `/provenance` | 221 / 408 | 0 / 408 |
| `/library` | 110 / 288 | 0 / 288 |
| `/places` | 105 / 232 | 0 / 232 |
| `/publishers` | 101 / 185 | 0 / 185 |
| `/authors/jorge-luis-borges` | 19 / 61 | 0 / 61 |
| `/locations` | 10 / 42 | 0 / 42 |

Also 0 on `/`, the book page, `/authors`, `/series`, `/recommenders`, `/collections`, a collection, `/taxonomy`, `/settings`, a publisher, a place, a recommender, the open book action menu and the Edit Work dialog. `/harmonize` keeps 7, all decoration: two "/" separators, the rose dot after the title, and the stat ordinals 01–04.

- Before and after screenshots of `/provenance` and a book page: the page stays dark and muted; labels, counts and dates are now readable.
- Alignment audit: no new deviations (the known ones stay in SLN-392).
- `pnpm typecheck` and eslint on the changed files pass.
- Not in scope: icon-only buttons stay `fg-muted` (2.2–2.5:1); WCAG asks 3:1 for controls that are only an icon.
