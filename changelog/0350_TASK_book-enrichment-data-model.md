# Task 0350: SLN-462 Book enrichment data model (PR 1 of 3: the migration)

**Status**: Completed
**Created**: 2026-10-06
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: 0348 (SLN-490, migration 0076)
**Blocks**: 0351 (SLN-462 PR 2: services, actions, vocabulary loader), SLN-463 to SLN-473

## Overview

Book enrichment 2/13 (epic SLN-460). Every later step of the pipeline writes
into tables that did not exist: proposed values with their evidence, the
approved vocabulary, the apply log with undo, auto-accept rules, popularity
snapshots and the job queue. Joris, 6 Oct 2026: the goal is a properly
populated taxonomy, so an accepted term is written into the existing taxonomy
junction tables, where the library filters, `GET /api/works`, the book page,
`/taxonomy` and the suggestion engine already read it. This PR is the
migration; the services come in PR 2 and the v1 vocabulary in PR 3, after
Joris approves it.

## Implementation Details

- Migration `0077_book_enrichment`: ten tables (`enrichment_vocabulary_versions`,
  `enrichment_dimensions`, `enrichment_terms`, `enrichment_claims`,
  `claim_evidence`, `work_enrichment_values`, `enrichment_applications`,
  `enrichment_auto_accept_rules`, `work_popularity_snapshots`,
  `enrichment_jobs`) and `works.original_title` (books only, trimmed, 1–500
  characters). Additive: no existing row, id or column changes.
- Schema in `src/lib/db/schema/enrichment.ts`; the closed lists (layers, value
  kinds, apply targets and the kinds each accepts, statuses, reasons, job
  kinds) in `src/lib/enrichment/model.ts`, read by the checks.
- Custom SQL in 0077: `book_parent_required` on the five tables with a work;
  the claim guard (value of the dimension's kind, a current term of its own
  dimension, a scale value equal to its anchor's, no claim on a `none`
  target, the edition rule, immutable value, method, run and version,
  confidence only while proposed, a final rejection, moves only in an audited
  merge); evidence guards (never changes, payload excerpt equal to the
  payload at its path, text hash equal to the record's `textSha256`, a source
  of the claim's book or its editions, outlet equal to the provider); commit
  checks (evidence for open and accepted API or agent claims, the human claim
  rules, value rows to their accepted claims, one number per book); the term
  guard (exactly one item of the dimension's family, a system item checked in
  its table, an attribute's category, three examples or one anchor, only its
  retirement changes); a delete guard on the ten system taxonomy tables and a
  category guard on attributes; the rule guard; the apply log guard; two
  deferred source-record keys; four partial unique indexes with
  `NULLS NOT DISTINCT`.
- Merges: `enrichmentMergeQueries` (`src/lib/harmonization/enrichment-merge.ts`)
  in `executeMerge`'s strategy dispatch; `mergeBlockers` refuses two books
  with different accepted values for one single-value dimension, a merged
  book with a running job, and a governed taxonomy item.
- `deleteEdition` is one `atomic` in `withReadableErrors`: it refuses while
  an accepted value rests only on the edition's sources, otherwise it removes
  that evidence and rejects the proposals left without any.
- Interchange moves to version 3: its format pins every column, and
  `works.original_title` is a new one. `src/lib/interchange/version-2.ts`
  reads a version 2 file (and a version 1 file after its reader) with the
  original title empty.
- Docs: a "Book enrichment" section and `original_title` in docs/02;
  interchange version 3 in docs/05.

### The SLN-355 tables first

`source_records` fits every fetched document and API answer: an immutable
payload with its hash, URL, attribution and retrieval time
(`src/lib/db/migrations/0042_catalogue_provenance.sql:145-229`). A row has one
owner, so a review cited for two books is stored once per book. Its
`review_status` says whether the observation is a faithful record of the
source, not whether a claim is accepted; enrichment writes observations as
`accepted`, as SLN-414 and the author enrichment do. `catalogue_identifiers`
fits external IDs: work IDs use `entity_kind 'book'`, edition IDs `'edition'`,
and `wikidata`, `open_library`, `oclc` and `lccn` pass its provider check. Its
unique `(provider, entity_kind, external_id)` already refuses one QID for two
works. No external-ID table was added. The missing pieces were claims,
evidence links, the vocabulary, accepted values, the apply log, rules,
popularity snapshots and jobs: the new tables.

## Completion Notes

RESULTS
