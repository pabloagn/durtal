# Task 0431: eBook matching and linking

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-494, SLN-569
**Blocks**: SLN-496, SLN-497, SLN-505

## Overview

Match local eBook metadata to book works, explain review proposals and plan
reversible digital-copy links and accession. Automatic eligibility favours
precision; the labelled live calibration and approved apply remain separate.

## Implementation Details

The bounded first checkpoint contains pure modules only in
`src/lib/ebooks/match/`: immutable snapshot contracts and indexes; validated
ISBN and namespaced external-id keys; multilingual title/author keys; strict
whole-word trigram extents; versioned scores and review tiers; typed edition,
copy and accession effects; deterministic duplicate proposals; and conservative
batch author clustering. No module imports the database or writes storage.

Identifier conflicts, flags, volume/series/year vetoes, locked editions,
ambiguous copies, unknown language and unavailable verified files prevent
automatic effects. Existing edition metadata and work lifecycle stay untouched.
Effects expose missing choices and are not executable write plans. Copied cover
provenance comes only from a loader-validated file publication. An ISBN-10 is
converted to its full valid ISBN-13, rather than the publisher helper's 12-digit
ISBN-10 prefix. Equivalent identifiers do not multiply identity evidence.

Full integration is gated on SLN-494's transaction-bound read-only planning
wrapper. Every helper must receive that protected connection, without global
fallback. Committed links and undo entries must share an operation id bound to
database, run and plan hash; undo checks identity and dependencies in its write
transaction and preserves later operations.

Migration `0082_ebook_matching` is reserved, not generated. It will add candidate
rows, review/link columns and constrained `exclusion_reason`, with the reason
present exactly when excluded. Exclusion reason is guarded decision state, not
part of the bibliographic match fingerprint. The downstream library consumes
this field instead of inferring a reason from the tier.

## Completion Notes

The original pure checkpoint's focused run passed 71 tests in three files with
zero skips (357 ms total). TypeScript compilation and ESLint were clean. The
first focused run found one fixture lookup incorrectly relying on catalogue
ordering; it was corrected to select the work by id. Omnibus, conflicting
identifier-owner and empty-catalogue regressions are included.

Independent review rejected checkpoint `277ac5bd` for two unsafe automatic
matches: a single known identifier owner could contradict the proposed work,
and an unnumbered work title could hide its identified edition's volume number
when their cleaned title scores tied. That commit remains in history. Six new
adversarial cases reproduced both defects before the corrections, including
Google IDs and ISBNs with an available digital copy. Scoring now treats any
different identifier owner as a conflict and checks identified edition volume
evidence independently of the best title key. Matching volume controls remain
eligible. The corrected focused run passed all 77 tests in three files with
zero skips (351 ms total); TypeScript compilation and ESLint are clean.

A further independent review of `ae3f69d6` found that a title-only proposal
could still fill a free copy of another numbered volume. Nine new route cases
reproduced unsafe eligibility before this correction. Edition effects now check
the selected destination, any placeholder copy being moved, and unresolved
catalogue volume evidence for every choice route. Mixed-volume works require
review unless a unique identified edition resolves the volume; contradictory
moved copies still block that operation. Number evidence includes subtitles.
Two additional subtitle regressions reproduced unsafe eligibility before that
normalization fix. Volume ambiguities also become candidate vetoes before tier
selection, so these cases cannot receive an automatic tier. Compatible or
absent numbering remains eligible where catalogue evidence is not contradictory.
Both reviewed checkpoints remain in history. The current focused run passed
98 tests in three files with zero skips (367 ms total); typecheck and ESLint
are clean.

No database suite, SQL trigram parity, calibration/precision measurement,
6,000-by-700 performance benchmark, schema generation, native build, deployment,
live catalogue read or write, cloud operation or reader/browser acceptance has
run for this checkpoint. This task is not complete.

Root independently approved pure source `02f27672`, then authorized effectful
source development against the normally merged, source-approved SLN-494
prerequisite `0b6b706b`. Merge checkpoint `f0d17064` preserves both histories.
Migration generation/apply, heavy checks and live operations remain gated.

