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

Pure eligibility and Continue descriptors are prepared. Targets are eligible
native-readable files; historical same-eBook locators retain their original
file/hash identity, quote context and logical clock. Replacement projection
uses the existing reader engine resolver before a safe fraction fallback and
reports the observed target landing. Local intent and newer remote anchors
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
Database parity, query plans, pages and dependency integration remain pending.
No matching/review writer or status policy is duplicated. Set-aside reason
storage belongs to SLN-495 and decisions to SLN-496.

## Completion Notes

Not complete. The updated source checkpoint passes 243 focused tests (including
187 malformed-metadata cases), `pnpm typecheck`, source lint and diff checks.
SQL/database parity, schema and actual reader integration require subsequent
validation and exact-source review. No production build,
Docker, migration generation/application, AWS, live database or browser
performance checks have run for this task. Full disposable database, browser,
performance, independent review, CI and merge acceptance remain required.
