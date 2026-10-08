# Task 0401: The Film Lookup Matches Countries and Languages by ISO Code

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0391 (SLN-376, the Wikidata film lookup)
**Blocks**: None

## Overview

SLN-551, from the review of PR #164. The film lookup matched Wikidata's
countries, original languages and release places to Durtal's lists by their
English name, and Durtal's lists carry ISO names: Wikidata's "United States"
is "United States of America" here, "France" can be "France, French
Republic", "Spanish" is "Spanish; Castilian". Those countries and languages
showed as not in Durtal's lists, could not be filled, and a release in the
United States was saved under a place label instead of the country. The
lookup now reads each one's ISO code from Wikidata and matches by code first,
then by name.

## Implementation Details

- `src/lib/providers/wikidata.ts`: `wikidataPropertyValues(ids, property)`
  reads one property's values on each item with `wbgetclaims` (the
  statements alone, without references), four calls at a time. A country's
  whole claims run to megabytes, so `wbgetentities` is not used for them. An
  item that does not answer has no values; a timeout still stops the lookup.
- `src/lib/providers/wikidata-films.ts`: the detail reads, alongside the
  names, ISO 3166-1 alpha-2 (P297) for the film's countries and release
  places, and ISO 639-1 (P218) for its languages, then ISO 639-3 (P220) for a
  language without a 639-1 code. At most 40 items are read, the film's
  countries and languages first, then its release places; past that a name
  is matched by itself. The payload carries `alpha2`, `iso6391` and
  `iso6393` (null when Wikidata states none), and the proposals carry them
  only when stated, so an answer saved before this change still reads.
  P305 (IETF tag) is not read: its language part is the 639-1 or 639-3 code
  that P218 and P220 state directly, and it may carry a script or a region.
- `src/lib/catalogue/film-sources.ts`: `FilmPlace` and `FilmLanguage`, the
  proposal shapes with their codes.
- `src/lib/actions/film-sources.ts`: `countryMatcher` (alpha-2, else English
  name) and `languageMatcher` (639-1, else 639-3, else English name) replace
  the name-only lookup in the review's countries and languages, its release
  places, and the save. A code wins over a name.
- Tests, against the Wikidata stub only (Wikidata is not reachable from the
  build container and a live call is not allowed):
  - The fixture answers `wbgetclaims`, its countries and languages carry
    codes, and a new film, "Crossing", has a festival, the United States,
    France, the Soviet Union (no code), Spanish and Cantonese (639-3 only).
  - `src/__tests__/catalogue/film-sources.test.ts`: the codes read, one
    property of one item a call, a country that is also a release place
    asked once, the 40-item cap with countries and languages first, and a
    film whose code calls fail keeping its names.
  - `src/__tests__/integration/film-sources.test.ts`: with Durtal's lists
    holding "United States of America", "France, French Republic", "Spanish;
    Castilian" and "Yue Chinese", the review fills countries and languages
    with nothing unmatched, a code wins over a same-named row, the Soviet
    Union still matches by name, and the save stores the countries, the
    languages and the releases' countries. It fails with main's matching.
- `docs/08_EXTERNAL_INTEGRATIONS.md` (film calls) and
  `docs/06_SERVER_ACTIONS.md` (`reviewFilmSource`) say so.

## Completion Notes

Built and checked in a cloud container, on main 4214bb77 (with #164):

- `pnpm typecheck` clean; `pnpm lint` 0 errors, 75 warnings, as on main;
  `pnpm deadcode` clean; `scripts/qa/test-local.py` 3,044 of 3,044 tests in
  274 files, none skipped.
- No live Wikidata call: every test answers from the fixture.
- No page or schema change, so no page weight or layout audit and no
  migration. Not run here: `docker build` (GitHub builds the image on the
  PR).

## Review follow-up (8 October 2026)

Merged current main into the PR without rewriting history. Review found that
ISO-property lookups swallowed HTTP 429 and individual request timeouts, then
continued the queue. They now stop scheduling requests and preserve the
provider's rate-limit/timeout error; ordinary unavailable optional codes still
fall back to names. Two regressions fail before the correction. Final validation
results are recorded on the PR and Linear issue.