The first declaration/loader checkpoint adds the proposed candidate table,
five ebook columns and nullable finite 0–1 persisted probability check. Exact
manual SQL lives outside the migrator under `migration-proposals/0082...`.
Independent declaration review required parent-side candidate invalidation and
persisted probability reconciliation. The amended SQL locks candidate parents
FOR SHARE, invalidates on reparent/deletion, clears obsolete duplicate tiers,
and refuses existing invalid probabilities until explicitly reconciled.
The disposable database suite includes both concurrent reparent orderings and
deletion checks; it is authored but has not run and requires generated 0082.

The new explicit-connection loader reads one query per table, retains raw state
for stale guards, validates file/cover provenance and active digital locations,
and keeps exclusion reason outside the bibliographic fingerprint. The focused
matcher/loader/validation run passed 115 tests in five files with zero skips.
Shared writers, operation-owned undo, classification-only restore, calibration
gates and registration/resume integration are still being implemented.

Independent review approved schema source `92dd605c` but required strict loader
eligibility: string-valued validation flags were accepted and a null gold entry
could crash loading. This narrow correction reuses byte-for-byte SLN-497 shared
source from `6590026e6a2236dd8311694c6865d0ebc0ce945f` at its original paths:

- `src/lib/ebooks/conditions.ts`: blob `2ac4f495b0aa0a34481efdde6b0c5dc61f24e16d`
- `src/lib/ebooks/publication-evidence.ts`: blob `0434010073b6df77934b77c7588048cb440b7c56`
- `src/lib/ebooks/eligibility-sql.ts`: blob `0b20eb615d062c83d55fe73baa2bd828b2dee054`
- `src/__tests__/ebooks/publication-fixture.ts`: blob `f4b8c5ff9246db951a87fee489b281cd612a94c7`

No shared validator was adapted and no SLN-497 schema/migration declaration was
imported. The matching loader now consumes strict downloadable/native eligibility
and accepted publication lineage, including the recorded manifest key, instead
of the shallow delivery helper. Its DTO conversion is exported for the upcoming
ingestion adapter. The snapshot also exposes active digital location ids for
explicit-copy selection; this adds no query or database column. A valid derived
800 px cover must be an image in the accepted publication; smaller or unrecorded
covers are not substituted. The narrow loader suite passed 194 tests, zero skips,
including the approved malformed-publication corpus, string `false`, null gold,
valid native and download-only evidence, and cover lineage. Typecheck and source
ESLint are clean. Writer/undo/calibration integration remains uncommitted and
awaits exact-source review. Its additional zero-candidate model-version schema
proposal is separate and unreviewed; reserved 0082 remains ungenerated/unapplied.

## Guarded integration source checkpoint, 2026-10-10

The current writer source adds shared manual link, explicit copy/edition,
accession, classification, decision and operation-owned undo services. Every
planning read uses the supplied repeatable-read connection, including ISBN,
author and slug helpers. Returned plans are JSON DTOs. Writers lock the core
tables and assert full snapshots inside the same transaction as mutations;
undo additionally discovers and guards all actual FK child tables, including
unknown future references. Committed receipts bind run, operation, plan and
database, capture complete after rows and distinguish unchanged queued jobs
owned by this operation from later or unrelated enrichment activity.

Cover effects reserve unique attempt keys before I/O, verify accepted
publication lineage and actual source hashes/size, then convert outside the
planning callback. Cleanup only deletes unused attempt keys after proving they
are unreferenced; an uncertain database read retains them. Accession uses fixed
ids through the existing work/edition helpers, creates initial histories,
refreshes publisher links once and queues enrichment after commit at priority
200 through the supplied connection. Follow-up failures remain explicit.

The pre-registration planner binds source groups and exact file evidence to
the model, input-plan and catalogue fingerprints. It overlays all future
groups for shared-identifier and duplicate evidence, simulates sequential alias
registration and emits human-readable candidates plus a deterministic sample.
The automatic apply gate rebuilds precision from complete human labels, requires
at least 99% empirical precision and zero wrong-work outcomes, and displays
sample size and uncertainty. No fixture label is claimed as actual collection
calibration. Registration maps are verified against real file ownership; apply
refuses changed effects instead of choosing a new route. A completed matching
operation is accepted only for the same run and approval. The shared automatic
link writer independently validates that approval's full scope.

The ingestion CLI opts into matching and version 3. Matching runs after all
groups register, including resume when every item is already done. Its undo
entries join the ingestion log and are processed first. Apply/resume validate
the protected planning URL against the plan database before writing; undo
validates every matching entry's run/target before the first undo write.
Classification-only restore does not relink. Derived ingestion classification
preserves registration's ebook timestamp so untouched pending rows remain
eligible for ingestion undo. The `ingestionMatchingIsCurrentOn` adapter provides
the matching proof for SLN-494/498's complete no-op preflight; this branch's
ordinary apply still writes bookkeeping until that upstream wrapper is wired.

