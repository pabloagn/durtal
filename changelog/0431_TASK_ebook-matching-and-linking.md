# Task 0431: eBook matching and linking

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-494, SLN-569
**Blocks**: SLN-496, SLN-497, SLN-505

## Overview

Match local eBook metadata to book works, explain review proposals and plan
reversible digital-copy links and accession. Automatic eligibility favours
precision; the labelled live calibration and approved apply remain separate.

## Implementation Details

The bounded first checkpoint contains pure modules only in
`src/lib/ebooks/match/`: immutable snapshot contracts and indexes; validated
ISBN and namespaced external-id keys; multilingual title/author keys; strict
whole-word trigram extents; versioned scores and review tiers; typed edition,
copy and accession effects; deterministic duplicate proposals; and conservative
batch author clustering. No module imports the database or writes storage.

Identifier conflicts, flags, volume/series/year vetoes, locked editions,
ambiguous copies, unknown language and unavailable verified files prevent
automatic effects. Existing edition metadata and work lifecycle stay untouched.
Effects expose missing choices and are not executable write plans. Copied cover
provenance comes only from a loader-validated file publication. An ISBN-10 is
converted to its full valid ISBN-13, rather than the publisher helper's 12-digit
ISBN-10 prefix. Equivalent identifiers do not multiply identity evidence.

Full integration is gated on SLN-494's transaction-bound read-only planning
wrapper. Every helper must receive that protected connection, without global
fallback. Committed links and undo entries must share an operation id bound to
database, run and plan hash; undo checks identity and dependencies in its write
transaction and preserves later operations.

Migration `0082_ebook_matching` is reserved, not generated. It will add candidate
rows, the four match columns and constrained `exclusion_reason`, with the reason
present exactly when excluded. Exclusion reason is guarded decision state, not
part of the bibliographic match fingerprint. The downstream library consumes
this field instead of inferring a reason from the tier.

## Completion Notes

The original pure checkpoint's focused run passed 71 tests in three files with
zero skips (357 ms total). TypeScript compilation and ESLint were clean. The
first focused run found one fixture lookup incorrectly relying on catalogue
ordering; it was corrected to select the work by id. Omnibus, conflicting
identifier-owner and empty-catalogue regressions are included.

Independent review rejected checkpoint `277ac5bd` for two unsafe automatic
matches: a single known identifier owner could contradict the proposed work,
and an unnumbered work title could hide its identified edition's volume number
when their cleaned title scores tied. That commit remains in history. Six new
adversarial cases reproduced both defects before the corrections, including
Google IDs and ISBNs with an available digital copy. Scoring now treats any
different identifier owner as a conflict and checks identified edition volume
evidence independently of the best title key. Matching volume controls remain
eligible. The corrected focused run passed all 77 tests in three files with
zero skips (351 ms total); TypeScript compilation and ESLint are clean.

No database suite, SQL trigram parity, calibration/precision measurement,
6,000-by-700 performance benchmark, schema generation, native build, deployment,
live catalogue read or write, cloud operation or reader/browser acceptance has
run for this checkpoint. This task is not complete.
