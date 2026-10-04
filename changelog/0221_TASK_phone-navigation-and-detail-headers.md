# Task 0221: The app works on a phone: navigation drawer and stacked detail headers

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0210 (SLN-418 slider grids and filter rows)
**Blocks**: None

## Overview
SLN-312. On a phone the sidebar took width from every page: 224px on the first SLN-312 report, a 56px icon rail on main since the compact sidebar. The work and author headers kept the poster and the title side by side, so titles, header actions and chips ran past the right edge. Measured on main (c9f6359) on the live app, headless Chrome at 375px: `/library/the-cathedral-of-mist-by-paul-willems` scrolled 280px sideways (the title row), `/library/i-by-wolfgang-hilbig` 131px (actions, the "accessioned" chip), `/authors/brian-catling` 53px (actions).

Below `md` (768px) the sidebar is now a drawer opened from a phone navigation bar, and the page takes the full width. The detail headers stack below `sm` (640px). Desktop does not change.

This finishes the WIP commit 4824b44 (2026-09-28) from Controller's handover, replayed onto main and merged with what main gained since: the cookie sidebar width (Settings, Display), the 56px rail up to 800px, the shortcuts provider and the rail tooltips.

## Implementation Details
- `src/components/layout/mobile-nav-bar.tsx` (new): a fixed 48px glass bar below `md` with the menu button, the name and search (opens the command palette). Both buttons are 44px, with `aria-label` and a tooltip, on the name's cap-height center (`CapAligned`).
- `src/components/layout/shell.tsx`: `main` has no left margin below `md` (`md:ml-(--sidebar-w)`), 48px top padding for the bar, and a 16px gutter (24px from `md`). The drawer state lives here. While the drawer is open, `main` and the bar are `inert`, the page does not scroll, Escape and the backdrop close it, and focus goes back to the menu button. A route change or a screen wider than `md` closes it. The 800px compact rail is unchanged.
- `src/components/layout/sidebar.tsx`: one sidebar for both. Below `md` it is a 256px drawer (at most 85vw) that slides in from the left, with labels, a close button and 46px rows. It shows at once when it opens, so it can take focus, and hides after it slides out. From `md` up the classes are the old ones behind `md:` variants, so the server renders the right layout before the screen width is known. Rail names and tooltips apply only to the rail, not the drawer. The resize handle exists from `md` up. The section list scrolls (`overflow-y-auto`, `overscroll-contain`): with Books, Films, Perfumes and Paintings all on it holds 17 sections.
- Detail headers: work (`src/app/library/[slug]/page.tsx`) and author (`author-detail-header.tsx`) put the poster above the text below `sm`. On the work page the actions wrap below a long title below `sm`; the title gets `min-w-0 break-words`, as on the place page.
- `src/styles/globals.css`: below `md`, `html` has `scroll-padding-top: 3rem`, so anchors and `scrollIntoView` (pagination, edition links) stop below the bar instead of under it.
- Backdrops that bleed to the edges of `main` (work, author, collection pages) use `-mx-4 md:-mx-6` and `px-4 md:px-6`, to match the new gutter.
- `scripts/qa/overflow-audit.js` (from the WIP): how far a page scrolls sideways and the outermost elements past the right edge. `scripts/qa/phone-audit.mjs` (new): runs it in headless Chrome at 375 and 390px on the main routes and exits 1 when a page is wider than the screen.
- `docs/03_DESIGN_LANGUAGE.md`, Responsive Behavior: the three widths and the phone check.
- `pnpm install --frozen-lockfile` in the worktree only; no dependency changed.

## Completion Notes
After: `scripts/qa/preview-local.py` (throwaway database, synthetic catalogue plus a poster and a backdrop on a work, an author and a collection), headless Chrome for Testing at device pixel ratio 2, own profile, overflow, alignment and design audits.

| Width | Pages | Page overflow | Elements past the edge | Alignment issues (rows checked) | Unnamed controls |
|---|---|---|---|---|---|
| 375 | 21 | 0 | 0 | 0 (2-12 per page) | 0 |
| 390 | 21 | 0 | 0 | 0 (2-12) | 0 |
| 700 | 5 detail pages | 0 | 0 | 0 (2-9) | 0 |
| 768 | 21 | 0 | 0 | 0 (0-10) | 0 |
| 1440 | 21 | 0 | 0 | 0 (15-28) | 0 |

- Pages: `/`, `/library`, two work pages, `/library/new`, `/authors`, two author pages, `/publishers`, `/recommenders`, `/series`, `/places`, a place, `/provenance`, `/locations`, `/collections`, a collection, `/taxonomy`, `/harmonize`, `/settings`, `/reader`.
- Desktop: at 1440px `main` starts at 224px with a 24px gutter and the sidebar is 224px; at 768px both are 56px, as before.
- Drawer at 375x667: 256px wide, focus on Close, `main` and the bar inert, page scroll locked, labels on every row, no rail tooltips, 0 alignment issues (24 rows) and 0px overflow while open. Escape closes it and focus returns to the menu button. A link closes it and navigates. With all four collections switched on (a local edit, not committed) the list holds 17 sections, scrolls (830px of content in 514px) and the last one, Settings, is reachable; 0 alignment issues (27 rows).
- Phone dialogs at 375x667: the command palette is 16-359px wide with the input focused; the work action menu is in the screen (32-212px); the Edit Work dialog is 375px wide, scrolls, and Cancel and Save Changes are on screen.
- `node scripts/qa/phone-audit.mjs --base http://127.0.0.1:3421`: 14 routes x 2 widths, all 0px; exit 0.
- Left as they were: the design audit counts 1 nested control on work and author pages ("Export" inside "Export", the export menu trigger; PR #4, SLN-391, makes menu triggers real buttons) and 3-7 low-contrast decorative glyphs on `/harmonize` (fg-muted "/", "01"). Neither is in a file this task changes.
- The action menu opens downward in the page flow; near the bottom of a short screen the page scrolls to it.
- Anchors: at 375px a heading scrolled into view stops at 48px, the bottom of the bar (`scroll-padding-top` 48px); at 1440px it is `auto` and the heading stops at the top, as before.
- `pnpm typecheck` and `pnpm lint` pass (0 warnings). `python3 scripts/qa/test-local.py`: 108 files, 1488 tests pass.
