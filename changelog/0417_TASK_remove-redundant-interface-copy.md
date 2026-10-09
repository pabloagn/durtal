# Task 0417: Remove redundant interface copy (SLN-559)

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Remove interface copy that repeats a title, label or visible action. Preserve useful field guidance, record identities, validation, consequences and owner-authored content.

## Implementation Details

Audited the 60 page entry points and their shared surfaces before editing, including loading/error states, field helpers, tooltips, drawers and dialog call sites. The inventory below covers the route and dialog families; an unchanged family means its copy provides specific context or a recovery path.

| Surface | Removed or shortened | Retained guidance and rationale |
| --- | --- | --- |
| Dashboard `/` | “Your library at a glance” | Data counts, status and activity identify actual catalogue state. |
| `/library`, `/films`, `/perfumes`, `/paintings`, shared loading headers | “Browse your … catalogue”; empty-state field enumerations | Filter labels, units and errors; separate-work/version/formulation/original distinctions; new-record pages explain which related records are entered later. |
| Work/edition/copy create and edit; book wizard | Taxonomy-editor introduction; routine copies-step instructions | ISBN/title/manual entry choices, duplicates, missing-location recovery and the conditional wanted-book copy hint. All record descriptions and metadata stay. |
| `/people` and person dialogs | Reported enumeration; repeated merge/delete instructions | Empty People guidance explains where credits originate; merge target and final permanent-transfer warning remain. Biographies and names stay. |
| `/organizations`, `/publishers`, their detail/edit/review pages | Organization enumeration; publisher contents and empty-state repetition | Publisher edition-count scope, name-to-house effects, identity, immutable imported links and organization role differences. |
| `/places`, `/locations`, place/location dialogs and detail sections | Venue enumeration and empty captions; new/edit location narration | Record name, exact unlink consequences, address and lookup hints, dated ownership vs on-view distinctions, and retailer freshness. |
| `/series`, `/series/[id]`, suggestions and series dialogs | List subtitle, empty creation prompt, detail “Use Add books”; add-dialog narration | Destination series name, reassignment effects, single-series membership and suggestion confirmation status. |
| `/collections`, `/collections/[id]`, collection create/edit/add/artwork | List subtitle and unfiltered empty caption; detail “Use Add above” enumeration; create-dialog after-creation narration; add-dialog mode enumeration | Filter recovery, actual mode labels, conditional whole-book vs edition distinction, member identities, search limits and artwork-delete consequences. Owner descriptions and two-line card previews are unchanged. |
| `/recommenders` and detail/form dialogs | List subtitle and empty creation prompt; generic delete question | Record names and which recommendation links leave while works remain. |
| `/taxonomy`, family/item detail pages and dialogs | Directory subtitle and empty caption; family/item creation narration; delete-item repeated question | Family scopes/hierarchy, locked/in-use classifications, reassignment choice, linked record counts and permanent consequences. |
| `/provenance`, order drawer/create/edit wizard | Page/pipeline captions, active-empty creation prompt; search/method/details/notes narration | Wizard step and labels, units, new-author creation, acquisition status and irreversible order deletion. |
| `/reading`, journal, notes, next, stats, year pages; reading/timer/goal/suggestion dialogs | Journal/notes/next/stats empty enumerations | Reading recovery actions; goal units/optional fields; edition switching, progress validation, timer conflicts, reason/evidence text, actual data captions and preserved quotes/notes. |
| `/library/import`, `/reading/import` and import review/undo | Generic library-import subtitle, medallion-pipeline implementation prose, repeated history placeholder sentence | Library CSV availability and script commands; distinct reading-import destination; accepted formats/size, row matching, review-before-write and undo exceptions. |
| `/library/identify`, publisher review, series suggestions, `/harmonize` and review dialogs | Harmonize slogan and “Review the result before merging” | Evidence, unresolved counts, field choices, linked-record transfer, conflict handling, stored originals and no automatic merge undo. |
| Settings: general, display, reader, reading, integrations, data, shortcuts, about | Header enumeration; Data/About surface summaries; settings group narration; Status/Format/Condition label restatements; excess introductory prose | Browser-only vs shared defaults, missing-source language fallback, location ordering, home-currency effects, reading-day boundary, margins/font choice, service state, export formats/lossiness, cache refresh, shortcut access and reset consequences. |
| Reader contents/settings, ingestion-run views, media/image adjustment | Audited; no functional or image-adjustment changes | Reader field labels/errors and no-contents state; run status/counts and exception reasons; media record identity. SLN-557 remains independent. |
| Shared drawers, filters, empty/error states, tooltips | No blanket deletion or new help icons | Icon-control names/tooltips, search/filter recovery, loading/errors and meaningful data/unit explanations remain. |

Deleted paragraph nodes carry their own margins; optional PageHeader, SectionHeading, EmptyState and Dialog renderers omit description wrappers already. Removed the unused domain-description helper and Harmonize intro rule. Shared typography, grid/card proportions and prose bounds are unchanged.

Dialog titles now have stable `aria-labelledby` targets. Descriptions have `aria-describedby` only while present. General settings selects no longer reference the three removed field descriptions; retained guidance references remain valid.

## Completion Notes

- Typecheck passed.
- Lint passed with zero errors; 75 warnings.
- Focused validation: 54 tests passed, zero skipped, covering dialog names/optional references, settings labels, keyboard Escape, reading dialogs, collection views, destructive cascades and catalogue navigation.
- Reported screenshot attached to the Linear issue. Read-only before captures cover populated/filtered-empty pages, a routine collection-create dialog, settings and import on desktop/mobile.
- Pending final gates: production/Docker build; disposable production-app desktop/mobile/touch/focus/Escape QA; actual-font geometry/alignment (maximum 0.5px); page weight; full zero-skipped `pnpm test:local`; independent review. No merge yet.
