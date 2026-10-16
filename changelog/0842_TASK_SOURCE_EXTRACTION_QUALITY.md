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

Type checking and lint pass (existing warnings, no errors). The latest affected
enrichment, evidence, service and network suites pass: 347 tests in 19 files,
zero skipped, using the repository's disposable-database harness. The standard
345-test run previously passed every Python preflight; a repeated, unchanged
FIFO preflight later stalled, so the latest focused run reused that historical
Python result. Unfiltered CI at the final head remains a merge gate.

Source review fixes resolve recorded Open Library Work/Edition author-reference
shapes via at most four guarded author lookups, preserving name/key/hash
lineage. BnF identity is checked on the returned record, never an echoed query.
Regressions include wrong author records, bounded lookups and an adversarial
SRU echo. No owner data was exported.

The broader unfiltered run was interrupted after a new fixture failed; its
container was removed. The fixture and an optional-metadata hash mismatch
found in the affected rerun were corrected and verified by the passing suite.
This does not claim a completed unfiltered suite or live source reliability.
