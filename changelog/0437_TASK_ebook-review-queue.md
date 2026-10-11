# Task 0437: eBook review queue

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-495, SLN-494
**Blocks**: SLN-497, SLN-498, SLN-506, SLN-509

## Overview

SLN-496 settles pending eBooks with exact previews, stale guards and durable
operation-bound Undo. The actual store, shared service, authenticated REST routes
and private read model are now authored against SLN-495's reviewed shared writer
checkpoint c6f0632268644927af6338f440a332995b02f3fd. This is a source checkpoint:
runtime verification and the review page remain outstanding.

## Implementation Details

- Strict action/edition-choice inputs, exact UTC microsecond timestamps, known
  language and ISBN checks, work history/dependency stamps and bounded chunks.
- Presentation mapping keeps pending exact/strong matches visible in Likely;
  linked automatic and partially held sections may overlap. Mapping never
  changes a matching tier or authorizes a write.
- Sentences consume structural projections of matching's LinkEffect and
  AccessionEffect contracts. They do not select editions, copies or authors.
  Inconsistent effects/counts are refused instead of hiding unadvertised writes.
- Pure receipt parsing, canonical request hashes, deterministic compensation
  operation keys, and activity-row namespace/identity checks. Receipt namespaces
  are ebook.review.{decision,undo,catalogue_status,catalogue_status_undo}.v1.
  Existing activity_events.id is the operation key. These helpers perform no
  database writes and cannot prove that any decision committed.

- The real store issues SLN-495's registered atomic extension. Its synchronous
  prefix verifies the absent global operation key, complete current ebook and
  candidate text snapshots, and original committed receipt for compensation.
  The suffix inserts the review receipt from actual database after-state,
  captures every batch receipt before validating all final receipt/ebook pairs
  and the exact operation count, and returns a declared final result marker.
  Validation occurs after the last insert so a later trigger cannot invalidate
  an already checked earlier receipt. SQL NULL and
  malformed receipts fail closed. No prepared receipt proves a commit.
- Candidate hashes cover complete ordered database row text, including UTC
  microseconds and untouched numeric/Unicode evidence. Guard versions never
  pass through JavaScript Date. Existing activity_events.id is the durable key.
- SQL after validation mirrors the pinned strict UUID versions 1–8 and RFC
  variants, including nil/max exceptions; PostgreSQL UUID typing is insufficient.
  Guarded/captured ebook, candidate and audit timestamps require finite instants
  in AD 0001–9999, with unsupported timestamps refused before normalization.
  Forward validation compares actual timestamptz instants. BCE output cannot
  masquerade as a later AD version through a formatter which omits the era.
- Protected repeatable-read preparation calls actual core planners for accept,
  manual link (including real new-copy/new-edition intents), accession, keep,
  exclude, restore and rematch. The bounded private preview cache stores frozen
  full plans behind an opaque token; expiry/restart refuses without replanning.
  Confirmation invokes only the core writer with the store-issued extension.
- Receipt lookup precedes cache/current target checks. Guarded replay verifies
  only the durable audit rows and returns the original outcome after target
  changes or deletion. Ambiguous outcomes get one same-operation lookup and
  instruct retry of the original operation; there is no second write/inverse.
- Undo supports accept/link/accession/keep/exclude through the actual C1 core
  compensation paths. It binds the original exact after-state and advances the
  database version beyond both actual clock and original/current versions.
  Later edited or referenced copies are retained with the core's reason.
- Shared server actions and bearer-token REST delegates use the same service.
  POST preview prepares intent; POST link/accession/state confirms the returned
  request and token; POST undo verifies original operation identity; GET review
  exposes a private projection with loader-proven file availability. REST checks
  token/origin before parameters, bodies or database context. Product routes are
  single-ebook; the store supports the core's bounded homogeneous accession set.

This checkpoint adds no migration, matching product edits or parallel writer.
Fresh unlink and work catalogue-status mutations remain unsupported. Bulk queue,
page integration and SLN-505 UI are outside this source checkpoint.

