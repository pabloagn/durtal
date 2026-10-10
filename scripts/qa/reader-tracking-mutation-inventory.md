# SLN-454 receipt and quote mutation review

Reviewed reader baseline: `626f4870e072e33948dccf7f8e3d8f5db44986c7`;
pure checkpoint: `a1e0c23d64e6499cf13fb1c0dc8f13b93750488a`. The declarations
and SQL proposal in this checkpoint have not been generated/applied. Line
numbers below refer to the baseline functions, not a future merged release.
Refresh this inventory after upstream merges before generation or integration.

## Exact transaction protocol proposed for review

Permanent receipts have immutable original reading/e-book/device/session IDs;
only their live session FK can clear. Retirement preserves the last cumulative
revision and payload, clears that FK, sets a finite server retirement time and
one constrained reason. Restore/Undo never reactivates the original sitting.
A new sitting has a new UUID. Delete and truncate of receipts are refused.
The FK SET NULL is handled in a BEFORE receipt trigger, before the CHECK.

A tracker service must consult an existing sitting receipt before trying to
load a deleted reading or insert a replacement. Same/lower revisions return
their replay acknowledgement; retired receipts return their permanent retired
acknowledgement. Ownership mismatch is refused even when retired. A previously
unknown UUID cannot attach to a closed reading. A replay cannot auto-create,
reopen or bind a reading. The route's server device cookie is authoritative.

For a fresh revision: load/plan outside atomic; inside one atomic batch lock the
reading and assert the exact fingerprint, lock/assert the sitting's expected
revision and full immutable owner, assert current book/copy/edition binding,
persist the new cumulative receipt, set the transaction-local session token,
write canonical session totals plus derived starts/reading progress, then clear
the token. Canonical time equals sum(active receipt seconds), not a sum of
repeated beacon deltas. Receipt monotonicity and deferred canonical equality
are database guards; the token also requires a receipt written in that same
PostgreSQL transaction (`xmin` equals current xid). Never hold the token around
an unrelated user mutation. No await/query inside the atomic builder.

An initial new session is inserted before its first receipt. A merged sitting
can attach only to the same book/edition/ebook-format canonical reader session
with active owned receipts, no edits/retirement, no explicit backwards split,
a nonnegative gap under ten minutes, no overlapping intervals, and total time
at most 86400 seconds. Its original_session_id is that canonical session ID.
An older receipt cannot extend across a later sitting's interval; the deferred
overlap check rolls that write back. A late extension must replan/retry, never
overwrite another device's canonical progress.

Receipt ownership uses FOR SHARE on current reading/session/e-book/copy/edition/
work rows to protect non-key binding columns through commit. Catalogue mutations
may take those locks in a different order: PostgreSQL deadlock/serialization
failures need bounded whole-operation retry against fresh data. Every retry must
reuse the sitting UUID/revision and check retirement first. A failed batch is
not an acknowledgement. This contract needs disposable concurrency proof before
landing; no SQL runtime proof is claimed here.

The exact custom triggers are in `reader-tracking-schema-proposal.sql`.
Unmarked canonical edits conservatively retire receipts. Existing derived
startUpdates can run without retirement because they alter only start counters;
their owner's explicit user mutation must retire first if it changes user intent.
No-op explicit user edits need that callsite retirement even if a value-sensitive
trigger sees no difference. The declarations alone do not wire those callsites.

## Current canonical writes and required integration

