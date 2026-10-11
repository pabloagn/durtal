# Task 0444: eBooks everywhere in Durtal

**Status**: In Progress — source checkpoint, partially verified
**Created**: 2026-10-09
**Updated**: 2026-10-11
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-494, SLN-495, SLN-496, SLN-497
**Blocks**: SLN-509

## Overview

SLN-505 integrates eligible eBooks into book pages, cards, filters, exports,
search, copy linking and REST metadata/decisions. This checkpoint implements
actual work availability queries and read-only catalogue consumers. Matching
and accession workflows, decision endpoints and runtime acceptance remain
unfinished. It does not authorize deployment or live data changes.

## Shared contracts and dependencies

- Earlier accepted source: `45de7218` work-level selection/public projections,
  `2fd511f8` additive book JSON export, `9b6f5873` reader entry/return controls,
  and `05e8af7d` optional card/palette adapters.
- `17701915` imports exactly three files from SLN-497 `53881449`:
  `continue-target.ts`, `library-queries.ts`, and `library-params.ts`. Source
  bytes were compared with that revision. No schema, migration, delivery writer
  or other SLN-497 consumer was copied. Integration can use the original
  SLN-497 revision instead of duplicating these same dependency files.
- The actual `ContinueDescriptor`, `ContinueAnchor`, `ContinueFile`,
  `LibraryEbook` and `EbookDetail` contracts are used. File eligibility remains
  owned by the shared native/download predicates and their SQL counterparts.
- The copy relationship stays `ebooks.instance_id → instances.edition_id →
  editions.work_id`. Linked state and an active copy are required for work
  availability. No direct work link or new persisted availability is introduced.
- SLN-494 replaced/missing/quarantined bytes and SLN-495 copy-removal behavior
  are read through existing fields. Files and historical anchor provenance are
  preserved; neither ingestion nor matching writers are changed here.

## Implemented source

- `work-availability.ts` collects all linked eBooks, files and positions for
  a deduplicated batch of work ids in one query. It retains unavailable eBook
  metadata and eligible download-only formats separately from native Read.
  Historical source files validate saved anchors; shared Continue selects
  eligible target bytes. Work selection prefers the newest local anchor,
  then original language and reader format preference without changing an
  edition. Pending re-anchors never claim a landing percentage.
- `catalogue-availability.ts` validates the existing device cookie and adds
  no query for an empty shelf. Catalogue cards receive only the allowlisted
  work DTO, with no storage evidence, anchors or signed URLs. Book-page Read
  controls retain the explicit owner anchor projection needed for Continue.
- Book detail now uses the aggregate for the first Read entry, edition chooser,
  copy metadata, unavailable reasons, same-author/series/marked/related shelves
  and mixed-domain similar works. Reader links use document navigation and a
  validated return destination, including a copy's edition fragment.
- Actual callers are wired on library, dashboard, people, publishers,
  recommenders, taxonomy, series and collection pages. Collection edition
  entries restrict Read to that edition. Series and author pages count works
  with an eligible reader target. Non-book cards receive no eBook projection.
- Grid cards and book mosaic tiles share context/long-press entry into the
  existing catalogue menu. Row/table/series/collection presentations receive
  cover marks and a document Read link. Selection mode suppresses reader
  controls. Long press cancels on movement, scrolling, release or cancellation;
  a successful press suppresses the following cover navigation.
- Library `ebook=yes|no` and API/timeline `hasEbook` use one shared SQL EXISTS
  predicate over native eligibility and active linked copies. Legacy
  `getWorkIdsWithEbooks` now has these semantics, rather than counting linked
  rows without usable bytes. Existing copy-format filters remain separate.
- Palette search performs SLN-497's real bounded unlinked/standalone query
  (five results) and one availability batch for returned book works. Continue
  fetches the actual shared query when the palette opens. Plain Enter retains
  the catalogue destination; Cmd/Ctrl+Enter and secondary Read use document
  navigation with the originating route.
- CSV, TSV, Parquet and JSON book exports include the stable `ebook_formats`
  union of eligible native formats. Whole exports read availability in batches
  of 500 with position collection disabled. Goodreads retains its own columns.
