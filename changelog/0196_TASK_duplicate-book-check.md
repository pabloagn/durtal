# Task 0196: Duplicate book check ignores accents and name forms (SLN-287)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0119, 0154
**Blocks**: None

## Overview
The add-book wizard's duplicate check (`findDuplicateWork`) compared titles with `ilike`, so "Agua Viva" did not find "Água Viva", and authors with a raw substring test, so "Stanislaw Lem" did not find "Stanisław Lem". Live data shows the result: Solaris (Lem) and Roadside Picnic (Strugatsky) each exist twice.

## Implementation Details
- `src/lib/actions/works.ts` `findDuplicateWork`: titles match on `search_normalize` (accents, case and punctuation ignored). An author matches when every word of one name is in the other, after the same normalization: "Lem", "Stanislaw Lem" and "Stanisław Lem" match; so do "Arkady Strugatsky" and "Arkady and Boris Strugatsky". A different author with the same title is still not a duplicate.
- The five author pairs and the two work pairs of the ticket are already gone from live (merged earlier, Harmonize task 0154). Two new pairs remain for the owner to merge in Harmonize: Solaris (slugs `solaris-by-stanislaw-lem`, `solaris-by-stanislaw-lem-2`) and Roadside Picnic (`roadside-picnic-by-arkady-strugatsky`, `roadside-picnic-by-arkady-and-boris-strugatsky`). The two "The Tunnel" works are different books (Sabato, Gass).

## Completion Notes
- Test: 1 PostgreSQL test in `publishers.test.ts` (accents, case, partial and accented author names, a combined author name, and a different author). With `book-domain-isolation.test.ts`: 58 passed.
