# Task 0411: Quiet Glass design system

**Status**: Completed
**Created**: 2026-10-08
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-556 implements the approved Quiet Glass direction: neutral ink and smoke, steel interaction, silver confirmation actions, compact controls and visibly translucent floating surfaces. Artwork retains its own colours and literary headings retain Cirka.

## Implementation Details

- Shared semantic surface, text, selection, action and focus tokens replace rose/plum/crimson theme consumers, including charts, timeline, placeholders and reader presentation fallbacks. Real colour taxonomy remains unchanged.
- Controls use 4px corners, floating surfaces 6px. Buttons use 28/32/36px desktop heights and 14px labels, with separate 44px coarse-pointer targets. Ordinary header actions remain neutral.
- Glass uses a 70% ink tint, 24px blur, 65% saturation, 55% backdrop brightness, an even 7% edge and soft shadows. Opaque fallbacks cover reduced transparency and unsupported blur. No metallic rims or bevels.
- Book-card artwork actions share one tray. Its material fades independently of its ancestor, and its styles exclude nested dialogs. Dialog chrome uses Inter, lighter spacing and open title fields; independent focus outlines remain visible.
- Cover-derived ambient gradients retain their hues, confined and attenuated at render time. No stored palettes or live catalogue records are rewritten.
- Design documentation and audit colour recognition are updated. The local ingestion directory is excluded from Git and Docker contexts.

## Completion Notes

- Typecheck and production build pass; lint has 0 errors and the existing 75 warnings.
- Full local suite: 3,275 tests pass, zero skipped, including 93 isolated database suites and all three Python suites.
- Shared glass and reader checks: 108 tests pass.
- Cross-browser matrix: 144 page/dialog states pass alignment, contrast, accessible-name, overflow and coarse-pointer touch audits at 1440/768/390px in headless Chrome, WebKit and Firefox. Artwork fixtures cover warm, cool, green, monochrome, bright and missing-cover cases.
- Pixel-sampled secondary-text contrast on floating glass: 4.74:1 over white, 6.37:1 over warm, 6.81:1 over cool and 7.61:1 over dark backgrounds.
- Production page-weight checks pass for all 29 populated routes; four optional routes have no fixture records. Library HTML is 99KB against its 300KB budget.
- Final interaction review passes 54 additional states across Chrome, WebKit and Firefox at desktop and phone widths: artwork menus, nested edit/delete/media dialogs, enabled confirmations, reader settings/contents, keyboard dismissal and focus return. Three undersized quick-edit controls and author-picker rows now have full touch targets. Native modal keyboard behaviour is preserved.
- Five-run reader performance comparison passes initial EPUB/PDF loading, desktop reopen, 300 page turns, memory and idle budgets. Cached phone reopen remains over its existing SLN-553 budget (880ms against 400ms; prior reader-core measurement approximately 1,490ms). This known reader limitation remains open; the design change does not claim to resolve it.
- Production Docker build passes. Implementation and review are in PR #179. No dependency, schema or live-data changes. SLN-557's image-adjustment layout redesign is explicitly deferred.
