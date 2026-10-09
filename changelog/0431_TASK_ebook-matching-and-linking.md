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

A further independent review of `ae3f69d6` found that a title-only proposal
could still fill a free copy of another numbered volume. Nine new route cases
reproduced unsafe eligibility before this correction. Edition effects now check
the selected destination, any placeholder copy being moved, and unresolved
catalogue volume evidence for every choice route. Mixed-volume works require
review unless a unique identified edition resolves the volume; contradictory
moved copies still block that operation. Number evidence includes subtitles.
Two additional subtitle regressions reproduced unsafe eligibility before that
normalization fix. Volume ambiguities also become candidate vetoes before tier
selection, so these cases cannot receive an automatic tier. Compatible or
absent numbering remains eligible where catalogue evidence is not contradictory.
Both reviewed checkpoints remain in history. The current focused run passed
98 tests in three files with zero skips (367 ms total); typecheck and ESLint
are clean.

No database suite, SQL trigram parity, calibration/precision measurement,
6,000-by-700 performance benchmark, schema generation, native build, deployment,
live catalogue read or write, cloud operation or reader/browser acceptance has
run for this checkpoint. This task is not complete.

Root independently approved pure source `02f27672`, then authorized effectful
source development against the normally merged, source-approved SLN-494
prerequisite `0b6b706b`. Merge checkpoint `f0d17064` preserves both histories.
Migration generation/apply, heavy checks and live operations remain gated.

The first declaration/loader checkpoint adds the proposed candidate table,
five ebook columns and nullable finite 0–1 persisted probability check. Exact
manual SQL lives outside the migrator under `migration-proposals/0082...`.
Independent declaration review required parent-side candidate invalidation and
persisted probability reconciliation. The amended SQL locks candidate parents
FOR SHARE, invalidates on reparent/deletion, clears obsolete duplicate tiers,
and refuses existing invalid probabilities until explicitly reconciled.
The disposable database suite includes both concurrent reparent orderings and
deletion checks; it is authored but has not run and requires generated 0082.

The new explicit-connection loader reads one query per table, retains raw state
for stale guards, validates file/cover provenance and active digital locations,
and keeps exclusion reason outside the bibliographic fingerprint. The focused
matcher/loader/validation run passed 115 tests in five files with zero skips.
Shared writers, operation-owned undo, classification-only restore, calibration
gates and registration/resume integration are still being implemented.
