# Task 0361: SLN-469 Extract stage and model (PR 2 of 2)

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0360 (SLN-469 PR 1, the research stage), 0355 (SLN-468, the evidence store and cost meter)
**Blocks**: SLN-467, SLN-470, SLN-471

## Overview

Book enrichment 9/13 (epic SLN-460), PR 2: the extract stage of the
enrichment worker. For each book it reads the documents the research stage
stored, sends their passages to the extraction model (`claude-opus-5-5`), and
checks every returned value in code: a current term (R4), an exact quote of
the passage (R3), two independent sources where the dimension asks for them
(R6). A value that passes becomes an `agent` claim with its quote as evidence;
nothing is applied. Every request is recorded, so a document is never sent
twice with one request.

## Implementation Details

- `src/lib/enrichment/research/`:
  - `text.ts`: the relevance gate (a title and an author's surname, each as
    whole words, after NFC and `toLowerCase()`) and the passages (the whole
    text up to 12,000 code points, else 1,500-code-point windows around each
    match, merged, cut at the total). Every offset counts code points.
  - `request.ts`: the request (instructions and vocabulary first in one system
    block with `cache_control`, then the book and the passages; a JSON schema
    of the current terms through `z.toJSONSchema`; `effort` `low`; no
    temperature, thinking, tools or prefill; never a term's example books),
    its SHA-256, `PROMPT_VERSION` and `EXTRACTOR_VERSION`.
  - `model.ts`: the adapter over `@anthropic-ai/sdk` 0.131.0 (no retries; the
    enrichment User-Agent; `countTokens` with the output format). 401, 403
    and 429 stop the run unbilled; another error fails the job.
  - `verify.ts`: the checks of one value, in order: `unknown_term`,
    `no_excerpt`, `not_in_passage`, `excerpt_too_short` (under 20 code
    points), `excerpt_too_long` (over 400). The excerpt is put in NFC and
    nothing else; its offsets slice it back out of the stored text.
  - `independence.ts`: `checkIndependence`, the only R6 counter: documents of
    one outlet, syndication group, byline, near-duplicate text or quote are
    one source, transitively; publisher and translator pages and human
    evidence never count toward the two.
  - `conflicts.ts`, `confidence.ts`: conflicts (two values of a one-value
    dimension, exclusive terms, scale points two apart, another method's
    value) never drop a value, they cap its confidence at 0.3 and name the
    other value in the note; confidence is 1 − Π(1 − 0.5 w) over independent
    sources.
  - `documents.ts`: the stored documents of a book; `countReviewsFound` for
    SLN-467 (null until research and extract are done).
  - `extract-stage.ts`: the stage. Plan: the documents, the dimensions and an
    estimate, with no call. Work: per document, the gate, the passages, the
    request; a request already recorded is skipped; each call is metered at
    its free token count plus the output cap, after the book's ceiling check,
    and its answer kept in the run's cache by request hash (the request with
    each asked dimension's revision: the last version that changed it). A
    storage error fails the job; a text whose hash does not match skips its
    document. Write: the open claims of an asked dimension older than its
    revision close (`vocabulary_changed`); then the extraction rows; then per
    value its evidence with the earlier evidence of its open and R6-rejected
    claims, R6, the conflicts, the confidence and `proposeClaims`. Each
    evidence row keeps the run that verified it. Step: the vocabulary sweep
    queues each book for the research dimensions it was never extracted for
    or whose revision is newer than its latest extraction, and closes the
    open claims of retired research dimensions; the next run works them.
    Undo: the run's extractions get an undo time, open claims with its
    evidence are withdrawn (`run_undone`), and their evidence from other runs
    is proposed again, except for a retired dimension or term. A gold-set
    book's values stay out of the report, the job outcome and its errors:
    counts only.
  - `research/stage.ts`: a finished research job queues the extract job with
    every research dimension by name, so it folds an open vocabulary job into
    a full extraction.
  - `claims.ts`: a text evidence input may carry its own run id.
- `src/lib/enrichment/gold-set.ts`: the 20 books Pablo named on 4 Oct, by work
  id, and the condition that hides them.
- Migration `0079_enrichment_extractions`: the `enrichment_extractions`
  table (docs/02), with the book-parent trigger and an append-only guard.
- `src/lib/enrichment/prices.ts`: the `anthropic` `extract` row ($4 input,
  $20 output, $0.20 cache read, $5 cache write per million tokens, read on
  7 Oct 2026 at https://www.anthropic.com/pricing).
- `ANTHROPIC_API_KEY` (optional; extraction refuses to apply without it), the
  Settings integration check (`models.retrieve`, free), and the worker's
  `--determinism-check N`.
- `src/lib/settings/integrations.ts`: the Brave Search check settles only an
  answered search (a refusal or no answer releases its reservation), makes no
  call when no cap is set, and no longer counts as a use in "Last used". The
  research and extract plans print the cap, this month's spend and what is
  left.
- Docs 01, 02, 06, 08 and 13.

## Completion Notes

- Tests: `src/__tests__/enrichment/extract.test.ts` (32: the relevance gate
  and passages in code points, the request without examples or sampling
  settings, the hash, the answer schema, R3 and R4 with curly quotes, spaces,
  case, ellipses, NFD and astral offsets, R6 merges, conflicts, confidence)
  and the database suite `extract-agent.test.ts` (24, database
  `sln469_extract_agent`): a plan makes no call or write; an apply without
  the key refuses; claims and R6 rejections with text evidence that passes
  the guards; metered calls; syndication counted once and a later source
  proposing again with all evidence and its own run ids; publisher pages and
  conflicts; not-about documents; invalid answers; budget and ceiling holds;
  storage errors and hash mismatches; no second payment from the cache; no
  catalogue change; undo; the vocabulary sweep, a new dimension and a retired
  one; gold-set hiding; `countReviewsFound`; the determinism check; the Brave
  check's billing; the table's append-only guard. `research-agent.test.ts`
  now expects the extract job with every research dimension by name.
- A fresh review of the stage found six defects before the PR opened (storage
  errors read as hash mismatches; the sweep re-queueing or missing books;
  copied evidence taking the proposing run's id; undo throwing on a retired
  term; a job merge keeping the open job's reason). Each is fixed with a test.
- The migration is `0079`, generated on `main` 65e532d9; SLN-518 takes the
  next number.
- `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm deadcode` and `pnpm test`
  (1,992 passed; the database suites skipped there) are clean.
  `python3 scripts/qa/test-local.py`: 2,890 tests passed in 256 files, none
  skipped.
- Not done here: any live run. The extractor of the evidence store still
  refuses until its packages land, so research stores no page yet.
