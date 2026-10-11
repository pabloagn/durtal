# Task 0436: eBook library and detail pages

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-494, SLN-495, SLN-496
**Blocks**: SLN-498, SLN-505, SLN-509

## Overview

SLN-497 adds the digital library and per-eBook detail pages, with readable-file
eligibility, device-aware Continue, natural ordering, bounded queries and
performance acceptance at 6,000 and 7,000 synthetic eBooks.

## Implementation Details

Library grid/list and detail source use shared page, filter, card, table and
record components. Queries bound page rows before file aggregation; detail
keeps ingestion history to twenty rows. Search, filters, sorting and pagination
remain URL state; Continue is one bounded read. Matching/review controls await
the approved SLN-495/496 contracts rather than duplicating their writers.

Eligibility and Continue descriptors are integrated. Targets are eligible
native-readable files; historical same-eBook locators retain their original
file/hash identity, quote context and logical clock. Replacement projection
uses the existing reader engine resolver before a safe fraction fallback and
reports the observed target landing. The exact approved SLN-499 reader source
is merged normally; reader startup and the existing Go there action now call
that resolver with the original locator. Local intent and newer remote anchors
remain separate so SLN-493 owns its existing offer/dismissal policy.

Natural title keys remove one declared-language article and encode each integer
as a fixed ten-digit significant-length prefix followed by a colon and its value
padded to at least six digits. Leading-zero spellings tie; integers beyond six
digits and JavaScript Number precision remain ordered and exact.

Migration `0084_ebook_library` is a review draft: function, trigger, backfill,
state/title and active/title indexes with C collation, created-time index and
bounded ingestion-history index. It is not generated, journaled or applied.
Generation waits for coordinator approval and the approved 0082/0083 snapshots.

SQL download/native predicates are prepared alongside their TypeScript helpers.
Persisted unknown metadata is validated without casts to trusted medallion types:
source and report lineage, original file, marker, cover identities, checksums,
safe positive sizes, MIME types and explicit boolean decisions. Malformed
metadata fails closed for both staged and legacy keys without throwing.
Delivery uses the same eligibility helper. Cover selection checks persisted
publication evidence and emits only recorded widths. Page signing uses a single
CloudFront custom-policy statement for gold derived cover WebP names only,
excluding original files, manifests, bronze and silver. CloudFront supports one
statement per custom policy; live service verification remains pending.

Open first is a real validated action and one locked same-book update requiring
current native capability. Matching/review and set-aside reasons remain upstream.
Local QA preparation includes unique real EPUB bytes, report and manifest
hashes, generated WebP covers, mixed states, 6,000/7,000-book seed options,
page/search budgets and a cold 390px phone FCP/overflow check. Database parity,
query plans, browser audits and remaining dependency integration are pending.
No matching/review writer or status policy is duplicated. Set-aside reason
storage belongs to SLN-495 and decisions to SLN-496.

Bounded continuation on reviewed reader `bc9efbc5`: actual reader/settings
`coverUrlFor` now uses the gold cover-only signer, matching the existing library
caller. Fresh catalogue cover descriptors carry only recorded publication widths;
unknown widths, mismatched hashes, non-cover/stage keys and unpublished widths
are refused, with the route returning 404. Canonical legacy covers keep their
existing delivery path. Detail reads select SLN-495's actual `exclusion_reason`
and display it without adding another status or writer.

The approved SLN-505 UI integration is a separate private overlay: detail stamp
projection preserves UTC microseconds and composes the approved chooser,
new-book form, confirmation/reducer, Undo feedback and unlink control. It is
not installed into this reader checkpoint, whose tree lacks those dependencies.

## Completion Notes

Not complete. Before the coordinator's QUIET-494 performance window, 331 tests
in fifteen files passed (including 187 malformed-metadata cases, reader
projection/clock and offer-race coverage, adapter quote healing, cover policy,
card/navigation/validation and doc coverage). Typecheck passed; changed source
lint had no errors (test files are ignored by repository lint policy); three
small Python fixture tests and syntax/diff checks passed.

The one-statement CloudFront policy correction was made after the quiet request
and is not yet rerun. SQL/database parity, schema and native reader acceptance
require subsequent validation and exact-source review. No production build,
Docker, migration generation/application, AWS, live database or browser
performance checks have run for this task. Full disposable database, browser,
performance, independent review, CI and merge acceptance remain required.

The 11 October source continuation adds regression source for the actual gold
caller/policy, publication widths, format coverage, protected/stale evidence,
route 404 behavior and set-aside reason. Execution was not granted: no tests,
typecheck, lint, build, database, browser or cloud operations ran for this
continuation. The private UI overlay also awaits source review and authorized
combined validation; no merged/deployed or frontend-complete claim is made.
