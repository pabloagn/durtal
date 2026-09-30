# Task 0163: Fragrances, formulations and personal perfume containers

**Status**: Completed
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-347, SLN-349, SLN-350, SLN-352, SLN-354, SLN-355
**Blocks**: SLN-357

## Overview

SLN-356 adds the typed perfume model in migration 0040. Fragrance identity,
formulation/concentration and personally held bottles/samples/decants are separate.

## Implementation Details

- Nine normalized tables cover the profile, variants, house/brand/manufacturer
  roles, positioned work/variant notes, family overrides/classification,
  formulation perfumers and containers. Existing shared people and taxonomy
  identities are reused. Unknown formulation, attribution and quantity need no
  fabricated record. Exact duplicate variants are rejected.
- Source links belong to the same perfume; release/discontinuation periods use
  immutable uncertain date values. Definitely reversed intervals are rejected.
- Notes retain top/heart/base/unspecified position and order. Variant families and
  perfumers explicitly inherit or replace work values, including empty replacements.
  Used scopes and vocabulary remain protected. Person/organization merges retain
  the new references and stable credit identities.
- Containers retain capacity/unit with generated ml, bounded optional remaining
  ml, batch/condition, physical storage, supplier/venue, paired price/currency and
  acquisition/disposition dates. Liter samples preserve 0.001 ml precision. Read
  projections connect real containers to the shared holdings contract.
- Storage cannot become digital while holding perfume; sublocations must belong
  to the chosen location. Used retailer/house roles and venues are protected.
  Work/variant deletion cannot implicitly erase containers.
- Non-book roots explicitly leave the legacy original-language field null; books
  retain their default and non-null requirement. Existing book detail APIs narrow
  this invariant without modifying the user's UI changes.

## Completion Notes

- Full local regression: **65 files, 817 tests passed, zero skipped**, plus
  **5 Python ingestion checks**, using 29 isolated databases removed afterward.
  Reports: `/private/tmp/durtal-perfume-full`.
- Model tests cover unknown/multiple/dated formulations, note/perfumer inheritance,
  empty overrides, credit merges, sample conversion, quantity bounds, disposal,
  supplier/storage protection, wrong-domain links, source ownership and rollback.
- Typecheck, changed-production-source lint and Drizzle drift checks pass. The
  populated upgrade preserves all historical book rows and original languages.
- CRUD/filtering services remain SLN-357, retailer observations SLN-351, screens
  SLN-366 and typed acquisition order links SLN-374. Perfumes remain gated.