## Completion Notes

Historical pure verification (before this actual-store checkpoint): 103 focused
tests passed, zero skipped, on installed Node
22.23.3 and Vitest 4.1.2. pnpm typecheck, focused ESLint including tests,
and whitespace checks passed. Test report: /tmp/durtal-sln496-pure-tests.json.
The historical system pnpm 12 launcher refused package-manager identity verification for
the pinned pnpm 10.26.1 when registry access failed; installed runtime/test
binaries were used directly without installing dependencies; the existing pinned
pnpm 10.26.1 launcher subsequently ran typecheck successfully (with sandbox
permission for its normal TypeScript cache). Independent review
of the new actual-store source checkpoint is pending.

New test source covers actual-store SQL construction, immutable inputs, terminal
receipt decoding, compensation binding, preview cache limits, service replay
ordering, sanitized errors and REST authentication/delegation. The opt-in
ebooks-review-transactions fixture targets only disposable local
sln496_ebook_review. The full test:local runner creates an empty DB for it;
guarded beforeAll applies only repository-journaled migrations before checking
matching table/assertion readiness. Approved generated SLN-495 schema must be
landed and a separate runtime/DDL grant supplied before execution. The fixture
does not consume private/manual migration proposals. It contains transaction/batch-construction parity,
concurrent confirmation/Undo, full candidate hash parity, microsecond staleness,
ahead-of-clock compensation and rollback fault injection. New focused regression
source covers two-entry actual accession cross-trigger corruption/deletion/ebook
changes, default-selected invalid UUID rollback, nil/max UUID SQL parity, actual
BCE/infinity/year-10000 refusal and supported calendar boundaries. The batch fixture
uses one real PostgreSQL transaction and does not claim live Neon verification.
The test-owned temporary function/trigger requires future root runtime/DDL grant.

Independent review of source checkpoint 8df4133d requested four corrections
(496-R1–R4); this follow-up source addresses all four. No matching product,
shared runner, production migration, REST or UI changes are needed. The actual
store helper changes apply to preparation, decision/compensation suffixes,
receipt lookup and guarded replay without changing their public return contracts.

No new tests, lint, types, builds, database application/provisioning, live or
owner operations ran while authoring this source. Freeze source before any
runtime checks; those remain root-gated. No dependencies were installed.
Full zero-skip tests, default Mac build, Docker, CI, all native-engine/viewport
checks, real-fixture performance, page integration and ticket completion remain
outstanding. The owner's primary files and port 3100 were not changed.

## Bounded selection service follow-up (F1)

The public UI delegates prepareReviewSelection, confirmReviewSelection and
undoReviewSelection and the bearer-token POST ebooks/bulk preview/confirm/undo
routes share the real service. An ordered selection contains at most fifty
distinct eBooks. Preparation returns one visible commit unit: the consecutive
accession prefix uses the actual multi-entry accession planner/writer; other
actions use the existing single-item core transaction. Prepared row counts,
actual accession creation counts and deferred intents are explicit. After a
commit, deferred intent requires a fresh visible preview and confirmation.
The service never plans mixed operations against a stale shared snapshot or
executes deferred rows implicitly.

Complete receipt-set retries precede cache lookup and guard every audit row in
one read atomic; partial receipt sets refuse. Confirmation issues the actual
accession writer once, consumes its authoritative results and resolves response
loss by inspecting the same durable operation set. Undo selections run existing
guarded compensations sequentially, expose each durable outcome and stop at the
first refusal or uncertain result; original identities are retained for retry.
This is per-operation Undo atomicity, not whole-selection compensation atomicity.

New source fixtures cover prefix boundaries, exact cached selections, complete
and partial replay sets, response loss and partial Undo reporting. The guarded
local integration fixture exercises actual two-entry accession and repeat Undo
through both transaction and batch construction. These are authored source;
no runtime checks were launched. F2 automatic-link Undo/fresh unlink and F3 work
status remain separate follow-ups. The existing public single-item shapes and
SLN-505 ownership of new bounded read-only projections/result wrappers are kept.

