# Task 0434: Reader annotations

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-499, SLN-497
**Blocks**: SLN-454, SLN-501, SLN-506, SLN-507, SLN-509

## Overview

SLN-500 adds reader highlights, underlines, notes and bookmarks, durable sync,
conservative re-anchoring, library search and offline exports. This checkpoint
implements only the approved pure policies and deterministic tests from reviewed
reader checkpoint `626f4870e072e33948dccf7f8e3d8f5db44986c7`.

## Implementation Details

- Annotation validation counts Unicode codepoints, refuses incomplete Unicode,
  limits complete passages/notes to 10,000 characters and batches to 200 total
  unique ids, and rejects quote style and server-owned fields from browser puts.
- Separate note and compare-and-set anchor patches preserve quote privilege.
  Ordinary edits preserve actual anchors and their exact/healed/approximate/
  orphaned state. Missing highlighted text is orphaned even with a valid fraction.
- Pure merge decisions implement strict newer-wins and equal replay, final
  deletes and permanent retired-ID rejection even after the full row is purged.
- Timestamp/cursor helpers preserve microseconds and define monotonic server
  time under the future per-book transaction lock, inclusive pull windows and
  full reset after 90 days. Pull reconciliation preserves pending drafts and
  never uses a POST response time to advance the pull cursor.
- Outbox transitions must execute within one IndexedDB readwrite transaction.
  Expiry or hidden-tab claiming seals Undo irreversibly before transmission;
  claim failure/expiry never permits restoration. Exact operation/revision/token
  acknowledgments cannot remove a later edit. The actual IndexedDB coordinator
  and real cross-tab/reload race tests remain required integration work.
- SLN-454's deletion hook prepares serializable keep/delete quote choices with
  exact server-issued note/binding versions; it invokes no tracker writer.
  Cancellation creates no operation. The effect travels in the same durable
  delete revision, is removed with pre-seal Undo and cannot outlive retirement.
  Pure composed decisions validate versions/book binding and produce both
  changes or neither. Conflict settlement retains the whole sealed operation.
  Privileged tracker conversion preserves annotation identity/content/anchors;
  it is absent from browser mutation schemas. Actual transactions remain gated.
- Lifecycle request sizing uses serialized UTF-8 JSON. Logical mutations, including deferred effects and operation metadata, stay
  whole; oversized items remain durable for ordinary foreground requests.
  The shared transport defaults to 100 items, below the endpoint limit of 200.
  SLN-507 supplies the eventual single replay owner; the typed injected transport
  captures original per-item file/device identity, body and local Undo snapshot.
  Enqueue resolves only after the shared durable commit; duplicate enqueue must
  never reset a seal. Auth/device failures block durably. No separate browser
  replayer or IndexedDB implementation is wired in this checkpoint.
- Matching returns whole raw ranges, accepts fuzzy passage/context scores at
  least 0.85, rejects ambiguous placement and returns deferred on bounded-work
  exhaustion/cancellation. It adds no engine, navigation or DOM effects.
- Pure Markdown and W3C AnnotationPage serializers work from explicit local
  data. W3C tagging/commenting TextualBody values avoid the invalid combination
  of bodyValue and body. Orphaned passage/note data is retained in exports.
- Stored colours/styles are semantic and theme-independent. The initial literal
  Quiet Glass fill palette is contrast-tested; 1/2/3/4/5 map to ochre/sage/slate/
  rose/violet. Engine repaint integration must preserve all decoration groups.

## Completion Notes

Partial checkpoint only. No UI, route, database writer, IndexedDB driver, engine
decoration, navigation integration, migration or deployment is implemented here.
SLN-499 and SLN-497 must land before effectful integration. Migration
`0083_ebook_annotations_search` is reserved; its minimal retired-ID ledger and
per-book cursor schema require exact independent review before generation.

Full local database tests, production/browser tests, render/accessibility audits,
page-weight/performance rows, final exact-source review and CI remain mandatory
before landing.

Checkpoint validation (2026-10-09): eight focused Vitest files passed, 65 tests,
no skipped tests in the selected files. Coverage includes complete Unicode
payloads, irreversible delete sealing, exact acknowledgments, permanent retirement,
microsecond cursors, pending reset conflicts, shared quote-matching budgets,
whole-range exports and colour contrast. These are pure policy tests; they do not
prove IndexedDB atomicity or actual cross-tab/network behavior. `pnpm typecheck`
passed. Focused ESLint passed with `--no-ignore` to include all new tests.
