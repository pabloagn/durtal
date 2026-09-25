# Task 0125: Publishers and acquisition targets

**Status**: Completed
**Created**: 2026-09-25
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0007, 0017
**Blocks**: None

## Overview

SLN-319. Make publishing houses a first-class collecting destination while preserving Work → Edition → Instance. Owning Penguin must not fulfil a wanted NYRB edition.

## Implementation Details

- `/publishers`: searchable directory, favourites, profiles, aliases, specialties, explicit imprints, exact-edition catalogue, ownership/wanted/order filters, and unresolved-name review.
- Reuse existing publishing houses. Remove global name uniqueness; retain UUID and unique stable slug. Normalisation is whitespace/case only, across explicit names and aliases. Ambiguous matches stay unresolved. Co-publishing uses `edition_publishers`.
- Database matching triggers cover API, web, metadata rematching, and Python imports. Raw publisher/imprint text is retained. Manual confirmations are atomic and protected from rematching, including explicitly empty choices.
- Targets support any edition, a publisher preference before the edition is known, or an exact edition. They are independent of work ownership and feed library filters, orders and exports.
- Order guards enforce target/work/edition/copy agreement. Receipt requires an identified matching edition. Returns reopen targets. Existing owned copies preserve the work's accessioned state while another edition is ordered.
- Explicit fulfilment by an accessioned copy supports acquisitions without orders; wrong/disposed copies cannot fulfil a target. Disposition or deletion reopens an otherwise unfulfilled target.
- Edition forms, book detail, order creation/edit, command palette, library search/filters/count/timeline, data export, and publisher seeding use the new model.
- Migrations `0025_publishers_and_targets.sql` and `0026_target_accessioned_copies.sql`. Apply together before running this branch. Existing migration history is unchanged.
- Read-only preflight: `pnpm exec tsx scripts/publishers/report.ts --output /tmp/publisher-report.json`. `--env-dir` can point at the checkout containing the live environment; no writes or migration calls occur in this script.
- External catalogue crawling, stock monitoring, and automatic fuzzy identity merging are not part of this change.

## Completion Notes

Implementation complete; live activation pending approval. Isolated branch `codex/publishers-and-acquisition-targets`, starting at checkpoint `566da03`.

Live read-only preflight at 2026-09-25: 172 publishers, 368 editions; 49 fully match exact identities, 91 require review, and 228 have no publisher text. No live migration or data writes performed. Counts are a point-in-time snapshot while the catalogue remains in use.

Validation: 314 tests across 20 files, including 16 publisher database cases, the populated-catalogue migration rehearsal, 9 existing rarity database regressions, and production-driver batch/transaction helper tests. TypeScript and ESLint pass. Production webpack compilation passes (`next build --webpack --experimental-build-mode compile`); existing optional Parquet/WebSocket dependency warnings remain. Static prerendering was not run against the unmigrated live database.

Browser validation on an isolated synthetic database: directory and scoped counts; publisher creation with alias/specialty; favourite toggle; correct NYRB ownership; explicit US/Australia Wakefield resolution; target-driven order creation offers only matching editions; a second edition order preserves existing ownership; explicit copy fulfilment leaves other targets unchanged. The temporary PostgreSQL preview adapter was restored to the production Neon adapter before validation and commit.

A regression check also verifies that partial edition edits do not apply Zod defaults to omitted language, collector flags, or metadata-lock fields.