| File and callable | Current writes | Receipt requirement |
|---|---|---|
| `src/lib/reading/service.ts:242` createReading | Reading + initial status history, atomically removes Up Next | Reader auto-start must compose creation and first sitting, guard one open reading and cancel its own Undo window. Existing manual creation stays its existing operation |
| `src/lib/reading/service.ts:351` recordProgress | New session, fix-last session, completed timer, derived starts, reading position/status/history | Manual/timer branches retire affected ongoing reader intent before mutation; reader branch needs approved receipt-aware continuation instead of a fresh UUID on each flush |
| `src/lib/reading/service.ts:178` startUpdates | Derived startPage/startPercent/startMinutes and updatedAt | Preserve as derived-only exception; never retire just for recomputation. User start/total/binding changes must retire at their caller first |
| `src/lib/reading/service.ts:589` correctLastLog | Pure correction plan consumed by actions | Its applying caller retires the corrected session and affected ongoing reading before applying the plan |
| `src/lib/reading/service.ts:647` recomputeQueries | Derived starts + reading position/updatedAt | Receipt-aware tracker path carries proof; manual paths retire before recomputation so old beacons cannot recalculate over the edit |
| `src/lib/reading/service.ts:690` writeReadings | Imported/manual/backfill reading insertion, duplicates/source keys | Reader import must use backfill source plus reader source key; no sitting receipts are synthesized from historical positions |
| `src/lib/actions/reading.ts:130,146` startReading/logProgress | Delegates creation/recordProgress | Preserve validated book/edition/copy/fingerprint and UI activity semantics; retire existing affected intent for manual progress |
| `src/lib/actions/reading.ts:305` undoProgress | Restores previous end or deletes new session; can repause; recomputes | Retire all receipts of target canonical session before change, also affected ongoing reading; compensation uses original fingerprint. Undo must not erase/reinsert a sitting receipt |
| `src/lib/actions/reading.ts:352,372,378` changeStatus/pauseReading/resumeReading | Status/history | Pause retires ongoing intent; resume starts a new sitting rather than reactivating the retired one. Guard current fingerprint |
| `src/lib/actions/reading.ts:415,475` finishReading/abandonReading | Optional closing session, terminal status/dates/rating/history | Retire all reading receipts atomically; finish remains explicit. Raw reader end alone does not write terminal status |
| `src/lib/actions/reading.ts:533` reopenReading | Deletes optional closing session, clears terminal dates/status | Existing explicit reopen permitted; retired receipts remain retired, even if same canonical IDs survive |
| `src/lib/actions/reading.ts:596` addPastReading | Historical reading insertion | No sessions/receipts inferred; preserve duplicate rules |
| `src/lib/actions/reading.ts:651` updateReading | Reading patch, optional correction session, derived progress, note refile | Explicitly retire reading receipts before even a no-op edit; changes to totals/start/binding/current chapter must not accept late old-client updates |
| `src/lib/actions/reading.ts:934` deleteReading | Reading DELETE cascades sessions/history; note reading FK clears | BEFORE retirement preserves all original identities. Reading snapshot/restore does not include receipt revival |
| `src/lib/actions/reading.ts:963` restoreReading | Restores reading/session/history snapshots, note association | Restore canonical data only; old receipts survive separately as retired. Never import a receipt snapshot supplied by client |
| `src/lib/actions/reading.ts:1030` updateSession | Session times/duration/day/zone/edition/format/end/note, recompute | Explicitly retire session receipts before even a no-op edit; fence ongoing reading as needed. Canonical source may stay reader but does not authorize receipt extension |
| `src/lib/actions/reading.ts:1113` addSession | Delegates manual recordProgress | Manual branch retirement and overlap validation apply |
| `src/lib/actions/reading.ts:1145` restoreSession | Same ID/source restored, recompute | No old receipt reactivation; receipt presence prevents treating restored source=reader as mergeable owned session |
| `src/lib/actions/reading.ts:1179` deleteSession | Session DELETE, recompute, returns Undo snapshot | Retire before delete. Live FK clears; original session UUID remains. Restoring this snapshot does not reopen old sitting |
| `src/lib/reading/timer-service.ts:82` startTimerOn | Timer row + optional paused-reading resume | Timer row stays separate; if status changes, retire ongoing reader intent. Do not count timer + tracker activity twice |
| `src/lib/reading/timer-service.ts:139,152,170` pauseTimerRow/resumeTimerRow/discardTimerRow | Timer row pause fields/delete | Timer source never gets a reader receipt. Existing single-timer/fingerprint/stop semantics remain |
| `src/lib/reading/timer-service.ts:185` undoStop | Restores timer row, can fix preceding session end, status/recompute | Retire receipts on any corrected preceding reader session; never turn a reader receipt into a timer receipt |
| `src/lib/reading/import/store.ts:329` commitImport | Calls writeReadings, ratings/identifiers, queue/notes, row outcomes | Reader source branch must suppress unrelated side effects and compose operation-owned outcomes with the actual insert. Existing lockedImport does not serialize the entire operation |
| `src/lib/reading/import/store.ts:602` undoImport | Bounded DELETE of unedited/session-free imported readings; notes/queue undo | Require reader operation-owned written IDs, not broad importId fallback; same-transaction guards. Retirement trigger handles any retained receipt identity without purge |
| `src/lib/actions/reading-bulk.ts:45,135` markWorksRead/undoMarkWorksRead | Insert past reads; guarded DELETE | No auto-start/receipt creation; DELETE retirement applies. Retain source-key and no-session ownership guards |