- `GET /api/ebooks` and `GET /api/ebooks/[id]` expose explicit public metadata
  projections from the actual library queries. Work list/detail GET routes
  include narrow eBook DTOs through a position-free availability batch. Private
  source paths, storage keys, publication reports, positions and signed delivery
  URLs are omitted. The API reference documents these source contracts.
- Copy/edition/work deletion messages explain the existing lifecycle: linked
  eBooks return to review, retaining files, reading positions and annotations.
  No deletion service is changed.

## Regression source added or updated

New cases cover one-query deduplication/empty batches; blocked and download-only
files; replaced-file quotes and clocks; work edition selection; public metadata
redaction; REST id validation and excluded records; parser choices; export
format union; actual palette open-time fetch; cover context/long-press behavior;
mosaic sibling menus/domain isolation; and database availability/filter parity
through unavailable status transitions and copy removal. Existing catalogue
integration expectations now require eligible bytes rather than merely a link.
Synthetic gesture cases do not constitute native browser evidence.

## Verification status and requested next slot

The source was committed without runtime checks during the root's QUIET-494
serial window. Root subsequently ran a bounded verification on `98a3aeb8`
using production Node 22.23.3 and the existing installed dependencies:

- The original scoped check stopped with TS2688 for `mapbox-gl`: its added
  explicit `typeRoots` disabled ordinary resolution of a declaration-free stub
  to Mapbox's bundled types. This is a verification configuration failure;
  package/lock/compiler/type bytes match the passing SLN-493 dependency setup.
  The failed scoped result is retained; no dependency install was needed.
- The ordinary full-project `tsc --noEmit --incremental false` passed in
  14.293 seconds. Repository script exclusions remain; this is not a generated
  Next route or production build check.
- All 19 selected non-DB files ran: 374 tests, 373 passed, one failed, zero
  skipped/todo. The export privacy regex matched the existing
  `acquisition_targets` column's substring `target`, not leaked reader data.
  This failed run remains recorded. Lint did not start after that failure.
- Root recorded empty owned groups and unchanged source/owner bindings. The
  result/log/JSON packet is at
  `/private/tmp/durtal-sln505-verification-request-98a3aeb8/root-execution-node22-fulltypes/`.

The `4bd0a604` follow-up changed only the failing export test and this task record.
Privacy checks now reject exact reader/file/position fields on the flat export
row, retain the required `acquisition_targets` column, and preserve user notes
that contain reader-related words. Production source is byte-identical to
`98a3aeb8`. Root's follow-up passed the two export suites with zero skipped/todo
tests, and lint of the 56 changed product/test files exited zero. The run took
3.398 seconds and recorded empty owned groups, unchanged source/owner bindings,
and removal of the temporary dependency link. Its packet is at
`/private/tmp/durtal-sln505-verification-request-4bd0a604/root-execution-node22/`.
Lint reported 11 warnings: eight existing image warnings and three new React
warnings (two synchronous selection resets in effects and a cancellation
callback referencing its own outer declaration).

The narrow React correction resets an open menu during its own selection render,
before committing children, so leaving selection cannot reopen stale menu state.
The gesture callback has a stable internal function name for removing its scroll
listener; its timer, movement, scroll and cancellation behavior is unchanged.
Existing card/mosaic cases now cover an open menu entering and leaving selection,
then reopening on a fresh context click. No test count, dependency, framework,
warning suppression or baseline image change is introduced.

Requested next root-authorized slot: the card, mosaic and gesture suites; strict
lint of the five changed product/test files; and an ordinary full-project
typecheck because production source changed. These corrections remain unverified.
The prior export results and unaffected cases remain evidence for unchanged
source; no repeat of the 19-file matrix is requested.
Disposable database catalogue and eligibility/filter parity remain separate
later gates. Browser acceptance needs trusted native reader
entry/back/context/touch checks across Chromium, Firefox and WebKit at
1440/768/390, typography/weight and 0.5px alignment evidence, and performance
measurements. No build, browser, DB, deployment or complete integration
acceptance is claimed. The primary checkout remains at `94140915` with the
same six owner changes; manual port 3100 and the Docker/live phone release were
not operated on.

