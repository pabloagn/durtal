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
decoration, navigation integration, generated migration or deployment is implemented
here. Proposed Drizzle declarations and hand-written review SQL for reserved 0083
add note/locator/metadata bounds, a quote binding epoch, live trigram and sync
indexes, permanent retired IDs and per-book microsecond cursors. Docs 02 matches
the proposal. Exact SQL review and dump rehearsal are prerequisites to generation;
no migration journal/snapshot or live schema was changed.
Effectful integration will consume the actual reviewed SLN-493/499 navigation
and SLN-497 library source through normal merges, and SLN-507's concrete injected
store when it exists. Current observed SLN-499 committed checkpoint is
`9a69cfd3309a91daf2fefb46cef411b3c4a5c1b9`; its pending accepted-fix edits are not
copied. SLN-497 is `742b190b440b86b127331689dbb3f1b00df67d71`. No concrete shared
SLN-507 store is available yet; its pure policy files do not authorize a second
annotation replayer. Migration `0083_ebook_annotations_search` is reserved;
`scripts/review/0083_deferred_quote_contract.sql` separately drafts the composed
operations gated on 0087's actual note FK/book guard. Both SQL proposals need
exact independent review and later native concurrency/rollback/retention tests.

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

Schema review snapshot: `scripts/review/0083_schema_snapshot.json` is serialized
from the actual Drizzle table declarations by the read-only
`capture-0083-declarations.ts`; it is explicitly not Drizzle migration metadata.
No `drizzle-kit`, database connection, migration generation or SQL execution was
used. It records types, string timestamp columns, constraints, FK names and index
expressions. The proposed SQL has not been PostgreSQL-compiled or rehearsed yet;
native concurrency/rollback coverage and existing-locator dump preflight remain
required after exact review. The proposed declarations pass `pnpm typecheck`
and focused ESLint. Historic pure checkpoints `c3c9aae6` and `7da122cd` remain
unchanged ancestors.

Independent review approved exact pure checkpoint `7da122cd` (65 focused tests),
and requested one schema correction to `70c6b5c1`: row triggers cannot protect
retired identities from TRUNCATE. The corrected review SQL adds a statement-level
BEFORE TRUNCATE guards on both the ledger and cursor table, including cascading
truncation. The cursor guard preserves the accepted READ COMMITTED/VOLATILE
fresh-read protocol and prevents clock reset. New native source coverage
in `reader-annotation-retirement.test.ts` tests direct/cascading truncation,
preserved identities, monotonic cursor continuation and blocked replay. It requires disposable
`sln500_reader_annotations` with generated/reviewed 0083 installed; it has not run
while generation/native execution is gated. Existing database fixture resets must
use fresh isolated databases rather than a bypass for this permanent ledger.

Approved SLN-499 navigation `f1c4cadf994592755b3ac214f291c9e4e7fc1eea` was normally
merged into this branch, preserving all original commit identities. Server,
decoration and UI work continues against that source; shared queue wiring waits
for SLN-507's concrete implementation instead of adding a second replay owner.

Narrow correction validation after the SLN-499 merge: all 65 focused annotation
tests, TypeScript and focused ESLint pass. Native regression source is present
but no SQL or native database test was executed. Drizzle declarations are
structurally unchanged, so the captured declaration snapshot remains exact.

Reader source integration now implements independent full-state decoration groups
and a per-section index. The adapter uses the actual loaded overlayer, verifies
the whole passage before filled drawing, supports highlight/underline/double
quote underline/margin note marks, and reinstalls groups after overlayer rebuild.
The existing history outline remains a separate group and clears on owned turns.
`resolveAnnotation` is a strict, cancellable resolver with per-open document/text
caches and one matching budget across sections; missing/ambiguous highlights are
orphaned, while bounded/canceled work remains pending. It never navigates.

The bridge now dispatches `annotation-activated` after paint and evaluates the
default menu only after synchronous plugin handlers can prevent it.
`useBeforeAnnotationDelete` keeps current callbacks and collects prepared quote
effects, cancellation and abort before any durable operation. Conflicting quote
effects are refused. The boolean cancellation contract remains supported.

Focused DOM/unit source tests cover group collisions, full-state moves/removals,
1,000-mark section indexing, rebuilt overlay drawing, whole-range verification,
replacement/missing/ambiguous text and deferred event/default cancellation.
These are source-level checks, not native browser/performance acceptance. UI,
server, library search/counts and shared durable queue wiring remain active work.
SLN-507 concrete source `13ff2a57` is available; a hidden-tab sealing issue was
relayed to its owner (preflight failure/oversized deferred body must still seal).

Source milestone validation: 118 tests in 16 focused suites pass, as do whole-project
TypeScript and focused ESLint (including test source). No native database, real
browser, full local suite, migration generation or live application work ran.