`src/app/api/readings/route.ts:45`, `[id]/progress/route.ts:54`,
`timer/start/route.ts:38`, `timer/stop/route.ts:40` delegate to these same services.
They do not get a second independent receipt implementation. TUI
`scripts/tui/reading_panel.py` calls those REST routes. Seed
`scripts/ingest/seed_readings.py` uploads then commits through import APIs; its
source-specific workbook acceptance remains outstanding. No live seed/write is
authorized by this source checkpoint.

## Binding and generic cascade/merge writes

| File and callable | Current effect | Required guard/composition |
|---|---|---|
| `src/lib/actions/editions.ts:114-127` updateEdition | Clears old-work session/reading references, updates edition work | Session/reading/edition triggers retire; quote annotation link must clear if retained on a work different from the final e-book binding |
| `src/lib/actions/editions.ts:215` deleteEdition | Copy cascades, reading/session edition SET NULL | Edition/instance/reading/session retirement guards cover direct and FK writes. E-book files stay; keep old quote text with safe cleared annotation link |
| `src/lib/actions/identify.ts:289,333` identify paths | Edition metadata/placeholder update | Work binding change retires; metadata-only identification does not reset a sitting |
| `src/lib/actions/identify.ts:383-403` moveToExistingEdition | Copies/readings/sessions/notes/queue move to real edition; placeholder deleted | Copy/reading/session retirement in same atomic operation. Retire original receipts; matching final same-work quote link may remain |
| `src/lib/actions/instances.ts:31,53` updateInstance/deleteInstance | Can change edition; copy DELETE clears ebook instance | Copy/ebook guard retires. Relink/delete retaining quotes must clear incompatible note annotation references atomically; existing deleteInstance currently lacks that composition |
| `src/lib/actions/locations.ts:57` deleteLocation | Cascades copies, clears reading location | Copy cascade guards cover reader binding; quote retention composition is needed before copy cascade |
| `src/lib/actions/works.ts:676` deleteWork | Work DELETE cascades readings/editions/copies/notes | Reading/edition/copy BEFORE guards preserve receipt identities. Notes themselves are gone in the work cascade; unrelated e-book files survive |
| `src/lib/harmonization/merge.ts:502-586` mergeQueries | Generic introspected FK UPDATE/DELETE for works, editions, instances plus final source DELETE | Receipt original IDs are intentionally not FKs and must not appear as rewrite references. The live session FK is a normal reference. Reading/edition/copy/ebook triggers retire. Preserve existing audited note move pass-through and validate final binding after merge ordering |
| `src/lib/ebooks/ingest/register.ts:230,296` registerGroup/undoIngest | Changes preferred file/cover; can DELETE ebook at 352 | Preferred-file/cover changes alone do not retire ebook-level sitting identity. E-book deletion retires before deleting, and receipts survive without an ebook FK. Legacy recovery input's RESTRICT is intentional |
| `src/lib/actions/publishers.ts:501` publisher reconciliation | Edition publisher metadata | Not a work/edition identity move; no receipt retirement needed |

Existing book-only/domain guards remain unchanged. New receipt triggers never
authorize changing a work's kind or bypass audited harmonization constraints.
`ebooks.instance_id` FK SET NULL changes match_state through the existing
ebook_copy_removed trigger; receipt guard sees instance identity change even if
alphabetical BEFORE trigger order changes match_state first.

Additional moving upstream declaration, read only: SLN-495 at `92dd605c` on
9 October includes `src/lib/ebooks/match/classification.ts:26` updates of match
tier/fingerprint/duplicate classification and possible restored match_state.
Actual link/relink/unlink services are not present in the inspected tree. They
must compose receipt retirement and quote unlink hooks when reviewed, not be
assumed to exist or copied into 454 as fake adapters. Refresh against the root-
approved final source pin. Other 498 bulk effects have no approved source here.

## Quote and annotation callsites