The added positive `match_model_version` ebook column and corresponding manual
SQL invalidation amendments are separate from schema source approved at
`92dd605c` and still require independent declaration review. Reserved 0082 is
still ungenerated/unapplied. The strict loader checkpoint `a9b1c54b` received
independent SOURCE_APPROVE during the quiet window; that approval excludes this
writer/model/receipt/undo source. Existing work lifecycle and physical orders
remain unchanged when digital copies are added, preserving the shared partial
holdings rules; an authored database regression proves mixed ownership and an
unreceived physical order survive link and undo.

Before QUIET-494, the narrow loader/full matching run passed 194 loader tests
and 316 matching tests respectively, and that checkpoint's typecheck/lint
passed. A later focused run passed 10 undo and 6 mocked cover tests. Current
group, adapter and writer regressions and the added undo cases are authored but
unrun; the disposable PostgreSQL suite now covers both concurrent parent
deletion orders, committed receipts, stale catalogue rollback, competing copy
claims and a future FK dependency, also unrun. QUIET-494 permits source work
and commits only. No current whole-tree typecheck/lint, local/DB suite, native
conversion/build, SQL trigram parity, real precision measurement, 6,000-by-700
benchmark, migration, deployment, live/cloud write or browser acceptance ran
for this checkpoint. This task remains in progress pending exact-source review
and the coordinating chat's validation slots.

## Independent review corrections, 2026-10-10

The frozen integration checkpoint `47c2c9a8` subsequently passed all 54 tests
in the seven requested mocked matching suites and the ordinary full-project
typecheck under the coordinator's Node 22 slot. Independent source review
requested three corrections: external ebooks were absent from approval scope,
location-only choices bypassed active digital destination validation, and the
currentness adapter used an input hash instead of the committed run UUID.

Approval now includes required `externalInputFingerprint` for the complete
external ebook DTOs, including duplicate preference timestamps, decisions and
file capabilities. Apply compares that context before any matching write plan;
selected registration UUIDs and own completed effects remain outside this
external binding. Old approvals missing it must be regenerated and labelled.
Every new-copy destination is validated against loader-proven active digital
locations. The currentness adapter requires the actual committed run UUID from
its caller's durable state and retains the same run/approval/target fences.
SLN-494/498 consumers must pass this third argument; SLN-505 choice signatures
are unchanged and invalid location-only destinations now refuse planning.

Thirteen additional mocked regressions are authored for preferred external
duplicates, shared ISBNs/common titles, external decisions/capabilities/preference,
invalid and valid location-only destinations, and currentness after the shared
automatic apply writer produces a real UUID receipt. They also assert no writes
or identity allocation on completed currentness, and reject different runs,
changed approval receipts, changed input scope and hash-as-run substitution.
These corrections and new regressions have not been executed: source-only work
is authorized, while tests, typecheck, lint, database and migration commands
remain held for a fresh coordinator verification slot. The immutable reviewed
checkout and its 54-pass baseline are preserved separately.


## Shared manual/review writer source, 2026-10-10

The coordinator subsequently verified exact matching checkpoint `44066b65`: 67
focused tests passed with zero failures, skips or pending cases, and the ordinary
whole-project typecheck passed in its supervised Node 22 slot. That evidence
applies to the accepted correction checkpoint, before the following changes.

On clean integration base `3bb556077907ebfbfbdd8efffd1380f782e4f631` (tree
`86596898f03eec6ac51efbf3f43d49bfb20f02b7`), the explicit source-authoring grant
adds the twelve reviewed matching product files, seven focused test sources and
this existing changelog. Manual creation intent now bypasses edition/copy reuse,
uses strict shared catalogue copy metadata, and freezes any selected sub-location
reference table in the plan. Existing-copy fill derives actual format/size from
the preferred usable file, writes move/fill once, and records owned-field
provenance. Newly committed moving receipts capture the original raw edition,
including approved-group receipts whose per-link snapshots omit edition rows.
Undo restores only proven fields and the precise original copy timestamp; later
use, incomplete provenance and changed/taken parents retain the copy with a
concrete reason. The FK discovery set is also guarded under the sorted locks.

