# Task 0355: Book enrichment 8/13: evidence store, outlet registry and cost meter

**Status**: In Progress
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0350, 0351 (SLN-462)
**Blocks**: SLN-469, SLN-465 PR 2, SLN-473

## Overview

SLN-468. The research agent (SLN-469) needs a place to keep the pages it
quotes, a list of outlets it may use, and a meter that stops paid calls at a
monthly cap. This adds all three. Nothing here calls a paid service, applies
the outlet seed or fetches a live page: those steps wait for Pablo's yes.

## Implementation Details

- **Page fetcher** (`src/lib/net/safe-fetch-page.ts`): shares the guarded
  loop of `safeFetchImage` (`guardedFetch` in `src/lib/net/safe-fetch.ts`,
  whose tests pass unchanged). HTTPS, HTML or plain text, 5 MB, 30 s of
  network time, 5 redirects; every hop checks blocked hosts (Goodreads,
  StoryGraph), the registry and robots.txt. One request per host at a time,
  5 s apart or the crawl delay; typed refusal reasons.
- **robots.txt** (`src/lib/net/robots.ts`): RFC 9309 in our code, cached 24
  hours per host.
- **Store** (`src/lib/enrichment/evidence-store.ts`): the raw page gzipped and
  the main text in NFC under `bronze/evidence/<sha256>`, one
  `source_records` row per document and owner, reuse without a fetch, a
  refresh chain, snippets, hash-checked reads, `--undo` of uncited rows. The
  payload schema is `src/lib/enrichment/evidence-payload.ts`.
- **Outlets** (`evidence_outlets`, `src/lib/enrichment/outlets.ts`,
  `outlets-seed.ts`, `outlet-registry.ts`): seed version 1 holds the nine
  outlets SLN-460 names, press in French, German, Russian, Portuguese and
  Spanish, and three academic platforms, with terms and robots.txt checked
  on 7 Oct.
- **Fingerprint** (`src/lib/enrichment/fingerprint.ts`): MinHash of 128
  values over word 5-shingles, threshold 0.5.
- **Meter** (`enrichment_costs`, `src/lib/enrichment/meter.ts`,
  `prices.ts`): reserve under an advisory lock within the monthly cap and the
  run limit, settle with the provider's counts and add to the job, release an
  unbilled call; `BudgetStop`. The month follows `APP_TIMEZONE`.
- **Migration 0078**: both tables, their guards (domain, append-only ledger,
  `book_parent_required`), evidence indexes on `source_records`, and an index
  on `enrichment_jobs (work_id)`.
- **Settings**: Integrations gains the evidence fetcher and the budget, Data
  an Enrichment group.
- **S3 housekeeping**: `keysInUse` counts payload keys; the orphan report and
  `--purge` scan `bronze/evidence/`; no owned folder covers it.
- **CLI** `scripts/enrichment/evidence.ts`: `--outlets`, `--propose-outlets`,
  `--fetch`, `--undo`, `--costs`, `--purge`.
- `ENRICHMENT_CONTACT` and `ENRICHMENT_MONTHLY_CAP_USD` in `serverSchema`,
  `.env.example` and docs/13. The work relation dialog's source picker lists
  manual citations first.

## Completion Notes

- `scripts/qa/test-local.py`: 244 files, 2,727 tests, all passed, with the
  Python tests. New: `evidence-store.test.ts` (`/sln468_evidence_store`),
  `safe-fetch-page.test.ts` (13 cases on local servers), `robots.test.ts`,
  `enrichment/evidence.test.ts`; cases added to the S3 keys, cleanup,
  hardening, S3 cleanup, work-kind migration and book-domain suites.
  `safe-fetch.test.ts` passes unchanged.
- The database suites found three bugs, fixed: a Harmonize merge had no
  strategy for `enrichment_costs.work_id`; the undo's cited check read an
  unqualified column (drizzle leaves columns unqualified in a select list) and
  deleted cited rows; the source picker sorted null before true.
- Settings, Integrations and Data on a production build: alignment and design
  audits with 0 findings in headless Chrome, WebKit and Firefox at 1440, 768
  and 390; the phone and interaction audits pass; every measured route is
  within its page budget (`/organizations/*` has no record in an empty
  preview).
- `--propose-outlets` on a disposable copy of the newest backup: 35
  publishers with a website, no translator with a website, and original
  languages en 207, es 3, fr 1, ru 1 (not reliable). Robots.txt of each seed
  outlet read once with the DurtalBot User-Agent; terms read where found.
- Waits for Pablo: the extractor's packages, the outlet list and weights, the
  publishers to add, the retention, and the live steps (migration, seed
  apply, smoke test).
