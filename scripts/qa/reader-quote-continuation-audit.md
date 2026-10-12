# SLN-454 quote continuation source checkpoint

Audited actual experience HEAD: `bc9efbc5ed5e56ea5ab9909d01073ef06344f6db`.
The integrated `1fcdb9f22bac88d3e0f89c7caf6557a114ea6113` work is retained.
This checkpoint changes source only in a fresh isolated checkout. No database,
runtime, installation, generation, typecheck, or test execution is claimed.

## Concrete findings and affected contracts

1. `ActiveReaderTracking.quote` calls `saveReaderQuote`, which atomically applies
   the actual `planHighlight/createHighlight` quote insert and tracker note
   insert. Cache invalidation does not update the mounted reader's annotation
   transport. The actual `useReaderAnnotations` owner subscribes to local
   transport changes; those only call private `refresh()` and read local data.
   Server GETs happen through `pull()` on first paint, visibility, and the
   five-minute interval. An existing GET is shared through `pulling`, so merely
   requesting another pull can reuse a snapshot from before the quote commit.
   The new book-scoped handoff waits for that request and starts a fresh pull
   through the existing controller, shared transport, reconciliation, and engine
   decoration path. It unregisters with the committed owner generation. The
   save result remains committed when refresh fails; no second save is attempted.
   Public/background `pull()` keeps its existing error-reporting contract.
   `readAnnotations` already locks the book, ticks the server cursor, and reads
   a bounded snapshot atomically with inclusive lower timestamp; no cursor,
   synthetic annotation, or outbox modification is needed here.

2. `deleteReadingNote` converts the actual live quote mark to an ochre plain
   highlight via the composed SQL function and deletes the tracker note in one
   atomic batch. Its old snapshot lacked the annotation association;
   `NoteControls` Undo called ordinary note restoration, leaving the plain mark.
   The new paired path journals the native note and exact post-conversion mark
   fingerprint inside the same transaction. Undo accepts an opaque token and
   note identity, reads server evidence, and ignores client snapshot content for
   the paired restoration. It restores the original mark's quote style and note
   association atomically, preserving the immutable mark passage/anchor/file/id
   and edited tracker quote/body/thought/source/book provenance. A new server
   binding epoch is issued. Changed or retired marks, changed copy/edition/work,
   existing note/binding, expired proof, or wrong token/note are refused without
   writes. Actual book/copy/edition binding changes expire unused proof under
   the shared lock protocol, so A-B-A cannot restore an old association through
   a temporary plain mark with no quote epoch. A used token returns replay
   acknowledgement without further effects.
   Both notes-surface transitions request the same mounted annotation refresh.
   Ordinary and detached retained quotes keep ordinary note Undo semantics.

3. The actual prepared `keep-quote` finalizer retires the mark but previously
   kept `ebook_annotation_id` until physical purge. Actual 0087 ownership guards
   inspect that pointer even when the mark is retired, blocking later unlink or
   relink. The exact prepared choice now clears only that pointer in the same
   finalization transaction, guarded by the exact note and binding versions.
   The quote remains on its original work with its original provenance. The
   explicit `delete-quote` choice still deletes the paired note atomically.
   Permanent retirement wins before any late quote effect, preserving a kept
   quote against an old retry. No detach guard or ownership exemption is removed.

## Exact new review inputs and generation boundary

- Actual declaration: `src/lib/db/schema/reader-tracking.ts`, exported through
  the existing `src/lib/db/schema/index.ts` wildcard, now adds
  `readerQuoteUndoReceipts` / `reader_quote_undo_receipts`. Original identity and
  native note evidence have no FK that can rewrite them; the opaque token is the
  primary key, with note index and evidence/finite-time checks.
- Custom proposal: appended paired-Undo section in
  `scripts/qa/reader-tracking-schema-proposal.sql`, including matching table/index
  review DDL and `durtal_reader_delete_quote_with_undo` plus
  `durtal_reader_restore_quote`, plus evidence revocation in the existing
  `durtal_reader_lock_and_rotate_binding`. The evidence expires thirty seconds
  after server deletion, allowing transport grace around the existing ten-second
  UI toast. Root must review that
  boundary before runtime approval. Evidence retention/cleanup remains a future
  policy; these short-lived authorities are not sitting receipts.
- Composition proposal: `scripts/review/0083_deferred_quote_contract.sql`,
  `durtal_annotation_finalize_delete` keep branch. This definition depends on
  the actual 0087 note column and must be composed after its creation, never
  applied inside 0083 before that column exists. Paired Undo calls the existing
  actual `durtal_tracker_delete_live_reader_quote`; it does not duplicate that
  conversion protocol.
- Previous schema approval `19209f440b` does not approve this new declaration or
  function delta. Root must review this exact source checkpoint separately,
  generate/compare new 0087 DDL, avoid duplicating the table/index review DDL,
  compose the dependent functions in valid order, and grant a test slot.
  No generated migration or migration journal is changed in this checkpoint.

## Authored regressions, not executed

`src/__tests__/reader/annotation-server-changes.test.ts` exercises the real
controller GET, shared-transport reconciliation, and engine decoration after a
quote-save callback commits while an older GET is in flight. It also covers
commit ordering, rejected save, refresh failure preserving the save result, and
unregistration. It uses the established in-memory engine and transport fixtures;
it does not claim SQL quote-save validation.

`src/__tests__/integration/reader-quote-binding.test.ts` adds real
`saveReaderQuote` through its actual prepared plan and atomic note/mark insertion,
followed by actual `readAnnotations` bounded SQL reads, controller reconciliation,
and engine decoration. Its connection is replaced with the explicit disposable
database and Next cache calls are stubbed; the action and SQL logic stay real.
It also exercises actual `deleteReadingNote`/`restoreReadingNote` paired Undo
with forged client body/work ignored in favor of server evidence, SQL replay,
refusal after mark edit/retirement or book relink/expiry (including A-B-A),
prepared keep pointer-only detach with original provenance and later relink,
late delete effect against permanent retirement, and stale/fresh explicit delete.
It retains all prior race tests and only accepts the explicit disposable local
`sln454_reader_quote` database URL. It applies generated migrations, never these
review proposals, and now requires both paired functions to be installed.

Remaining validation: root source/schema/composition review, approved generation,
focused controller tests/typecheck and disposable database regressions. The
database-backed suite must not be reported as passed if skipped for no URL.
