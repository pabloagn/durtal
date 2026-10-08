# Task 0414: Readable dropdown menus

**Status**: Completed
**Created**: 2026-10-08
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-562: make action, reading, export, card, bulk and contextual menus readable within the viewport, without shrinking or clipping command labels.

## Implementation Details

- Audited the shared DropdownMenu callers, EntityActionMenu consumers and the separate keyboard leader menu before editing. Retained the bulk rating menu's deliberate two-column layout and long dynamic timer/queue labels.
- Shared dropdowns use content width, bounded by 32rem and the visual viewport with an 8px gutter. A native manual popover floats above clipping ancestors while retaining trigger ancestry for dialog focus restoration.
- Placement respects start/center/end and top/bottom preferences, flips toward available space, updates on scrolling/resizing, and constrains an inner scrolling list on short screens. The glass surface itself does not scroll.
- Shared grid tracks reserve icons and shortcuts only when present, keep labels aligned in mixed rows, and allow full labels to wrap when space is constrained. Shortcut hints use a separate no-wrap column with 20px breathing room. Icons align to the first text line's cap height.
- Both reading and entity menu hints use the shared shortcut API. Book/person card destructive commands form a final separated group. Leader menus stay bounded and scroll their list, including the active item.
- No trigger/control sizing changes (SLN-564 owns that scope), new packages, schema changes, or live DB/S3 writes.

## Completion Notes

- Frozen functional source: `ff008179ae6feff89cdac59ce8322fa16b0c9b6d`. Independent code review approved it; its disabled-row cursor finding was fixed before final gates. No functional source changed during final validation.
- `pnpm test:local`: 304 files and 3,283 tests passed, zero skipped; all three Python test scripts passed. PostgreSQL used 93 isolated disposable databases.
- `pnpm typecheck` passed. `pnpm lint` passed with zero errors and 75 existing warnings. Production `pnpm build` and Docker image build passed. Remote lint/typecheck, full database tests and Docker build passed on the frozen functional head.
- Production page weight passed on all 30 populated routes; three optional empty-fixture routes skipped (finished year, reading import and ingestion run). Library: 101 KB / 300 KB; book detail: 170 KB / 400 KB; person detail: 77 KB / 400 KB.
- Headless Chromium desktop/touch and Playwright WebKit desktop/touch checks covered content width, mixed/absent icons and shortcuts, long/unbroken/short/absent labels, card clipping, two-column bulk rating, marks, queue/note menus, native top-layer hit testing, disabled cursors, arrow/Home/End navigation, Escape and dialog focus return. Menus stayed within the viewport and coarse-pointer rows measured at least 44px. At 320 × 260, the inner list scrolled and End brought the final action into view. Every measured icon/column alignment stayed within 0.5px.
- The repository interaction audit passed on populated `/reading/next` and `/reading/notes`, including two dialogs, keyboard focus, Escape, reduced motion and touch checks. Existing non-menu touch controls under 44px remain in SLN-564's trigger/control scope; dropdown rows meet 44px.
- Direct reduced-motion measurements in Chromium and WebKit confirmed 0.01ms animation/transition durations, one iteration, auto scrolling and no remaining animations after settling. Chromium reduced-transparency emulation produced opaque `rgb(14, 19, 25)` glass with backdrop-filter `none` and the same 6px radius. Both engines retained viewport bounds and inner scrolling at 390 × 844 and 320 × 260 when `visualViewport` was absent. Detailed measurements and screenshots are `/tmp/sln-562-fallback-motion.*`, `/tmp/sln-562-opaque-reduced-transparency.png` and `/tmp/sln-562-*-reduced-motion.png`.
- Verified browser boundary: native manual Popover and CSS subgrid in Chromium 153.0.8010.12 and Playwright WebKit 26.6. No legacy Popover polyfill or older-browser compatibility is claimed; `visualViewport` is optional and its fallback was measured.
- QA used synthetic fixtures only at preview port 3421. Evidence and logs are `/tmp/sln-562-*`, including actions/reading and short-screen screenshots, full-suite JSON/log reports, production page weights and browser matrices. No live services were restarted or mutated.

Draft PR #183 remains unmerged. The worktree stays available for independent UI review and the coordinator's explicit merge slot. This completion-record update changes no functional source.
