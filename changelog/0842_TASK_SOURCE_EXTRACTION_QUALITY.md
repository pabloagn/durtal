# Task 0842: Validate enrichment source extraction and field coverage

**Status**: In Review
**Created**: 2026-10-16
**Priority**: HIGH
**Type**: Improvement
**Depends On**: SLN-468
**Blocks**: SLN-970

## Overview

SLN-969: HTTP success and nonempty text were insufficient evidence of usable
source extraction. Verification pages, navigation shells and publisher review
blurbs could masquerade as bibliographic records or book descriptions.

## Implementation Details

- Source profiles route exact catalogue records to Open Library JSON or BnF
  SRU through the existing guarded fetcher and registry. The sole alternative
  is an authority lookup after an explicitly empty BnF bibliographic response.
- Publisher extraction isolates primary Book structured data or explicit book
  fields. It excludes review, author biography and recommendation sections.
  Article extraction retains Readability. Short valid records have no arbitrary
  minimum length.
- Evidence quality records present/missing fields, profile revision, primary
  identity and section locators. Storage rejects unusable evidence before any
  object/database write; cache reuse and model extraction recheck content.
- Reports disclose partial coverage, refusals and distinct origins. The
  existing search/fetch budgets, retries, robots rules and retention apply.
- No new dependencies or SQL migration. No catalogue apply, automatic acceptance,
  vocabulary load, paid pilot, full-book export or live change.

## Completion Notes

Type checking and lint pass (81 existing warnings, no errors). The affected
enrichment, evidence, service and network suites pass: 345 tests in 19 files,
zero skipped, using `pnpm test:local` with explicit file filters and disposable
databases. All Python preflight tests pass. Synthetic regressions cover the
observed pilot failure classes without exporting owner data.

The broader unfiltered run was interrupted after a new fixture failed; its
container was removed. The fixture and an optional-metadata hash mismatch
found in the affected rerun were corrected and verified by the passing suite.
This does not claim a completed unfiltered suite or live source reliability.
