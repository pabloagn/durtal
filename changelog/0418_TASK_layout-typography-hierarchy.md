# Task 0418: Layout and typography hierarchy

**Status**: Completed
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-563 establishes a clearer edition composition and applies the same metadata and form hierarchy to equivalent copy surfaces. Complete titles, publisher names, identifiers, contributors and copy data remain available.

## Implementation Details

- Edition identity and supporting metadata occupy one column. ISBN-13 and ISBN-10 are labelled beside the edition information; linked publishers and their editing control sit with publication identity. Edition actions follow the supporting information and wrap naturally. Copies have their own subordinate heading.
- Publication details and copy acquisition, digital and disposition details share `DetailFacts`: intrinsic label widths, aligned baselines, readable 14px values and wrapping long data. Card header and body content use the same 20px inset.
- Edition and copy forms share `FormSection` and `FormColumns`. Functional field groups use the established 21px sans role, predictable 16px spacing, accessible disclosure state and cap-aligned chevrons. Columns listen to the form container, stacking below 440px; three-column dimensions appear only above 560px.
- Address-mode tab icons align with the first cap height when labels wrap on phones. Person approximate-date labels provide 44px touch areas, and the biography toolbar wraps with separate 44px touch buttons while retaining desktop geometry. The shared address picker covers location creation/editing; the biography editor is used only by person creation/editing.
- Display-settings list columns now respond to their container width: the 768px viewport with a 6px scrollbar previously overflowed by 3px. All eight list choices, labels and preferences remain intact.
- Runtime checks corrected edition quote-row inset and intrinsic metadata label widths. Exact raw/linked publisher names share one linked display; distinct publisher, imprint and canonical names remain complete. Closed publisher search no longer references a missing listbox; long alias labels can shrink and wrap within the editor in WebKit, with the entire checkbox label acting as the touch target and showing keyboard focus.
- Biography typing/formatting verification exposed repeated HTML replacement resetting the caret. The editor now syncs external values only when different, preserving forward typing and selection; pointer toolbar actions keep the selection, and the editor has its existing Biography label as its accessible name.
- Equivalent film/perfume/painting create-form inspection found legacy Add/Unknown targets only 24px tall. Their existing targets now reach 44px on coarse pointers while retaining desktop dimensions, labels and payloads. Selected publisher chips also provide a 44px remove target on touch, cap-aligned with the first line and contained within the chip; long names wrap in full.
- Shared page headers use the established 32px section rhythm, keep long identities within the available width and give supporting text a readable measure.

### Surface audit and affected call sites

| Surface | Finding and disposition |
| --- | --- |
| Book detail header | Existing serif title, cap-aligned actions, supporting authors/year and reading actions already establish the desired hierarchy. Preserve this layout and include it in representative rendering checks. |
| Edition panels and copy records | Scattered ISBN/actions, publishers detached from edition identity, half-width metadata and competing copy controls. Recompose the edition; share compact facts with copy records. Both components are used only by the book detail page. |
| Edition add/edit dialogs | Repeated small disclosure headings and fixed two/three-column fields. Share functional group hierarchy and container-based reflow. Both use `EditionForm`. |
| Copy add/edit dialogs and new-book copies step | Same repeated disclosure layout and fixed columns. Share the same form components through `InstanceForm`; preserve every draft/payload field. |
| Page headers and list toolbars | Shared `PageHeader` appears across list, create, settings and reading pages. Align outer spacing with the section rhythm and wrap long headings; retain existing action targets, filter toolbars and tab behavior. |
| Record side panels on books, people, publishers, series, places and other detail pages | Existing stacked 14px labels, 16px values, 16px inset and quiet dividers already establish clear rank. Preserve `RecordPanel`, `RecordGroup` and `RecordFields`. |
| Film versions/copies, perfume formulations/bottles, painting objects | Existing item titles, supporting metadata and nearby action menus already group subordinate records coherently. Preserve them. Their forms already stack narrow field grids. |
| Location address mode tabs and person forms | Read-only baseline audit reproduced a 10.09px postal-tab first-line alignment error and nine undersized person controls (two date labels, seven biography tools). Fix the shared address-mode icon composition, date-label hit areas and biography toolbar reflow. Preserve all labels, payloads and desktop action dimensions. |
| Display settings | Actual 768px/762px content width caused 3px overflow from the fixed list table. Its four-column layout now depends on 640px of container width; narrower content retains the existing two-column arrangement and all eight controls. |
| Shared dialogs and image-adjustment controls | Preserve glass, fixed header/scrolling body, focus/Escape behavior and trial action/menu sizes. Image-adjustment redesign is separately scoped. |
| Cards, prose and collection descriptions | Preserve the 208px readable card minimum, complete identifying text and existing bounded prose. Do not change shared truncation or card-height behavior. |

Editorial deletions belong to SLN-559. No database schema, data-loading behavior, dependency, image-adjustment layout, desktop action size or menu width changes.

## Completion Notes

Implementation complete. Production build and typecheck pass. Repository lint passes with zero errors and 75 existing warnings. Ten focused suites pass (86 tests), including regression checks for biography caret/selection preservation and external content/reset synchronization.

Disposable-app rendering covered long, short and absent publication data, three richly described copies, edition/copy add/edit dialogs, shared page-header routes and equivalent create forms. Chrome used 1440, 768, 390 and 320px; WebKit used desktop and phone widths. A broad 180-state matrix exposed the publisher-editor findings; final 24-state short/long detail and editor checks pass after correction, including full-label clicks, Space toggling and visible keyboard focus. Eighteen additional wizard/settings/prose states pass. Twelve reported-book header/dialog checks use a disposable reconstruction of read-only visible metadata and unchanged copied media. Actual Inter, Cirka and EB Garamond fonts were loaded; nonempty geometry checks use a 0.5px tolerance, painted text is contained within its full control target, and adjacent controls do not overlap.

Measured corrections: the postal-tab icon moves from a 10.09px first-line error to +0.01px in Chrome and -0.01px in WebKit. Both approximate-year labels and all seven biography tools reach 44px on touch. Publisher remove controls reach 44px on touch while retaining 12px desktop geometry. Display settings retain all eight page-size choices and have zero overflow at a real 768px viewport / 762px content width, previously 3px.

The repository interaction audit passes all nine representative routes: keyboard focus, menus, modal Tab containment, Escape/focus return, reduced motion and touch spacing. Page-weight checks pass on all 29 available configured routes plus four explicit hierarchy/settings routes; four optional configured detail routes have no fixture records. Main and added HTML/time budgets remain unchanged.

Docker, the full zero-skipped local suite, exact-head CI and independent review are tracked in PR #185 before landing. Editorial deletions and image-adjustment redesign remain separately scoped.