The internal prepared review capability binds writer, frozen core identity,
entity scope and decision/compensation purpose in a private registry. Link,
accession, decision, classification and link Undo compose synchronous before/core/
after queries in one atomic list. Extended classification returns that awaited
list; its existing three-argument result remains void. Review compensation uses
the locked authoritative original receipt and a DB-forward microsecond version,
then classifies without replacing that version. Ordinary no-policy timestamp
behavior remains as before. Accession reports thrown postcommit enrichment
failures separately while retaining its committed result.

The accepted SLN-496 interface receipt supplies the issuer/order/result contract,
not an implemented receipt store. Only the future reviewed `review/store.ts` may
issue capabilities in product code. No placeholder receipt composition was
added. The store's strict in-transaction final receipt predicate, authoritative
last-result decoder, retries and real database rollback/precision validation
remain SLN-496/root integration work. Normal unlink and Undo of restore/rematch/
unlink or work status are not enabled by these matching primitives.

All new focused tests are authored and unexecuted. No tests, typecheck, lint,
product runtime, migrations, database commands, commits, pushes, live/cloud writes
or deployment ran for this grant. This task remains In Progress pending the
coordinator's independent exact-diff review and separately authorized checks.

## Cover integrity backend authoring, SLN-572, 2026-10-10

Source-only checkpoint in the separate media-integrity checkout, based on
`3bb556077907ebfbfbdd8efffd1380f782e4f631`. It is not release acceptance.

Catalogue covers now allocate fresh attempt paths and use create-only PUTs,
output SHA-256/size checks and bounded actual-byte read-back before issuing a
complete publication capability. Preview creation is exclusive. URL fetching
retains the existing safety guard; accepted ebook source reads retain their
ownership, lineage, checksum and size bounds. Legacy key reads stay compatible.

Edition edit/rematch publication captures SQL JSON with microsecond timestamp
identity, then runs a separate table lock, fresh state assertion and counted
UPDATE in the same atomic batch/transaction. Snapshot state stays server-local.
Matching reservations precede storage writes; only verified pairs can publish,
with exact output hashes in the same operation's committed receipt. Existing
edition effects reject stages, and default undo remains DB-only.

Failed or uncertain cover outcomes retain candidate paths and report pending
reconciliation, including create follow-up errors after DB commit. Cleanup
filters final prefix-expanded candidates to gold, retains all edition cover
objects and associated adjustments, and reports only unreferenced retained
covers as pending. The report-only orphan tool grants no deletion permission.
The authorized reprocess route explicitly refuses cover-thumbnail aliases.
Generic non-cover overwrite/cleanup concurrency remains outside this boundary.

Focused byte/fault, preview exclusivity, owner/source/reservation, API refusal,
Postgres rollback/competing-writer/microsecond/zero-row and actual wizard/Fast
Track postcommit-failure regression sources are authored. They have not run.
Typecheck, lint, all tests, DB/native/runtime/build, migration, live/cloud actions,
commit/push and publication remain held pending frozen-source review. The cover
editor, inheritance/history UI and any durable physical-cover GC protocol are
outside this checkpoint.


The prefix-race tests distinguish an explicitly supplied helper namespace from
ordinary edition deletion, which cannot discover a fresh unpublished reader
UUID. Retention reporting is through structured exact-path recovery warnings
and the helper's cleanupPending result; persisted matching output evidence is
in the committed receipt. No new durable orphan/retirement table is introduced.
Existing wizard/Fast Track follow-up error wording is not redesigned here.


## Combined matching and cover source, 2026-10-10

The exact source-approved SLN-495 candidate was checkpointed as `c6f06322`
with Pablo Aguirre as author and committer. Canonical SLN-572 `f6e144c1` is
being composed on that central integration base. The coordinator reports its
standalone 51 focused tests and affected source lint passed; that evidence does
not validate this combined source. The three actual overlaps are resolved in
place, preserving private immutable matching inputs/receipts, active digital
destinations, sorted guards and final review suffix, and the pre-PUT reservation
and verified complete cover-pair publication contract. Issued immutable cover
capabilities retain registry identity; persisted reservation/verified evidence
is a separate frozen DTO. Accession replaces its private receipt after complete
pair verification, preserving the original reserved receipt for reconciliation.
Combined group/accession real-byte regression sources are authored but unrun.
The pure suite covers reservation order, later-pair/commit/ack failures, final
review suffix and existing-edition fill/move/placeholder zero-cover-write routes.
The disposable PostgreSQL suite separately authors actual committed receipt and
disk-entry reconciliation after a lost acknowledgement, complete rollback after
all statements and preservation of aliased old edition pointers/bytes. Its two
legacy source-file fixtures now carry the loader-required publication evidence.
No types/test/lint/runtime/DB/browser/build/cloud execution, push or combined
merge commit ran in this authoring lane. Independent combined source review and
the coordinator's source-bound execution gates remain required.