## Guarded work-status follow-up (F3)

prepareWorkReview, confirmWorkReview and undoWorkReview delegate to the actual
work-status service; bearer-token POST works/[id]/review preview/status/undo
routes share it. Preparation requires a book in tracked/shortlisted/wanted/
on_order status with an active linked eBook holding. It issues a server identity,
strict request and frozen preview in the same bounded cache as eBook decisions.

The new catalogue transaction locks dependency tables, guards the full raw book
and exact status/history/dependency stamp, updates only catalogue status with a
forward microsecond version, appends work_status_history and captures the actual
review receipt together. Full ordered history and complete edition/holding/
eBook/file/order/history dependency rows use lossless database timestamp text.
Final assertions after all writes check the exact raw resulting book, preserved
old history, one expected new history row, unchanged dependencies, audit payload
and captured raw book evidence before the terminal authoritative result.

Undo binds the real original status decision, its full raw resulting book and
exact stamp. Later book, history, holding or order changes refuse. Compensation
restores the prior status, appends a new history row and advances the version;
it retains the deterministic original-bound operation identity. Receipt-first
replay survives missing preview/target and never performs an inverse twice.
Single-write response loss uses one lookup of the same operation. It never
creates or deletes copies, orders or eBooks.

New focused SQL/service/REST source and guarded local transaction/batch fixture
source cover writer order, namespace/binding refusal, terminal decoding,
receipt-first replay, response loss, forward Undo, target deletion, changes to
book/history/holding/order and audit-trigger rollback. No tests, types, lint,
builds, database or runtime operations were executed. This F3 source still needs
independent review and a separate runtime grant. F2 remains dependent on the
core writer's reviewed forward fresh-unlink decision policy.

## Sanitized nonready preparation fields (F4 service boundary)

ReviewPreparationError exposes the preparation_required code and bounded issues
of ebookId/field/code/message. Fixed labels cover author, language, file,
location, title, ISBN, edition, copy and conflicting metadata choices. Unknown
future effect codes receive a generic choices issue; arbitrary effect text,
database errors, source keys and snapshots are never serialized as issues.
After a real link/accession planner refusal, the same protected repeatable-read
connection projects the actual core effects and score conflict. Successful
preparation performs no extra full-catalogue read. This is a failure projection,
not a second planner or matching implementation. Unavailable inspection returns
preparation_unavailable with a fixed retry message and preserves user intent.

Single and accession-selection preparation share that mapping. REST returns
422 with the bounded issues for actionable nonready input, and 503 for unavailable
preparation. SLN-505 owns the Next result wrapper that catches these errors on
the server and serializes their allowlisted fields before crossing the client
boundary. Pure projection/REST source and actual local nonready-file/author
fixture source have been authored; no runtime checks were run.

## Fresh unlink core interface extension candidate (F2 dependency)

unlink-contract.ts provides the exact source-only495 interface and parsed
ReviewUnlinkPolicy. It binds the actual stored matching operation, full raw
current eBook and strict snapshot. Automatic Undo requires the unchanged
automatic matching after-state; fresh unlink binds current metadata instead.
The native after timestamps are normalized and validated by the database on
the same planning connection, preserving exact microseconds without a Date.
An inspection helper calls the actual core cleanup/reference planner, surfaces
retained-copy evidence and schedules no write. Real stored native matching
receipts are used; no original review receipt is fabricated.

The contract supplies exact raw/current/native-after SQL guards and a forward
timestamp expression for495's existing atomic writer.495 must add a distinct
reviewUnlink branch mutually exclusive with reviewCompensation, bind it through
the actual extension registry, include it in the frozen core plan hash and avoid
a second classification timestamp touch. Existing default and compensation
behavior stay under495 ownership. The port type describes required exports;
there is no injected writer, unchecked default-plan cast, public endpoint or
UI button claiming completed fresh unlink. Once the authoritative495 source
is approved,496 completes the receipt suffix and prepare/confirm/replay service
against those actual exports. Parser/query and actual retained-copy inspection
fixture source are authored; no checks were executed. This checkpoint is an
interface extension candidate, not completed F2/backend acceptance.

