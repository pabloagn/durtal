# Task 0351: SLN-462 Book enrichment services (PR 2 of 3)

**Status**: Completed
**Created**: 2026-10-06
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0350 (SLN-462 PR 1, migration 0077)
**Blocks**: SLN-462 PR 3 (the v1 vocabulary), SLN-463 to SLN-473

## Overview

Book enrichment 2/13 (epic SLN-460), PR 2: the services, server actions and
vocabulary loader that write into the tables of migration 0077. Proposals
carry their evidence; Pablo or an enabled rule accepts them into their
target (a taxonomy link, a value row, a `works` column or a catalogue
identifier); every apply is logged with its before and after and can be
undone; the job queue serves the later stages. All of it runs against a
small fixture vocabulary; the v1 vocabulary is PR 3, after Joris approves
SLN-461.

## Implementation Details

- `src/lib/validations/enrichment.ts`: the job reasons and holds, the
  proposal, accept, reject and edit inputs, and the vocabulary seed schema
  with its rules (examples, anchors, unique keys, kind fits target,
  parameters only of the dimension's own kinds: `research`,
  `exclusiveTerms`, `easierEnd`, `bands`).
- `src/lib/enrichment/rules.ts` (pure): a value's columns per kind, the
  proposal skip rules, the daily caps on rule applies in a rolling 24 hours
  (SLN-461's v1 proposal: 100 for exact identity links, 20 for the rest),
  the job backoff and a job's last error.
- `src/lib/enrichment/targets.ts`: `APPLY_TARGETS`, one entry per apply
  target: reads the current value, says whether a value is there, writes and
  restores. `taxonomy` writes the junction row of the term's item through the
  family's storage, keeping one governed item per book on a single-value
  dimension; `values`; the three `works` columns and the work type;
  `identifier` (a `catalogue_identifiers` row, one per provider and owner);
  `none` and the four edition targets refuse ("No writer for <target>").
- `src/lib/enrichment/claims.ts`: `proposeClaims`, `applyClaim`,
  `createHumanClaim`, `undoApplication`, `workEnrichment` and the claim
  fingerprint. Each reads first, makes its ids up front, and writes in one
  unit on the connection it is given (`atomicOn`, new in
  `src/lib/db/atomic.ts`): the app's Neon batch, or a script's transaction.
- `src/lib/enrichment/jobs.ts`: the queue functions.
- `src/lib/enrichment/loader.ts` and `scripts/enrichment/vocabulary.ts`: the
  vocabulary loader (plan by default on a read-only session; `--apply` with a
  backup under an hour old and Pablo's approval link; `--undo VERSION`).
- `src/lib/enrichment/governance.ts`: hand edits of governed items through
  `workTaxonomyQueries` (`updateWorkTaxonomy` and the wizard).
- `src/lib/actions/enrichment.ts`: `getWorkEnrichment`,
  `acceptEnrichmentClaims`, `rejectEnrichmentClaims`,
  `createHumanEnrichmentClaim`, `undoEnrichmentApplication`,
  `undoEnrichmentBatch`. Activity events `work.enrichment_applied` and
  `work.enrichment_undone`; cache tag `enrichmentVocabulary`.
- Fixture vocabulary `src/__tests__/fixtures/enrichment/vocabulary.json`:
  nine dimensions covering the eight value kinds, a system family (themes)
  with a tree (dark, gothic), an attributes category (pace), a custom family
  the version creates (moods), two disabled rules.
- Left out, as the coordinator decided: the evidence payload schema with
  `textSha256`, which the evidence store (SLN-468) owns as
  `src/lib/enrichment/evidence-payload.ts`; migration 0077 already checks
  `payload ->> 'textSha256'`.
- Docs: an Enrichment section and the new `deleteEdition` in docs/06; the
  queue in docs/01.

## Completion Notes

- Tests: `enrichment-services.test.ts` (database
  `sln462_enrichment_services`, 20 tests) loads the fixture vocabulary and
  covers the loader (a plan writes nothing; an unknown example work stops it,
  a merged one is followed; items created in their family with category and
  parent, an existing one reused by slug; rules off; `--apply` refused
  without a recent backup or an approval link; a version that changes a
  dimension turns its enabled rule off; `--undo` refused while used, then
  complete), proposals (created, merged with two sources, the skip and
  refusal rules, a human proposal only from the export, two concurrent
  proposals as one claim), the actions (accept into a taxonomy link that
  `GET /api/works?theme=` finds with the same total, stale fingerprints,
  single-value replacement and its undo, undo refused after a change, Pablo's
  edit and its undo, the identifier target's refusals, a target without a
  writer, undo reopening only claims that keep evidence), every rule refusal
  and the daily cap, hand edits through `updateWorkTaxonomy`, and the job
  queue (no shared job, rerun, abandoned leases, backoff, holds, filters,
  outcome). `services.test.ts` (14 unit tests): value kinds, skip rules,
  caps, backoff, the target registry and the seed schema on the fixture.
  `book-domain-isolation` refuses `createHumanEnrichmentClaim` on a film.
- Full suite (`scripts/qa/test-local.py`) on 36559803: 2,678 tests in 240
  files passed, none skipped. Main was merged after it (#133, a reading
  timer fix that touches none of these files). `pnpm typecheck`,
  `pnpm lint` (0 errors) and `pnpm deadcode` are clean.
- Live: nothing to run. The v1 vocabulary and its load wait for Joris's
  approval of SLN-461 (PR 3).