The default Mac `pnpm test:local` runs the Mac Node/Python full test CLI against
fresh disposable Docker PostgreSQL 16, as `scripts/qa/test-local.py` at
`94140915` implements. The required unfiltered Mac and CI suites must pass
without skipped/todo tests; a Mac production build and Docker image build are
separate later gates, scheduled by the root. No new harness is needed.

## Remaining SLN-505 scope

The post-create linking wizard, candidate linking, reverse chooser, digital
copy field population, unlinking and four REST decision actions still need the
reviewed SLN-495/496 service integration. This checkpoint does not invent those
writes. Full integration review, DB/build/browser/performance acceptance,
publishing and deployment remain under root coordination. SLN-505 is not done.

## 11 October 2026 — guarded review UI source checkpoint

Root accepted corrected SLN-496 `455dd2aa` source (independent receipt
`6d5d409b…`), and SLN-496 acknowledged the public single-item interface and
SLN-505 ownership of new bounded read-only projections, parser, UI result
adapters and consumers. New attached `sln-505-review-ui` worktree uses
`codex/sln-505-review-ui`. Integration merge `f186123c` has parents
`455dd2aa` and accepted catalogue `d1e001c0`: the reader retains current
controller readiness, character count, full device/other-device positions and
language; it also keeps validated return origins. The grid retains phone density
attributes. Guarded existing REST contracts are documented. No protected owner,
matching/store/service/preview, schema or dependency source was changed.

Actual source now includes `/ebooks/review`, filtered grouped counts and bounded
rows, focused matching detail, safe server-side result wrappers, exact prepared
effect confirmation, single-item decisions, receipt-backed Undo and 10-second
notifications. Unknown writes preserve the same operation/token; stale and expired
results keep choices and selected rows. Selection, per-page keys and responsive
rows use existing glass controls. Initial rows include at most five edition
summaries per candidate with actual total/copy counts; full edition choices load
on interaction (200 editions/50 copies with explicit bounds).

The reverse chooser uses existing book-only search and actual edition/copy/location
identities. Work and eligible digital-copy actions link through the real service.
The new-copy form puts descriptive values in the one confirmed Link intent;
it never calls createInstance first when an eBook is selected. The planner supplies
format, size and status. Run and Integrations entry points and the book's stored
suggestion count are wired. Ordinary copies retain their existing creation path.

Regression source covers canonical microseconds/filters/limits, query composition
and privacy, result sanitization, exact retries, late cancellation, in-flight
confirmation, stale/expired selection preservation, book/author/copy identity
mapping and selected-copy creation. No tests, type checks, lint, builds, browser,
database or cloud operations were run for this new checkpoint. Prior accepted
d1 UI19/strict lint/full types and corrected export evidence are retained, and do
not prove the newly integrated source.

The independently accepted SLN-496 F1 selection source (`791cbdcf`) is integrated
unchanged. Selected and section-shown actions now use a bounded run of at most
50 actual rendered rows and compare all rendered guards in one read. Ordinary
actions confirm only the real single-target prepared prefix; deferred rows need
another visible preparation after commit. Author-group accession uses explicit
shared author/language choices and displays the service's real counts. Progress,
refusal identities and original-set Undo retain partial and uncertain outcomes.
New regression source covers bounds, microsecond races, prefix/deferred behavior,
fresh match proof, unknown exact retries, cancellation, shared accession choices
and stopped Undo. This addition has no runtime evidence.

Reviewed F3/F4 source is integrated with the exact independently approved
fixture correction, excluding later F2 ancestry. New owned wrappers/UI connect
the real work-status/history decision and its receipt-bound Undo on partially
held rows and the book menu. Known stale status refuses before confirmation;
unknown confirm/Undo results preserve the original capability and lock dismissal.
Preparation errors cross Next only through UUID-bound, capped, fixed vocabulary
issues. Actual fields highlight those labels while retaining author/language/
edition/copy/location choices. Author and series pages now show existing
candidate counts and use real UUID-scoped queue filters. New source cases cover
exact work retries, Undo refusal, public error redaction and retained choices;
none were executed.

