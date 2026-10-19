# Task 0995: Links that looked like plain text read as links

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1195. The layout audit's plain-command check found links in a text colour with no underline, box or icon, so only hover told them apart from the words around them. Each now reads as a link or a control; card titles whose card already says it opens the record are exempt.

## Implementation Details

- **Text commands** (`text-command`: accent colour, 45% underline, 44px coarse press area):
  - the top-list rows on Reading statistics (`src/components/reading/stats-parts.tsx`);
  - the year link on each Statistics covers block (`src/components/statistics/covers.tsx`);
  - the author names on a series page (`src/app/(catalogue)/series/[id]/page.tsx`);
  - links inside a sentence that axe flagged as link-in-text-block (serious, WCAG 1.4.1), told apart from the words around them only by colour: the books and the year in review on the reading hub's On this day (`src/components/reading/on-this-day.tsx`), the book title on a notes list (`src/components/reading/notes-list.tsx`), a suggested publisher in the publisher name inbox (`src/components/publishers/publisher-name-inbox.tsx`) and Downloaded books on the offline reader's message (`src/components/reader/offline/offline-reader.tsx`).
- **Taxonomy names** (`src/components/taxonomy/taxonomy-item-row.tsx`) take the text command's colour and underline but keep their own coarse sizing, since the row already gives the 44px.
- **Year chips** on Reading statistics (`src/components/reading/stats-years.tsx`) are outlined chips, 28px (44px on touch), with the current year filled.
- **Suggestions pager** (`src/app/(catalogue)/reading/(tabs)/suggestions/page.tsx`): Previous and Next are outlined with a chevron, as the list pager draws them.
- **Collection member cards** (`src/components/collections/member-card.tsx`): the title link carries `data-card-title`, and `scripts/qa/layout-audit.js` skips such links, since the card's box and cover are the cue.

## Completion Notes

- The plain-command check is clean on Home, Statistics, a series, a collection, Subjects, Reading statistics and Suggestions in Chromium, Firefox and WebKit at 1440, 390 and 320.
- Design audit: no low-contrast text, no unnamed controls, no sideways scroll. Alignment audit: 0 issues.
- The drift findings left on those routes (cover-letter thumbnails on a series page, taxonomy rows at 320) come from layout this change doesn't touch.
- `pnpm typecheck` clean, `pnpm lint` 0 errors (81 warnings, the baseline), `pnpm test` 6,870 passed.
- The four in-sentence links (added after the widening): axe's link-in-text-block finds nothing on the reading hub, Notes, the publisher name inbox (seeded with one unmatched name) and the offline reader's message, in Chromium, Firefox and WebKit; each link is underlined. The browser audit passes all 36 page loads on those routes at 1440, 768 and 390.