## Actual core unlink store/service adoption candidate (F2)

The new unlink service calls the actual proposed495 reviewedUnlinkCore.planOn
policy overload and reviewedUnlinkCore.write export. Its frozen preview shares
the bounded private cache and displays the actual retained-copy cleanup reasons.
Automatic Undo requires unchanged automatic native matching after-state; fresh
unlink binds current full metadata. Confirmation creates a new ebookDecision
receipt with action unlink and originalOperation null. The displayed native
matching identity is included in the request hash, never treated as an original
review receipt. The actual core registry receives purpose decision plus the
exact reviewUnlink policy and new core/review operation.

The store captures the DB after-state after the core mutations, then asserts
the complete seed/receipt, cleared link fields, forward UTC6 version, preserved
metadata, planned classification fields and complete planned candidate values.
Candidate real-number comparisons use PostgreSQL real casts to preserve the
existing column precision. Audit-trigger corruption therefore rolls back the
core write, cleanup and receipt together. The terminal result decoder validates
the exact request and original-null receipt. Replay guards durable audit evidence
before the preview cache/current target; lost acknowledgement uses one lookup
and never repeats the writer. This decision has no offered inverse.

Server actions prepareReviewUnlink/confirmReviewUnlink and POST endpoints
/api/ebooks/[id]/unlink/preview and /api/ebooks/[id]/unlink expose those same
services. Preparation accepts ebookId, mode automatic_undo|unlink and optional
displayed originalMatchingOperation. Confirmation accepts request/previewToken;
its originalOperation names the native match and the effect hash binds mode.
No existing ordinary single/selection decision path silently accepts unlink.

Authored pure source covers actual store SQL construction, strict seed/identity
refusal, terminal decoding, receipt-first replay, missing cache/collision and
lost-ack/unknown-outcome behavior. Guarded integration source for both actual
drivers covers a real native link without any original review receipt, current
metadata and retained edited copy, replay after cache/target loss, manual-link
automatic Undo refusal, post-preview metadata staleness without a timestamp
change, and audit-trigger rollback. Positive automatic matching fixture source
uses the real registered scope, exact ISBN/title sample, calibration labels and
approved group writer before exercising unchanged automatic Undo and refusal
after a later metadata edit. Synthetic receipts appear only in construction
and module-mocked service tests, never these real DB scenarios.

This source candidate depends on the exact pending495 core packet
5b8b1a1afe3c3fce17ce7d59e4e3b3a02ab9cf3c125ab5fd0ece92e225dc60f4.
Its core files were read, not copied or merged. Independent combined review,
focused regressions, fresh final types/lint and isolated DB gates remain.
No new product/test modules were executed by this implementation lane.

The exact corrected495 core tree23271a64 is now independently source approved:
packet52e3026190b137763452badbe3c863c21c290f4c48faa3c64fe3a5da2fbf29b6,
approvalf0a44c20a2934f0830942ab13260910480acb0a2a143e060c822d2746d6b679a.
Its product exports/policy and the four shared codecs are unchanged; only the
core test's required ownedChildren after-snapshot field was corrected. Adoption
therefore uses the same actual exported overload and writer. New source cases
also cover preparation through that overload, replaced native identities,
automatic metadata refusal, fresh current metadata, shared unlink cache kind/
channel/target/eviction/expiry, and authenticated strict REST delegation/error
mapping. The route fixture isolates the actual unlink service just as it
isolates the other service delegates. A combined in-memory source recipe and
focused ten-suite proposal freeze the exact approved core plus complete496
source; no private runtime checkout, dependency links or modules are created/
executed by this preparation. Final505 types/lint/DB and central application
remain separately held.
