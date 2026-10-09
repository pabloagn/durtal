# Task 0432: Verified pooled eBook planning and ingestion recovery

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-569 (main 94140915b28e94708864ec7ad6ae6f979c9406db)
**Blocks**: SLN-494 acceptance, SLN-495 planning integration

## Overview

Neon's pooler ignores the former startup read-only parameter. Plan through one
explicit verified transaction, retain the fail-closed write probe, and complete
the recovery/reporting gaps in the already merged ingestion core.

## Implementation Details

`withReadOnlyPlanningConnection(url, async database => result)` pins PostgreSQL
with BEGIN READ ONLY, verifies SHOW, and requires the savepoint probe's 25006.
The callback receives schema-aware Drizzle for all loaders/helpers. Queries are
revoked on callback completion or transaction failure. ISBN checks accept the
supplied connection; global-database access is poisoned in helper tests.
EBook plan/reconcile/verify and enrichment length/evidence/worker/vocabulary use
this context. Existing write modes keep their backup/live guards.

The eBook SDK middleware permits only list/HEAD/GET before request dispatch;
the personal CLI bridge permits only identity reads and credential export.
No startup SET, unpooled-host substitution, new dependency or migration.

Undo logs precede every run write; run ids are announced before item work.
Resume checks the host, saved plan checksum and undo header, restores missing
initial item rows without resetting existing ones, and requires the old undo
log. Changed/missing pre-storage sources remain blocking independently of the
current walk. Fully verified publications can be adopted after source deletion;
“No longer in the inbox” stays nonblocking. Final reconciliation is saved in
Neon and a Markdown report. Verification exceptions affect CLI exit status.
SLN-569's committed/legacy duplicate recovery and exhausted failures remain.

## Completion Notes

Source implementation is in progress. Bounded non-database regression run
passed 36/36 across six files: protected helper reads, failed probes,
callback lifetime/reverification, actual SDK dispatch, CLI identity guards,
verification status and existing hash/group/metadata cases. Typecheck passed,
including a separate check covering the ebook/enrichment CLI scripts normally
excluded by tsconfig. Lint passed with 0 errors and 75 repository
warnings; deadcode passed with two configuration hints.
A later connection-loss race test reproduced a late probe reactivating a
finished scope. A permanent closed flag now prevents reactivation and is tested
for loss during both the probe and callback work.

Additional disposable-only tests cover nested backend identity, initialization
interruption, wrong-host/missing-undo resume, pre-storage source changes and
post-publication source deletion; these have not run yet.

Pending coordinator gates: independent source review; full disposable suite
with zero skips; corpus and browser/performance acceptance; guarded real Neon
pooled dry-run using durtal-personal / account 608240934043 / eu-north-1 with
before/after catalogue and object-inventory evidence. No live writes, cloud
mutations, builds, Docker, browser preview or deployment performed here.
