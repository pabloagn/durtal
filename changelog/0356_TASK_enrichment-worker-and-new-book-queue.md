# Task 0356: SLN-464 Enrichment worker and new-book queue (PR 1 of 2)

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0351 (SLN-462 PR 2, the services and the job queue)
**Blocks**: 0357 (SLN-464 PR 2, identity), SLN-465, SLN-467

## Overview

Book enrichment 4/13 (epic SLN-460), PR 1: the worker that runs the
enrichment stages by hand on the Mac, and the identity job every new book
queues after its save. The identity stage itself (Open Library and Wikidata)
is PR 2; this PR has the loop, the registry the stages join, and the queue.

## Implementation Details

- `scripts/enrichment/worker.ts` parses flags only; `src/lib/enrichment/worker.ts`
  has `runWorker`, `undoRun`, `enqueueScope` and the read-only probe.
  - Plan (default): a read-only session (`default_transaction_read_only`,
    checked by a probe that changes nothing), the fetch phase into the cache,
    and a report of what an apply would do. Writes nothing.
  - `--apply --backup FILE` (a pg_dump from the last hour): (a0) releases the
    quota, rate-limit and budget holds of its kinds, and a named book's cost
    ceiling with `--only`; (a)-(c) each stage's steps, each in its own
    transaction; (d) its jobs one at a time, each claimed by id (a job
    another worker took, or one queued after the fetch, is not taken),
    written with `finishEnrichmentJob` in its own transaction, or failed
    with the backoff. The worker id carries the run id, so it is unique to
    the run. While a job's write runs, a heartbeat on a second connection
    renews its lease every 5 minutes (`renewEnrichmentJobLease`), so a long
    job is never taken over. A run also works the jobs a stopped run left
    running past their lease, and a write rolls back when another worker
    took its job over. A source refusal (`QuotaStop`) during the fetch writes
    no job: they stay queued with no attempt, and the answers already
    fetched stay in the cache. The report starts with "Stopped after N of M
    jobs".
  - `--undo RUN_ID`: plan by default; with `--apply --backup`, the run's
    applies newest first (`undoApplication`), refusing one that changed
    since with its reason, then each stage's undo hook.
  - `--enqueue KIND --scope owned|on_order|wanted [--only SLUG,…]`: counts,
    or queues with the scope's priority under `--apply --backup`.
- `src/lib/enrichment/stages.ts`: `ENRICHMENT_STAGES` (empty until PR 2
  registers `identity`), the stage contract (fetch, plan, write, steps,
  undo, epilogue), and `stagesFor`, which refuses a kind without a stage. A
  stage that calls out refuses to start without `ENRICHMENT_CONTACT`.
- `src/lib/enrichment/source-cache.ts` (answers by lookup in a JSON file; a
  missing record kept as none; a refusal never kept) and
  `src/lib/enrichment/backup.ts` (`recentBackup`, now shared with the
  vocabulary script).
- `releaseHeldEnrichmentJobs` takes `jobIds`, so a named book's
  `work_cost_ceiling` hold is released only when Pablo names it.
- `src/lib/enrichment/queue.ts`: `queueNewBookEnrichment`, the scope
  priorities (owned 10, on order 20, wanted 30, the rest 100) and
  `BULK_ACCESSION_PRIORITY` (200). Called after the save in `createWork`,
  `createBookFromWizard`, `fastTrackBook`, `createOrderForNewBook`,
  `createEdition` (with an ISBN) and `identifyEdition`. It never throws; a
  failure logs `[enrichment]`.
- `.gitignore`: `enrichment-sources.json`, `enrichment-report.md`.
- A cross-layer test keeps SQL out of `scripts/enrichment/`.
- Docs: the six actions in docs/06; the worker in docs/01.

## Completion Notes

- No stage is registered yet, so a run names a kind and stops with "No
  enrichment stage works identity jobs yet". The second SLN-464 PR registers
  `identity`.
- `src/__tests__/integration/identity-resolution.test.ts` (12 tests) runs the
  worker with a stub stage: plan writes nothing, apply in order (a0) to (d),
  a refusal stops the fetch and writes no job, a failed job is retried, the
  lease heartbeat, a job a crashed run left running, a write whose job
  another worker took over, undo
  is newest first, the contact check, and the queue never failing a save.
- Queue checks were added to the book-saves, fast-track, atomic-book-writes
  and publishers suites. The five touched suites: 90 passed.
- `pnpm typecheck` and `pnpm lint` (0 errors, knip clean) pass.
- `python3 scripts/qa/test-local.py`: 2,690 tests passed in 242 files, none
  skipped.
- No migration.
