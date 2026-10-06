# Task 0352: Length, part 1: the page rule and prose metrics

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: SLN-466 PR 2, SLN-471, SLN-472

## Overview

SLN-466, PR 1 of 2 (book enrichment 6/13). One written rule says which
editions count for a work's pages, and every page reader builds on it. The
prose metrics exist as pure functions, tested on synthetic text. A read-only
plan reports the owned works without pages, the implausible counts, the
owned editions whose counts differ, and the replay check (Kaputt, 400 to 600
pages, available in Amsterdam). No migration, nothing reads an e-book file,
and nothing writes `page_count`.

## Implementation Details

- The rule: `docs/02_DATA_MODEL.md`, "Pages of a Work", next to "Derived
  Ownership". It builds on `ownedBookCondition`. Counted editions: the owned
  editions of an owned work; at a location, the editions with an available
  copy there; for a work not owned, all its editions (`any_edition`). A
  usable count is from `MIN_PAGES` to `MAX_PAGES`. Unknown pages never fall
  back to an edition that is not owned.
- `src/lib/enrichment/pages.ts`: one building block (`countedEdition`) under
  `pageRangeCondition`, `pagesUnknownCondition` and `getWorkPages`.
  `getWorkPages` takes the database handle, so the plan reads through its
  read-only session.
- `src/lib/enrichment/prose-metrics.ts`: sentences and words from
  `Intl.Segmenter` after NFC; a paragraph break ends a sentence; mean and
  median sentence length; rare-word share against a given frequency list and
  cut-off N, with the name rule (off for German) and the reasons
  `language_unknown` and `no_list`; MATTR over a 500-token window. No
  frequency list is checked in: SLN-461 approves them first.
- `src/lib/enrichment/read-only-session.ts`: the session that refuses
  writes, and the probe that proves it (25006) before the plan runs.
- `src/lib/enrichment/length-report.ts` and `scripts/enrichment/length.ts`
  (plan only, `--report`, default `tmp/length-report.md`, and `--env-dir`).
  The CLI holds no SQL.
- `PAGE_TOLERANCE` is exported from `src/lib/books/enrichment.ts`; the report
  imports it with `MIN_PAGES` and `MAX_PAGES`.
- Tests: `src/__tests__/enrichment/prose-metrics.test.ts` (9 cases, values
  worked out by hand) and `src/__tests__/integration/length.test.ts`
  (`DURTAL_LENGTH_TEST_DATABASE_URL`, `/sln466_length`, 9 cases: every PR 1
  case of the issue, and the read-only probe).

## Completion Notes

- The plan ran on a disposable copy of the newest backup
  (`live-before-0075-0076-20261006-201324.dump`): 212 owned works, 182 with
  pages and 30 without (baseline 2026-10-04: 145 of 153); 1 count outside 16
  to 3000 (an edition that is not owned); 1 owned work whose editions differ
  by more than 5%; Kaputt has 448 pages on the Amsterdam copy's edition and
  the 400 to 600 condition matches it.
- Three "copy at a location" rules now exist, and they differ on purpose: the
  library's location filter (any copy that is not deaccessioned), the copy at
  hand (`atHandCopySql`: available, at the home or any digital location) and
  this rule (available, at that location).
- PR 2 waits for the reader module: `ebook_text_metrics`, `--apply`,
  `--undo`, `--cache`, `--limit`, `--only`, the e-book report sections and
  `getEbookTextMetrics`.

## Review fixes (PR #134)

- `proseMetrics` returns null for a text with no word made of letters (empty,
  numbers only, a scene break), so no metric is NaN. A text whose every word
  is capitalised gets `rareWordShare` null with `rareWordSkip` "names_only".
  Two tests cover both; the three that read a field use optional chaining.
- `atLocation` takes an SQL work id.
- Words follow the vocabulary's rule: a run of letters and accent marks, with
  apostrophes (' and ’) and hyphens kept inside it, so don't, l'homme, qu'il
  and well-known each count as one word, and a number is not a word. Sentences
  still come from `Intl.Segmenter`. Tests: a French sentence (apostrophe words
  in the rare-word share and MATTR), a hyphen, and Hindi words with marks.
  The frequency lookup of the part after an apostrophe waits for PR 2.
