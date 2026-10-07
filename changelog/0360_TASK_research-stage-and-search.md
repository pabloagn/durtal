# Task 0360: SLN-469 Research stage and search (PR 1 of 2)

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0355 (SLN-468, the evidence store and cost meter), 0356 and 0357 (SLN-464, the worker)
**Blocks**: 0361 (SLN-469 PR 2, extraction), SLN-467, SLN-470

## Overview

Book enrichment 9/13 (epic SLN-460), PR 1: the research stage of the
enrichment worker. For each queued book it plans queries from the catalogue,
searches through Tavily (main) and Brave Search (fallback), keeps the results
of registry outlets, and stores the best pages through the evidence store
(SLN-468). It writes no claim: PR 2 extracts quoted values from the stored
pages. A new book now queues a research job beside its identity job.

## Implementation Details

- `src/lib/enrichment/research/`:
  - `profile.ts`: the book profile (titles, the original title, authors with
    surnames, translators of owned editions first, the original language),
    from the catalogue only; a book without an author is skipped with its
    reason. The research dimensions: experience dimensions of kind term,
    terms or scale, and facts dimensions of kind term or terms marked
    `research: true`.
  - `config.ts`: the limits and the query table, for Pablo's approval with the
    first plan: 3 base queries, 2 outlet queries, 5 topic queries, 10 results
    each; at most 2 documents per outlet and 10 per book; a ceiling of $1.50 a
    book a month (3 times the $0.50 estimate). The word for "review" in 17
    languages; topic words for the 13 research dimensions of the vocabulary v1
    draft (tone, structure, content_warning, prose, pace, intensity,
    narrative_pull, form, genre, speculative_level, literary_movement, themes,
    setting_period), to check against the seed once it loads.
  - `queries.ts`: the three groups (base; outlets, the original language's
    first; topics, shared by dimensions with the same words), each within its
    limit. A test refuses a fixed word that equals or contains a current term's
    label or key.
  - `search.ts`: the Tavily and Brave adapters over plain HTTPS
    (`fetchWithTimeout`, `serialThrottle`, zod), the enrichment User-Agent,
    every call through `metered`; refusals (`SearchRefusal`) and failures
    (`SearchFailure`); the run's search session: the fallback for the rest of
    the run once the main provider refuses or fails twice, and once for a book
    it leaves with fewer than two candidates; both refusing stop the run. The
    per-book ceiling is checked before each call (`WorkCeilingStop`). Search
    answers are cached by query (URL, title and rank only).
  - `rank.ts`: blocked hosts, unknown and excluded outlets dropped (each
    dropped URL counted once), canonical URLs merged, ordered by outlet weight
    then rank, at most 2 per outlet.
  - `stage.ts`: the stage, registered in `ENRICHMENT_STAGES`. Its plan shows
    the profile, the queries, the documents stored and the cost; its `work`
    searches and stores pages (a fetch refusal takes the next candidate; a
    `snippet_only` outlet is never fetched); its write queues the book's
    `extract` job. The report counts queries per provider, results,
    candidates, documents, refusals by reason, spend, and a per-outlet table.
- The worker: a stage may have `preflight` (an apply refuses research without
  `TAVILY_API_KEY`, and while the main-text extractor waits for its packages)
  and `work` (calls between the claim and the write, outside any transaction).
  A `QuotaStop`, `BudgetStop` or `WorkCeilingStop` there holds the job without
  an attempt; the first two stop the run, and the report starts with "Stopped
  after N of M jobs". `QuotaStop` carries its hold reason. `--enqueue` takes
  the scope `all` (each book at its own scope's priority); a research scope
  skips researched books, and `--only` names one again.
- `queueNewBookEnrichment` queues a research job beside the identity job.
- Prices (`src/lib/enrichment/prices.ts`, read on 7 Oct 2026): Tavily search
  0 per credit (the free plan: 1,000 credits a month, 1 per basic search; $0.008
  a credit pay-as-you-go); Brave search and check $0.005 a request ($5 per
  1,000, with $5 of monthly credit the meter does not count). The meter gains
  `monthSpend` (a book's or all spend this month) and `WorkCeilingStop`.
- Keys: `TAVILY_API_KEY` (needed to apply research), `BRAVE_SEARCH_API_KEY`
  (optional), in `serverSchema`, `.env.example` and docs/13.
- `/settings/integrations`: Tavily (a free `GET /usage` check) and Brave Search
  (one metered search as operation `check`, a warning at the cap), each with
  its role and "Last used" from the cost ledger.
- Snippets stay off: neither provider's terms are recorded as allowing a
  snippet to be stored and passed to a model as copied page text (docs/08).
- No new package. The live research waits for Pablo's yes to the main-text
  extractor's packages, the keys and a cap.
- Docs: docs/00 (the non-goal reworded), docs/01, docs/02, docs/06, docs/08,
  docs/13.

## Completion Notes

RESULTS
