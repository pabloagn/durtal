# Task 0418: Layout and typography hierarchy

**Status**: In Progress
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
| Shared dialogs and image-adjustment controls | Preserve glass, fixed header/scrolling body, focus/Escape behavior and trial action/menu sizes. Image-adjustment redesign is separately scoped. |
| Cards, prose and collection descriptions | Preserve the 208px readable card minimum, complete identifying text and existing bounded prose. Do not change shared truncation or card-height behavior. |

Editorial deletions belong to SLN-559. No database schema, data-loading behavior, dependency, image-adjustment layout, action size or menu width changes.

## Completion Notes

Initial static checks: typecheck passes; lint passes with 75 existing warnings and zero errors; 52 focused existing tests pass across eight files (copy labels/drafts, edition image selection, menus, glass, address utilities, person names and biography HTML). Before evidence captured on the reported book at desktop, tablet and phone widths.

Expanded read-only baseline measurements at 390px: the postal tab was 10.09px off its wrapped label; both approximate-date labels were 24px tall and all seven biography tools were 28px square. Final rendered verification of these fixes is included in the pending disposable-app gates.

Pending the coordinator's heavy-validation slot: production and Docker builds; disposable-app fixtures covering long, short and absent data, multiple copies, detail headers and dialogs; nonempty geometry audits with loaded fonts and alignment within 0.5px; narrow/coarse-pointer and keyboard/Escape checks; page-weight checks; full zero-skipped `pnpm test:local`; independent review.
