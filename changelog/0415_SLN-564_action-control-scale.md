# Task 0415: Unify action control scale (SLN-564)

**Status**: In Progress
**Created**: 2026-10-08
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Give entity header and toolbar actions a consistent compact scale without making the ellipsis the strongest action. Preserve separate touch targets, accessible names, keyboard handling and the quiet dark glass material.

## Implementation Details

### Call-site assessment and boundaries

Assessed the shared Button/buttonClass, EntityActionMenu, FavouriteToggle, ExportMenu, copy/collection actions, card chips, reading menus, selection toolbar, taxonomy triggers, dialog controls and edition/instance controls before editing.

- EntityActionMenu appears in work/person/publisher/place/organization/series/recommender headers, film versions/copies, perfume formulations/bottles/retailers, painting objects and wanted rows. Its existing 32/44px geometry remains; remove the persistent boxed treatment and use the shared ghost states.
- Mixed work/person headers use md (32px), including Export; collection/copy utilities opt into md there. Dense edition controls, list/table copy controls, dialog chrome and card overlays stay sm (28px).
- FavouriteToggle appears across cards, shelves, lists and headers. Preserve its padding and 16px gold symbol; share radius, neutral hover/active surface and inset focus. The legacy boxed variant becomes the same quiet family.
- CopyBookButton appears on book cards, lists/tables, collections and the work header. Preserve the existing 28px glass cover variant and its separate touch slots. Dense/table and header variants grow real targets to 44px, rather than expanding overlapping invisible targets. The table's cap slot grows with its control.
- Edition/copy toolbars already use sm labelled Buttons. Their collection/adjustment icons share the same sm tier and 16px icon size. The edition title-line action slot now grows with touch controls. Image adjustments use ghost on edition content and the existing glass material over artwork.
- Dialog header controls remain 28px desktop and 44px touch, with inset focus. Reading menus keep their existing 32/44px dimensions. Selection utility labels/close control use the same sm scale instead of undersized text/close targets. Taxonomy ellipsis adopts sm with existing hover/focus/touch reveal behavior.
- Shared Button/buttonClass preserves 28/32/36px sizes, 14px labels and primary/secondary/danger treatments; shares ghost/open/focus/disabled states and 16px direct icons. Export retains its label width while busy, swaps a same-size spinner and announces aria-busy.
- Sidebar geometry is excluded. No dropdown content, rows, placement or positioning code changes; SLN-562 owns that work. Shared trigger paint is the only conceptual overlap, with no dropdown-menu.tsx edit.
- Design guidance documents each tier, hierarchy, icon stroke/size, spacing, touch targets and state geometry.

## Completion Notes

Prepared on isolated branch `codex/sln-564-action-control-scale`, based on main `ca85766f855cc57a07506a46074212194e607f18`. No new dependencies, schema changes or live data writes.

Focused validation:

- TypeScript `tsc --noEmit`: pass.
- ESLint `eslint src/`: pass, 0 errors / 75 warnings.
- Four focused suites: 17/17 pass, zero skipped (cap-aligned menus, exports, selection, collection views).
- Tailwind/PostCSS compilation: pass. A static headless fixture caught an inherited utility media-order issue in sm; the explicit sm declaration now retains 44px touch targets.
- Static fixture using actual Button, EntityActionMenu, ExportMenu, CopyBookButton, CapAlignedControls and Dialog (synthetic favourite/collection paint): short/long titles and short/long/absent descriptions, mixed labels/icons, long labels and disabled controls. This is primitive evidence, not full application route QA.
- Headless Chrome at 1200px and 390px coarse pointer: every header icon target is 32px desktop / 44px touch, icons 16px, centers identical within each row, no touch overlaps or phone overflow. Repository alignment audit: 25 desktop / 17 phone checks, zero deviations over 0.5px. Dialog coarse check: both controls 44px, 21 alignment checks with no deviations.
- Enter opens the real entity menu and focuses its first item; Escape (key code 27) closes it and returns focus. Menu-open/closed boxes are identical. Dialog Escape closes it. Headless desktop hover flags match owner instructions.
- Evidence: `/tmp/sln-564-controls-results.json`, `/tmp/sln-564-controls-desktop.png`, `/tmp/sln-564-controls-touch.png`, `/tmp/sln-564-controls-menu-open.png`; supplied screenshots are the before evidence. Logs use `/tmp/sln-564-*`.
- pnpm's sandboxed launcher stalled; checks ran with the same installed project executables. The locked-package installation completed using pnpm 10.26.1; lockfile unchanged.

Independent review requested a correction to taxonomy touch spacing: the 44px ellipsis targets extended beyond the existing 36px rows and overlapped vertically by 8px. Coarse-pointer rows now have automatic height, a 48px minimum and vertical padding; coarse-pointer names wrap, including unbroken labels. Desktop rows retain their 36px height and truncated names.

Review-fix validation:

- Typecheck passes; lint passes with 0 errors / 75 existing warnings. Five focused suites pass: 30/30 tests, zero skipped (the original four plus publisher taxonomy).
- Actual TaxonomyTree/TaxonomyItemRow/DropdownMenu static fixture covers nested parent/leaf and flat rows, a standalone row without drag actions, plus a synthetic no-action row copied from the rendered row. At 390px, 320px and 280px coarse pointer, ellipsis targets measure 44×44px; all adjacent row hit targets have zero overlap and the viewport has zero horizontal overflow. Rows grow from 49px as labels wrap; the synthetic no-action row remains at least 48px. Desktop rows measure 36px.
- Enter collapses a parent, Space expands it, Enter opens Actions and focuses Rename, Escape returns focus to Actions. Rename focuses its input; Enter commits once and Escape cancels without another rename and exits edit mode.
- Evidence: `/tmp/sln-564-taxonomy-results.json`, `/tmp/sln-564-taxonomy-{390,320,280}.png`; fixture source/check scripts in `/tmp/sln-564-taxonomy-fixture/`; affected check logs `/tmp/sln-564-taxonomy-{typecheck,lint,focused-tests,static}.log`.
- Additive review fix is ready for independent delta review. Full application QA still requires the coordinator's heavy slot.

**READY_FOR_HEAVY_VALIDATION**. No heavy slot has been granted. Full `pnpm test:local` (zero skipped), production/Docker build, DB-backed route/browser checks, page-weight and alignment audits on representative affected routes remain required before merge. Assigned DB preview port: **3422**, not started. Independent review and an explicit merge slot are also pending. Keep this worktree available; do not merge or archive it at this checkpoint.
