# Task 0428: Book related sections and genuine cross-kind similarity

**Status**: Completed
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Separate genuine cross-kind similarity from author, translator, publishing-house, collection and mark browsing on the book page. Empty subsections disappear and similarity explanations are removed.

## Implementation Details

- Similarity uses exact scoped subjects/themes/keywords/literary movements/art movements, requires two shared items after hierarchy collapse, weights distinct enabled-work frequency and caps each family. Exact original work-year proximity contributes at most 10%; editions, approximate/range dates and unrelated associations do not establish similarity.
- Contributor groups isolate author/coauthor and translator roles. Canonical publisher families expand only the linked identity and descendants. Groups deduplicate before their limits and translator/publisher cards identify matching editions.
- Mixed shelves use existing BookCard and DomainTileCard/WorkCardArt anatomy, full identifying text and type-correct routes. Shared carousel geometry, editions/instances, reading controls, collections and real relationships remain.
- Focused disposable database tests cover positive cross-kind evidence, sparse/negative controls, hierarchy, deterministic ranking, original dates, collection independence, roles and matching editions.

## Completion Notes

Application source `38247416d16270b49abdce991f1370088c3c255a` received independent source approval and is published in draft PR #196. Four focused PostgreSQL suites pass 44 tests with zero skips; two focused card UI suites pass 6 tests. The final full local gate passes all 3,432 tests across 311 files with zero skips, including all three shipped Python checks and 93 isolated databases. Final typecheck and production build pass; full lint has zero errors and 75 existing warnings. Exact-source CI passes lint/typecheck, database tests and Docker build.

The synthetic production preview passed 12 Chromium/Firefox/WebKit journeys at 1440, 768, 390 and 320px, using the actual fonts. Alignment (0.5px tolerance), contrast, overflow, accessible names and coarse 44px targets pass. Supplemental desktop/phone checks in all three engines cover Rarities/Anathemas, self-exclusion, unmarked/no-other-match omissions, exact person/publisher/collection/mark links, keyboard focus and real destination navigation while retaining matching-edition and collection-deduplication checks. WebKit's first rapid-navigation run reported cancelled prefetch/load errors; waiting for requests to settle passed both affected contexts with zero browser errors. Original reports are preserved. Independent native evidence approval accepted the 12 initial contexts and all six supplemental contexts (four Chromium/Firefox and two settled WebKit), with source/build/fixture hashes verified.

The populated page measured 289 KB/44ms initially and 299 KB/54ms with the supplemental mark rows, within the 400 KB/1,000ms budget. The local Docker build initially exhausted the owned 3 GB VM; its cached retry at 6 GB passed without source changes, producing `durtal:sln568-38247416` from an archive of the exact approved implementation head. The preview and tests used only new loopback PostgreSQL 16.15 containers on the owned Colima profile and local fake media, pinned to the approved image digest. The owned preview, database containers and VM are stopped/removed, and the heavy lock is released. No primary-app smoke, merge, live-data operation or reader change occurred. The final metadata commit changes only this changelog; implementation bytes remain identical to the approved and validated source. The orchestrator handles publication, final-head CI, landing and Linear status.

Preserved local evidence: `reports/sln568-source-checkpoint/` (full-validation, native-evidence, source/build provenance, page-weight and Docker/CI reports). These reports are ignored by Git and contain synthetic data only.
