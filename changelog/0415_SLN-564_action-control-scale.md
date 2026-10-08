# Task 0415: Unify action control scale (SLN-564)

**Status**: In Review
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

Ready for independent review on `codex/sln-564-action-control-scale`, PR #182. Final rendered source is `86d8269b21c2c686501565e6abcdc9f26929ca04`; this completion record is a later documentation-only update. No new dependencies, schema changes or live data writes.

### Integration and corrections

- Additive merge `f11b71f6e0489f9d9cdbb3e1060ffb861b8ed55e` integrates reviewed menu source `c6033fe6cf1b0bf0cb9098b41dd9c5680153e242`. The EntityActionMenu conflict preserves this ticket's action trigger and the menu ticket's separate shortcut API. No dropdown source change is owned by this ticket.
- Additive main reconciliation `22276e1b685d373ac19baff6fb8eca8950b5f8ae` includes landed menu PR #183 (`c014d42241ce86eb0de8091ff300f96dcc8d1eed`). Its tracked tree is identical to corrected source `a7100f8fd1eb483189ef059832991a38cebc4310`; proof: `/tmp/sln-564-main-reconciliation.json`.
- Review and actual application measurements corrected overlapping taxonomy touch rows, multiline first-line alignment and the FavouriteToggle inline-flex baseline. Taxonomy rows retain 36px desktop height, grow from 49px with wrapped touch labels, and contain their separate 44px action targets. Favourite controls use flex to preserve cap alignment.
- After the full suite, two strictly presentational taxonomy classes changed: `0ef06dc15920881fb7d140a114cdbcce88416d8f` uses flex for the colour slot on both pointer types, eliminating a measured 2px desktop dot offset with actual Inter; `86d8269b21c2c686501565e6abcdc9f26929ca04` reveals drag handles at 60% opacity on coarse pointers. Neither changes handlers, data flow or DOM contracts. Source through `0ef06dc1` received independent approval; the final visibility delta still requires independent review.

### Completed local validation

- Full `pnpm test:local` on corrected source `a7100f8f` / identical-tree reconciliation `22276e1b`: **304 files, 3,283 tests, zero skipped**, plus three Python test scripts. Isolated test databases and the test container were removed. Report: `/private/var/folders/th/0crh6pkx2nb4y2g2hv8jh3sc0000gn/T/durtal-tests-i99i_cs2/summary.json`; log: `/tmp/sln-564-corrected-full-tests.log`.
- Final source `86d8269b`: typecheck passes; lint passes with zero errors / 75 existing warnings; four affected focused suites pass **12/12, zero skipped**; production build passes; Docker build passes (`durtal-sln-564:86d8269b`, no registry push). Evidence: `/tmp/sln-564-final-style-validation.json` and `/tmp/sln-564-final-style-{typecheck,lint,focused,build,docker}.log`.
- Broad production matrix on `0ef06dc1`: **35 distinct routes, 152 route/layout/browser configurations, 3,113 alignment checks**, zero alignment, overlap, viewport-overflow or icon-size failures. Chromium covers 1280/736px fine and 390/320px coarse layouts; WebKit covers representative desktop/coarse routes. Synthetic short/long/absent work descriptions, long person names, and flat/nested taxonomy names are exercised. Evidence: `/tmp/sln-564-app-matrix-results.json`.
- Final source `86d8269b` affected reruns: actual Inter taxonomy checks at 1280px fine and 390/320/280px coarse pass for flat and nested lists. Colour/action centres match exactly; first-line icon offsets stay within 0.32px fine / 0.18px coarse; action targets are 44×44px on touch with zero adjacent-row overlap or viewport overflow. Idle coarse drag handles are visible; keyboard focus has full opacity and an outline. Rename, collapse/expand and menu keyboard handling pass. Evidence: `/tmp/sln-564-app-taxonomy-results.json` and `/tmp/sln-564-taxonomy-app-{tree,flat}-{1280,390,320,280}.png`.
- Final Chromium and WebKit state checks cover desktop and 320px touch layouts. Each case measures **all 12 expected selection-toolbar operations**, at 28px desktop / 44px touch, with zero overlap or alignment findings. Stable busy Export/favourite boxes, 16px layout icons, disabled/aria-busy states, inset focus, hover/active/open geometry and dialog keyboard/focus return all pass. Evidence: `/tmp/sln-564-app-states-results.json` and `/tmp/sln-564-app-{chromium,webkit}-{desktop,touch}-selection.png`. Earlier empty selection arrays were a locator error and are not evidence; the final locator is anchored to visible Exit selection and requires every expected operation. Dialog measurements wait for the existing entrance animation to settle.
- Reduced-motion and visualViewport-fallback checks pass in Chromium and WebKit; Chromium reduced-transparency menus use opaque fill without backdrop blur. Evidence: `/tmp/sln-564-app-fallback-motion.json`. Browser evidence covers current Chromium / Playwright WebKit, not an unspecified legacy browser.
- Final page-weight audit passes all **30 populated routes**; three optional empty-fixture routes skip. The original repository interaction audit passed work/person/queue/note routes and found seven hover-only taxonomy drag handles. The final affected two-route taxonomy rerun has **no failures**. Historical failures remain recorded honestly in `/tmp/sln-564-interaction.log`; final results are `/tmp/sln-564-final2-page-weight.log`, `/tmp/sln-564-final2-interaction-taxonomy.log` and `/tmp/sln-564-final2-browser-validation.json`.

### Cleanup and remaining gates

The production preview on port 3422 is stopped, disposable container `durtal-preview-4ef9777c` is removed, and this worker's heavy-test lock is released. Enriched disposable fixtures remain at `/tmp/sln-564-fixtures.dump`; shared media remains at `/tmp/durtal-quiet-glass-s3`. Keep the worktree available.

Independent review of the final visibility/documentation delta, green CI on the final published documentation head and an explicit coordinator merge slot remain required. Do not merge or archive at this checkpoint. Linear is moving to In Review; no completion or merge is claimed.