## Combined private QA fixture correction, 2026-10-10

The coordinator ran the exact private candidate tree `f327e52c`: 14 selected
test files reported 202 passed and 21 failed across four files. Types and lint
were not attempted after that failure. The original frozen source and failed
log/result remain preserved; this correction has not been retested.

The eleven new byte cases stopped at the fixture's native publication assertion:
replacing the second full checksum had left the first checksum's two-character
folder in its keys. The publication fixture now accepts a source checksum and
builds every bronze/silver/gold/manifest key through the canonical helpers. Both
byte writers and disposable database cases use it. A new regression checks a
valid distinct-checksum source first, then verifies each mixed-folder lineage
is rejected without storage calls. Native/owner/cover assertions stay intact.

The other ten failures used literal SELECT review markers while asserting those
markers appeared in parameter arrays. The writer, classification and undo test
builders now bind their markers as parameters. Exact before/core/receipt/final
positions, awaited result checks, immutable preparation/reservation mutations
and compensation/version assertions are unchanged. No product source changed
relative to the failed combined candidate. These are source-level diagnoses;
independent review and a separately authorized rerun remain required. No central
application/staging, runtime, test, typecheck, lint, database or QA-copy edit ran
in this correction lane. Central application still needs direct human approval.

## F2 native unlink policy candidate, 2026-10-11

This isolated source candidate starts from the frozen C2 integration tree
`345b8d7d`. It consumes the exact F2 unlink codec and its SQL/error/receipt codec
dependencies from SLN-496 commit `abfbda70`; it does not author the review store
or service. `reviewedUnlinkCore` exposes the real planner and writer through the
reviewed port. Automatic Undo requires the unchanged automatic matching after
row. Fresh Unlink allows later metadata while binding the current full row,
seven-field review stamp and actual original native matching receipt on the
protected planning connection. Both modes preserve the existing owned cleanup,
restoration, retention and foreign reference checks.

The explicit unlink policy enters the matching plan hash and a private prepared
extension binding. Its original native operation remains distinct from the new
core/review operation. The registry accepts an undo-link decision only with one
matching ebook and that exact policy and new operation; compensation is mutually
exclusive. Policy inputs are copied before awaits. The writer checks the trusted
capability before building writes, adds the full unlink guard inside the existing
locked atomic, advances the ebook timestamp once in PostgreSQL, leaves it alone
during classification and returns the actual awaited atomic result list with the
review receipt suffix last. The review store still owns the suffix and its final
seed/state assertions.

A new regression source covers automatic staleness, authoritative projection
mismatch, immutable policy preparation, fresh unlink of edited metadata, retention
of edited or newly referenced copies, capability/scope/operation/policy mismatch,
forward timestamp and actual batch result awaiting. It has not been executed.
Existing C2 tests remain byte-identical; their prior passes are retained evidence
for C2, not acceptance of this new source. Only source inspection, hashes and
whitespace diff checks ran. No central application/staging, product execution,
DB/cloud access, generated migration or reserved 0083–0088 edit occurred. The
separate migration packet freezes real journal-0081 generation inputs and the
pinned offline command; root must authorize execution and review actual 0082
outputs and the absent matching trigger declarations before DB gates.


### SLN-505 remaining matching source checkpoint (private; runtime pending)