| File and callable | Existing writes | Required 454/500 composition |
|---|---|---|
| `src/lib/actions/reading-notes.ts:185` createReadingNote | Note INSERT | Ordinary manual note remains independent; saveReaderQuote composes prepared annotation queries + linked quote INSERT in one atomic batch |
| `src/lib/actions/reading-notes.ts:217,265` updateReadingNote/toggleNoteFavourite | Note content/references/star UPDATE | Keep original quote text/link; use expected note/binding versions for cross-surface conflicts; link is not arbitrary client input |
| `src/lib/actions/reading-notes.ts:276` deleteReadingNote | Note DELETE and snapshot | Linked quote deletion requires privileged same-transaction annotation conversion to plain highlight, preserving ID/anchor/text/annotation note |
| `src/lib/actions/reading-notes.ts:285` restoreReadingNote | Snapshot INSERT | Existing snapshot validation has no annotation link field. Paired Undo needs reviewed server-owned linkage/version proof, not a blind client reference or annotation resurrection |
| `src/lib/reading/import/notes.ts:244,292` commitNotes/undoNotes | Private-note INSERT, guarded DELETE | Reader backfill suppresses note imports entirely. Goodreads imports have no annotation links; retain existing rules |
| `src/lib/actions/reading.ts:907,1000` refile/restore note associations | Reading/edition refs change | Final note/annotation work guard applies; preserving book ownership and existing snapshot validation is mandatory |
| `src/lib/actions/editions.ts:122`; `identify.ts:397`; generic merge | Note edition/work UPDATE | Preserve existing audited pass-through and final constraint check; never rewrite a quote to an unrelated book |

Note REST routes (`src/app/api/readings/notes/route.ts:112`,
`notes/[id]/route.ts:43,58`) delegate to the same note actions and need the same
composition. Tracker-origin delete cannot bypass the paired annotation change.

SLN-500's reviewed contract is prepared annotation queries plus deferred
PreparedAnnotationDelete cancel/proceed; exact quote/keep/delete effects and
expected versions are server validated. Await confirmation before durable
outbox/op/revision; Undo cancels both intents before 10s seal; hidden seals the
same composed operation. Conflict deletes neither. Its source tree is moving
(`7da122cd` observed before reads); actual source must be pinned and root-
approved before consuming services. The current 626f4870 baseline has schema
and bridge but no actual annotation service/plugin helpers. These declarations
do not claim those helpers or a completed 454 plugin.

## Outstanding work kept with this checkpoint

1. Independent exact-schema/trigger review, particularly the same-transaction
   write proof, conservative retirement, deadlock retry and deferred quote checks.
2. Approved actual 493/499/500 source pins, then real sitting/backfill receipt
   services, routes and eager tracker plugin; no competing provider refactor.
3. Reader import source branch, durable row operation ownership/serialization,
   preview/commit/Undo UI, bidirectional Goodreads/StoryGraph duplicate proof.
4. Auto-start/Undo, pause/resume, counted jumps/backwards/end flush, settings,
   status/estimate/menu/quotes/Open eBook card integrations; consume 553 bootstrap.
5. Disposable migration/recovery/concurrency/integration proof once authorized;
   generate 0087 only on exact current approved main. No generated files yet.
6. SLN-450 workbook acceptance; default Mac/full zero-skip DB/Python, native
   widths/touch/focus/audits, production/Docker/final-head CI and root deployment.

Static inventory only. No database, browser, build, migration-generation or live
result is claimed. Owner primary and manual server 3100 are unchanged.

## Independent review correction after 07e222f0

Formal SCHEMA_REVISE identified two P1 gaps: note ownership checks lacked binding
locks, and neither association epochs nor monotonic note timestamps existed.
The corrected SQL uses SLN-500's actual 0083 book/annotation locks, re-reads
ownership after waits, and applies those locks to note writes plus catalogue
binding writes. Deferred checks also lock before their fresh final read; they
are a final consistency check, not the primary synchronization protocol.

`durtal_reader_lock_quote_notes(noteIds, prospectiveAnnotationIds)` and
`durtal_reader_lock_quote_ebooks(ebookIds)` are the concrete pre-DML helpers for
the callsites above. All book locks are sorted, then annotation IDs, then note
rows. Note discovery that changes while waiting raises 40001 for whole-operation
replanning. Row-trigger fallback prevents invalid commits for raw SQL or an
unconverted caller, but normal application batches must prelock before row DML
to avoid inverted-lock deadlocks. This is still a pending source integration
obligation for note actions, catalogue/merge/cascade and 495 relink writers.

