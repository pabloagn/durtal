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

Independent source review approved implementation checkpoint
44f0fbca690669772b6f1d973c122a4b0dc2cac5. Review-only proof wrappers now bind
the source/tree/lock, installed dependency runtime, original three input bytes
and nanosecond mtimes, approved SLN-569 plan, full pooled URL hash and reviewed
21-key inventory/download hashes. The pooled runner uses explicit personal
credentials in memory and guards actual SDK commands, owner/prefix/key scopes,
requests, bytes and elapsed time. It compares every public-table row multiset
and all 21 objects' LIST/HEAD metadata and streamed-byte SHA-256 before/after
planning; it captures read-only state, savepoint 25006 and unchanged backend.
Reports/cache/input copies are isolated and private. The disposable wrapper
binds the installed postgres:16 image and runs the full existing zero-skip
suite. These harnesses have not executed; independent harness review and
separate execution approval remain required.

Harness review requested revisions to 7217545c57c3afecf1ae1e8113987dbb96c57b0c.
The rejected manifest b5558ab317163a0638e47281b6642635ae9ce512f2f868fafd01c703c2d2222f
stays at /private/tmp/durtal-sln494-pooled-proof-7217545c/manifest.json unchanged.
Live target identity is now derived privately from the separately approved full
URL hash; the immutable historical loopback plan only establishes input/object
provenance. Work cannot spend the reserved after-snapshot request/byte/time
capacity. Finally captures catalogue and storage independently, with progressive
explicit incomplete evidence persisted before awaits. Graceful signals stop
work; the wrapper reserves cleanup then termination inside the hard bound and
preserves partial evidence after external failure. Passing requires complete,
unchanged before/after results and completed planning/guards. Local-only guard
tests cover target separation, exhausted budgets, failed snapshots/planning,
hung work, cleanup failure and hard timeout. Implementation SOURCE_APPROVE at
44f0fbca690669772b6f1d973c122a4b0dc2cac5 remains unchanged. Revised harness and
manifest still require independent review; no live proof has executed.

Revised harness verification: 10/10 TypeScript guard cases and 6/6 pure Python
guard cases passed. Application and harness TypeScript checks and targeted
harness/test ESLint passed. Passed implementation gates were not rerun.

Independent harness review confirmed the remaining tsx@4.21.0 CLI relay can
SIGKILL its child after two 30ms acknowledgement waits. The wrapper now starts
the pinned Node executable directly with --import tsx and explicit
TSX_TSCONFIG_PATH. Runtime fingerprints include the executable path/bytes and
tsconfig path/bytes. A real tiny local Node-child regression uses the production
argv/environment helpers, resolves a source alias through the pinned config,
blocks acknowledgement for 500ms, and completes a delayed after-finally marker
inside the reserved cleanup window. All 7 Python wrapper guard tests passed;
this regression made no database/AWS/container/browser/build call. The frozen
f0f49793 manifest 23e41a893c0696b75a44645684bcaddfb3188ce52c0e51412acf25e9d2a4b85b
remains unchanged for review provenance. The approved implementation and pooled
proof controls are unchanged; the direct-launch checkpoint/manifest need fresh
independent approval before any live proof.