- Added a distinct strict optional existing-copy metadata patch and canonical UTC6/full raw metadata stamp. Both planning and writing bind the selected existing copy and edition; create defaults, destination/status/digital fields, new-copy drafts and automatic/move choices cannot enter this patch.
- The canonical guarded link writer applies descriptive metadata and file-derived fill in one transaction, then captures actual complete after-state before the trusted review receipt suffix. Metadata provenance records only supplied descriptive columns and the complete original stamp.
- Undo restores those original descriptive values only with the unchanged full actual after-state, original parent and foreign-reference guards. Existing metadata edits and their Undo advance the copy timestamp by at least one PostgreSQL microsecond.
- Added actual-model post-create suggestion planning and guarded storage for one existing book, capped at 4096 rows per catalogue table, 16 MiB of snapshot and 64 pending unlinked eBooks. Relevant eBooks retain actual model-ranked competing candidates; no accept/link/accession or lifecycle change occurs. The final SQL count reads stored current-model candidates inside the same transaction. Failures return unavailable after book creation.
- Regression source covers precise stamps, no create defaults, input alias isolation, protected fields, atomic final-suffix rollback, dependency-preserving Undo, actual model/storage counts and post-create unavailable handling. No runtime/type/lint/database checks were executed by this source worker.
- Review-service validation, option stamps, request/cache/receipt forwarding and UI consumption remain owned by 496/505. Upload and 0082 generation/assembly checkpoints remain separately frozen; this source is based on the independently approved be71635f recipe.


### Remaining505 connection-boundary source correction r2

- Addressed independent finding L495-REM505-R1-01: the public planLink wrapper now privately copies both choices and identity synchronously before connection acquisition/read-only validation can await. The inner explicit-connection planner retains its own independent entry copy.
- Regression source explicitly delays the connection callback, mutates the original patch/stamp/identity before any planning read, and checks that the original exact values survive into the hashed plan and protected copy update. The default synchronous mock no longer conceals this boundary.
- Frozen remaining505 r1 is preserved. No runtime/type/lint/DB validation or application occurred.

### Private upload atomic source checkpoint (2026-10-11)

Canonical registration now accepts a distinct upload capability and returns its
actual atomic results. Its optional classification-only result is included in
the registration hash and the same transaction as rows/items and the receipt.
Explicit targets refuse add-format replacement and bind only the named original
file for replacement. Server-only planning/dispatch lives in ingest/upload-atomic.
Existing review issuance and accepted F2 codecs remain byte-for-byte unchanged.

The upload registry binds native five-field operation identity independently
from the permanent command identity, canonical16hex database identity and the
64hex upload target namespace, owner/job fences, expiring persisted preview,
actual durable inspection/publication, scoped UTC6 full target and reader rows.
Both live and settled phases retain the exact rounded source reservation.
Settled ready means proved job cleanup and null worker leases; release is never
a confirmation prerequisite. Receipt final assertions run after actual effects
and audit capture, and preserve positions, annotations, retired IDs, cursors and
quote-note links. Restoration retains all file rows and uses forward timestamps.

Regression source covers distinct issuer identity, publication/preview binding,
phase guards, scoped reader guards, Date isolation and final failure propagation.
A separate local PG16 suite uses the complete real migration chain and checks
actual rollback, concurrent retirement/cursor changes and charged reservations.
No tests, types, lint, database or cloud execution were performed in this lane.
Upload/annotation/quote schema dependencies and the actual496 adapter integration
remain separately reviewed root work; this private checkpoint does not enable UI.


### Upload forward-version source correction r2 (independent review pending)

- Preserved frozen upload r1 and its accepted F2 baseline. Corrected the ordinary upload classification branch so its candidate write cannot overwrite the preceding monotonic database version.
- Decision, manual link and accession now use the same trusted upload timestamp policy for updates of existing eBooks; manual link applies it to existing copy fill/move rows. The link preparation receives and validates the issued capability rather than accepting a raw timestamp-policy flag. Existing review/CLI behavior and the exact review issuer/policies remain unchanged.
- The PostgreSQL expression advances a finite existing version using greatest(clock_timestamp(), updated_at + one microsecond). Non-finite existing versions fail the NOT NULL update inside the atomic. Actual native receipt and upload audit after-snapshots capture these database versions.
- Accession creates new works/editions/copies and does not update existing editions. Its new row creation timestamps remain the canonical plan timestamps; the existing eBook update advances under the upload policy.
- Focused regression source covers all four affected writers with older and same-millisecond plan timestamps, prevents classification version overwrite, preserves default behavior, and checks actual PostgreSQL UTC6 after-state/audit versions, existing link copy version and rollback at the final audit for each writer. No runtime/type/lint/DB checks executed by this source worker.
- Registration plus inline classification, retained-file restore/compensation and upload undo already retain their accepted forward-version paths. Remaining505 and 0082 assembly are separate checkpoints.