Association changes (note link/work/reading/edition and e-book/copy/edition
binding) rotate server-issued live annotation epochs. Retired/tombstoned marks
are never updated or restored by epoch rotation. Linked quote/user note edits
stamp an exact PostgreSQL timestamp strictly later than the previous version;
ordinary automatic imported-note reference maintenance preserves its timestamp.
Prepared deletion reads exact microsecond note versions from SQL; no Date-based
millisecond round-trip can reconstitute an opaque expected version.

`src/__tests__/integration/reader-quote-binding.test.ts` has six authored database
cases: repeated/backward application timestamps; ordinary imported-note FK
clearing; A-B-A plus rejection of an old epoch by the actual composed delete;
quote-write-before-relink and relink-before-quote-insert with actual PostgreSQL
blocking observation; kept-quote deletion leaving a retired mark unchanged.
Its sole URL opt-in is a dedicated localhost/127.0.0.1 sln454_reader_quote database.
It runs only generated migrations and requires the real 0083/0087 composed
functions. The source has been typechecked; no database case has executed yet.
No fake transaction model or mocked lock is offered as race proof.

PostgreSQL references for this protocol:
[READ COMMITTED snapshots](https://www.postgresql.org/docs/16/transaction-iso.html),
[VOLATILE query snapshots](https://www.postgresql.org/docs/16/xfunc-volatility.html),
[row/advisory locks and deadlocks](https://www.postgresql.org/docs/16/explicit-locking.html).
The lock-order and retry obligations are explicit because a deferred unlocked
query cannot make concurrent decisions serialize.

## Draft implementation checkpoint after the quiet window

The source now includes the concrete `reading-tracker` plug-in registration,
eager four-handler controller, visible readiness-failure component, bounded
receipt route, persistent device-scoped sitting queue, atomic first sitting,
quote insertion through SLN-500's actual prepared-highlight functions, and
deferred keep/delete quote confirmation. It consumes SLN-493's controller hooks
and SLN-553's real timer availability; those source dependencies must be merged
before typechecking this branch. No compatibility shim acknowledges readiness.

The controller stages cumulative snapshots while creation or its ten-second
Undo is pending, preserves receipt IDs across amendments, suppresses counting
while a same-book manual timer exists, and flushes on visibility/close. The
server rejects timer-overlapping snapshots. Six controller tests have been
authored but not run in this checkpoint. Existing pure-policy tests from before
the quiet window remain evidence for their earlier source, not this new code.

Recovery has its own read-only preview and `imports.source='reader'` operation
journal. Commit rebuilds catalogue ownership from the database, writes in
batches of at most 100 through `writeReadings(source='backfill')`, and journals
only inserted IDs and their exact database fingerprints in the same batch.
Undo removes only unchanged, operation-owned readings and restores their saved
Up Next entries when no later open reading claimed the book. It creates no
historical sessions, ratings, identifiers or private notes. Preserved historical
dates are the sole input; the removed 0075/0076 data has not been reconstructed.

Pre-DML book/annotation/note locks now cover reading and note mutations,
edition edits/deletion, instance edits/deletion, location deletion, work
deletion, same-book placeholder replacement, generic work/edition/instance
merges and recovery Undo. The complete discovered book set is locked before
note rows. Whole-operation retries are limited to 40P01/40001. Existing raw
guard triggers remain a fallback, not a substitute for callsite ordering.

Still outstanding before source approval and deployment:

- The actual SLN-500 annotation-controller refresh API after quote insertion;
  no invented event or unimplemented bridge method was added.
- Paired Undo of a quote deleted from the notes surface. The current existing
  note snapshot restore deliberately does not trust a client-supplied annotation
  reference; it restores an ordinary quote. A server-owned linkage proof and
  reviewed live-highlight restoration are still needed.
- Safe retained-quote detachment for copy/edition unlink or cross-book moves,
  and the final SLN-495 relink writer. Source prelocks alone do not implement
  those semantics; the earlier rejected broad detach rewrite was never applied.
- Targeted controller/queue tests, real shared-source typecheck/lint, disposable
  receipt/backfill/quote concurrency tests, migration generation on approved
  current main, and the combined native-browser/full validation gates.

The latest source received a TypeScript parser-only syntax check with zero
diagnostics. That is not a typecheck, test pass, runtime or database claim.