The independently identified single-Undo recovery flag is cleared on a definite
retry refusal while retaining the original receipt and visible error. That fix
and its mounted two-row uncertain→definite-refusal source regression are frozen
in separate correction commits, without the later paging delta.

Count-wide section and raw-author group actions now read at most 50 descriptors
plus one server-only sentinel per UUID-keyset page. They retain the actual filters,
display titles before opening preparation and require explicit completion/skip
of the current page before another read. Each prepared group still needs visible
confirmation; no background batch apply or all-scope plan is invented. Real
receipts remain in bounded per-page runs for Undo. New arrivals behind a live
cursor need another pass. Query/cursor/schema and mounted orchestration source
is authored, unexecuted.

The frozen `2995b511` follow-up received independent source approval. A separate
F2 UI preparation now mounts automatic-link Undo and fresh Unlink on real linked
review rows, and lazy fresh Unlink on linked copy rows. Its adapters use the
actual approved 496 exports and strict codecs; the rendered native five-field
identity and canonical microsecond stamp must match the real preparation.
Visible previews retain the actual request/token, show cleanup counts and copy
retention without raw cleanup/restoration rows, and state that the resulting
unlink decision has no inverse Undo. Unknown confirmation locks dismissal and
unrelated decisions, retrying that exact capability. Automatic refusal can switch
to fresh Unlink only by explicit choice followed by another manual preview.
Successful refresh permits the authoritative returned pending row to appear.

New adapter, query and mounted dialog/review-flow regression source covers native
identity replacement, microsecond drift, private projection, explicit fresh mode,
cancelled preparation, in-flight and unknown locks, exact retries, no inverse and
the pending row's return. These cases have not been executed. The accepted F2
backend is a composed recipe containing corrected 495 core source; its standalone
496 commit is not the complete recipe. Import remains held for root coordination.
This owned UI preparation is therefore not a standalone compiled/backend claim.

The remaining two UI consumers are now authored in a separate private source
preparation against actual frozen core and review-adapter interfaces. Eligible
existing-copy editors load one exact raw metadata/version row on opening. The
draft and guard share that read; full chooser stamps use the same repeatable-read
connection as the options. Edit and Link sends only changed descriptive fields
with the original canonical copy stamp in one confirmed `fill_copy` intent.
Reserved location, sub-location, format, size and status edits block preparation
until explicitly restored or the selected eBook is cleared for ordinary Save.
The real prepared request displays the changed values. No standalone copy update
is chained before or after Link. Unknown confirmation locks dismissal and edits,
retains the exact request/token and uses the real receipt notification/Undo.
Known refusal keeps the draft; an explicit reload can retain the chosen changed
fields while adopting the newly displayed copy guard.

Wizard and Fast Track call the actual stored suggestion adapter only after the
real create action succeeds, with its returned work UUID. A positive actual count
offers a Review notification scoped to that UUID. An unavailable result preserves
successful creation and normal book/reading navigation; a true zero count is
silent. Failed creates and new editions of existing works request no new-book
suggestions. Synchronous creation guards stay held through the suggestion read
and navigation so uncertain suggestion transport cannot cause another creation.

New unexecuted regression source covers raw copy projection/privacy, strict tuple
input, null/false patch semantics, reserved changes, exact guards, uncertain
original retries, definite refusal and explicit reload. Mounted creation cases
exercise both actual wizard paths, saved UUID/count feedback, failed creation,
unavailable suggestion transport, pending duplicate clicks and existing editions.
Step controls and external API boundaries are mocked; the consumer, reducer,
patch helper and notification/navigation logic remain real.

This preparation preserves the approved `3d931c2e` union and failed full-types
evidence unchanged. It copies the exact approved `1d6bd067` core delta and the
eight actual `92b13ce9` adapter candidate files into a private complete source
snapshot for joint review. The adapter's independent approval is still pending
at this freeze; copying it here grants no adoption or runtime acceptance. The
separate three-file typing correction must be composed under root custody.
No tests, types, lint, application modules, DB or browser operations ran for this
preparation. SLN-505 remains unfinished pending exact-union source review, focused
runtime checks, ordinary types/lint and real DB/native/performance acceptance.
Central application approval remains a separate hold. No landing, publication or
deployment is claimed.
