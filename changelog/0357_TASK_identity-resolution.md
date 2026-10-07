# Task 0357: SLN-464 Identity resolution (PR 2 of 2)

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0356 (SLN-464 PR 1, the worker), 0351 (SLN-462 services)
**Blocks**: SLN-465, SLN-467

## Overview

Book enrichment 4/13 (epic SLN-460), PR 2: the identity stage of the
enrichment worker. It links each book to its Open Library work, its Wikidata
item, its OCLC work ID and each edition's LCCN, as claims with the stored
answers as evidence. Exact matches are applied by the exact-match rules Pablo
turns on, under the daily cap; everything else waits for his review file.

## Implementation Details

- Dimensions (vocabulary v1, as the coordinator decided): `wikidata_qid`,
  `open_library_work`, `oclc_work` (from P5331 only) and `lccn` (edition,
  target `edition.lccn`). The worker refuses to run identity while the current
  vocabulary lacks one of them. Tests load them from
  `src/__tests__/fixtures/enrichment/identity/dimensions.json` (providers
  `wikidata`, `open_library`, `oclc`, `lccn`); the live run waits for the v1
  seed (SLN-462 PR 3), which must use these keys and providers.
- `src/lib/enrichment/identity.ts`: the pure rules (`planIdentity`), ID
  patterns, LCCN normalisation, the edition-item test and
  `IDENTITY_RULES_VERSION`. Order: the Open Library edition by ISBN-13 (an
  ISBN-10 converted first), its work; the Wikidata items whose P648 is that
  work, plus the work's own `identifiers.wikidata` link, exact when they agree;
  the title search by author QID only when no item came through Open Library,
  always for review (0.4). An ISBN listed anywhere in either ISBN list of the
  record matches. Derived IDs (the OCLC work ID; the Open Library work from
  P648 when no ISBN named one) come only from an exact or accepted QID.
- `src/lib/enrichment/identity-sources.ts`: the Open Library client (identity
  has no provider in `src/lib/providers/`, and `src/lib/api/open-library.ts`
  reads a 429 as "not found"), the reverse P648 query (one per 50 works),
  item reads (50 per call) and the title search, all into the run's cache.
  The fetch goes book by book through Open Library, so a 429 reports the books
  done ("Stopped after N of M jobs").
- `src/lib/enrichment/identity-stage.ts`, registered in `ENRICHMENT_STAGES`:
  the job write (source records, proposals, rule applies with the run id as
  their batch, a QID or Open Library work another book took in the same run
  held too), the steps (review file, sweep, re-queue), the undo hook
  (withdraws the run's never-applied proposals, `run_undone`), the summary of
  what each path found (the reverse-P648 yield) and the report's last
  sections (exact claims waiting for the rule, undone values waiting for
  Pablo, books for review with ready entries, unresolved books).
- `src/lib/enrichment/identity-review.ts`: `IDENTITY_REVIEW` (empty) and its
  schema. `src/lib/enrichment/identity-rules.ts`: `--enable-identity-rules`
  (needs `--approval`, minimum confidence 1, never a gated rule) and
  `--disable-identity-rules` (writes at once).
- `src/lib/enrichment/targets.ts`: the `edition.lccn` writer (identifier with
  its refusals, the column only while empty, a locked edition refused, undo
  only where the apply filled the column).
- `src/lib/enrichment/claims.ts`: a rule apply carries a batch (the run id);
  Pablo's own claim may cite a confirming source; `rejectClaim`, which
  `rejectEnrichmentClaims` now uses.
- User-Agent: `src/lib/enrichment/user-agent.ts` and `ENRICHMENT_CONTACT` come
  from SLN-468's first commit (aecdf800, merged, not copied).
  `src/lib/wikidata/api.ts` and `scripts/books/enrich.ts` now send it, read at
  each call.
- The worker: the plan counts the holds (a0) would release, and the undo plan
  lists each apply.
- No loc.gov calls (403 to every request on 6 Oct): no client, provider,
  settings row or request-limit line; docs/08 says why.
- Not here: SLN-468's `BudgetStop`. Identity makes no metered call, so the
  worker still stops only on `QuotaStop`; the first stage that meters a call
  maps `BudgetStop` to a `budget` hold in the worker's fetch.
- Docs: docs/02 (Identity), docs/06 (services), docs/08 (Open Library records,
  Wikidata lookups, no loc.gov), docs/01 (the worker).

## Completion Notes

RESULTS
