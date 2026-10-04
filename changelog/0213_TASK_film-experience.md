# Task 0213: Film Home, Detail, Cast and Crew, and Version Editing (SLN-367)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0202 (SLN-366), SLN-358 (film model and services), SLN-361 (domain media), SLN-353 (taxonomy), 0188 (SLN-364)
**Blocks**: SLN-379, SLN-380, SLN-381

## Overview
Films get their own screens on top of the SLN-358 services: a poster-led home
with director, cast, year, genre and language filters; a detail page that
combines the poster and a widescreen still with the synopsis, cast and crew,
versions, releases and copies; and every editing workflow.

Controller stopped this task at a safe point on 2026-10-03 and handed it over
(branch `codex/sln-367-films`, WIP commit `10e4f87`). This thread rebased it
onto `main` (`c9f6359`) on branch `claude/project-thread-7txq80` and finished
it. Films open with this task.

## Implementation Details

**From the handover (Controller, commit `10e4f87`, rebased as `fa483e0`)**
- Shared record parts moved from `src/components/perfumes/` to
  `src/components/catalogue/`: `search-picker.tsx`, `confirm-delete-dialog.tsx`,
  `record-fields.tsx`, `curation.tsx`, `sources-section.tsx`,
  `holding-fields.tsx`. Holding status labels in `holdings.ts`,
  `organizationRoleQueries` in `work-store.ts`, `isWorkSlugClash` in `slugs.ts`.
- Film services (`src/lib/actions/films.ts`, `film-store.ts`,
  `validations/films.ts`): director and cast filters, readable slugs
  (`{title}-by-{director}`), the organization role written with each link,
  card tone, `getFilmFilterOptions`, `getRelatedFilms`, `findFilmsByTitle`,
  `getFilmChoices`.

**Home** (`src/app/films/page.tsx`): title, Add film, the collection switch,
search (titles and original titles), sorts (title, release, runtime, added,
rating), grid and list views, paging, and empty, no-results, loading and error
states.
- Filters (`film-filters.tsx`) live in the URL: director, cast, genre,
  language, country, holding, medium, favourite, from, to.
  `filmQueryFromParams` (`src/lib/catalogue/film-params.ts`) drops unknown or
  malformed values, swaps reversed years, treats "owned" plus "not owned" as no
  filter, and drops copy kinds with "not owned". The collection switch keeps
  them (`domain-switch.ts`).
- `FilmCard`: the poster in a 2:3 frame, cropped as framed, over its tone, or a
  title card (`TitleCard`, appended to `no-photo.tsx`); title on two fixed
  lines, directors, "1982 · 1h 49m · US"; chips for a favourite and the copies
  held. `FilmRow` is the list form.

**Detail** (`src/app/films/[slug]/page.tsx`, `loading.tsx`, `not-found.tsx`):
the active still behind the header, as on a book page; the poster or title card;
the title with the favourite toggle and action menu (`CapAlignedControls`); the
original title; directed by and starring (links to `/films?director=` and
`/films?cast=`), written by, released, runtime (per version when they differ),
the copies held and the rating.
- `DetailColumns`. Reading column: synopsis, Cast (characters and credited
  names; the first twelve, then "Show all"), Crew by role, Versions (runtime,
  notes, releases with territory, format, date and distributor; move up and
  down), Copies, Sources, Your notes. Record column: Details (original title,
  first release, countries, languages, production, added), Genres (edited in
  place; `TaxonomyAssignments` gained `labelled={false}`), Media counts.
- Full width: gallery, then related films ("More by {director}", "Shared
  cast", "Shared genres").
- Sources sit in the reading column, not the record column the handover
  named: the section has its own heading, list and add dialog, like the
  perfume page.

**Editing** (`src/components/films/`):
- `FilmForm` (`/films/new` and the edit dialog): title, original title, cast
  and crew, first release (any precision) and its source, countries,
  languages, production companies, genres, synopsis.
- `CreditsEditor`: three groups (direction and writing, cast, crew); each
  credit has its role, a credited name, characters for cast ("Blair /
  Blair-Thing"), move up and down, remove; "Unknown" adds a nameless credit.
  `creditInput` (`film-labels.ts`) records a credit with no person and no name
  as unknown.
- The same-title prompt: on create, films already named the same (title or
  original title, ignoring case and accents) are listed. A remake goes on as
  a new film; "Add a version to it" opens that film with `?add=version`.
  Explicit remake and adaptation links stay SLN-363.
- `VersionDialog` (name, runtime as "109", "1h 49m" or "1:49:30", notes,
  source, releases with format, territory, country, distributor, date and
  notes); `CopyDialog` (physical or digital, format, version and release,
  status, condition, storage of the matching kind, acquisition, disposal,
  notes); deletes list their blockers.

**Opening films**: `WORK_DOMAINS.film.enabled` is true and
`works_kind_enabled_check` allows `book`, `perfume` and `film` (migration
`0054_film_kind_enabled`, generated by drizzle-kit on top of
`0053_open_perfumes` from SLN-382 when that merged first; no hand edits).
Paintings follow as `0055_open_paintings`, so the check then lists every open
kind.

**Shared changes**: `src/lib/catalogue/source-views.ts` (`sourceViews`,
`sourceChoices`) replaces the perfume page's own copy; `film-labels.ts`
(runtimes, credit headings, release territory, copies text, credit input).

**Not done here**
- The unused film and perfume sorts in `domain-home-shell.tsx` stay until the
  painting home replaces `DomainHome` (the painting session is on it).
- Taxonomy item pages still count book links only, while the family list now
  counts every open collection (`book-domain-isolation.test.ts`).

## Completion Notes
- Checks: `pnpm typecheck` and `pnpm lint` are clean. The first full run of
  `scripts/qa/test-local.py` passed 1500 of 1503 tests; the 3 failures assumed
  films were closed (taxonomy family lists and counts) and were updated. New:
  `film-home.test.ts` (URL params, runtimes, labels, credit input) and six film
  service tests (slugs, roles, director and cast filters, filter options,
  related films, title matches). Final run: 1503 of 1503 across 109 files, none skipped, plus the Python book import checks.
- Browser, on `scripts/qa/preview-local.py` with nine seeded films, measured
  in headless Chrome with its own profile:
  - Created "The Thing from Another World" through the form: two directors
    (one with a credited name), two cast members with characters, a reorder,
    country, language, a new production company and a genre. Then a version
    with a release (country, format), a second version, reordering, two
    copies (one of a version), an edit of the original title, a rating and a
    favourite; each was saved and reloaded.
  - The same-title prompt lists The Thing for "the thing"; `?add=version`
    opens Add version; director and cast links open the filtered home; the
    filter menu's genre choice takes in the narrower genre; deleting a film
    with a copy is blocked with its reason.
- Audits (`alignment-audit.js`, `design-audit.js`): the home (grid, list,
  filtered, filter menu, no results), five detail pages (full, cast opened,
  sparse, two directors, three characters, digital copy, `?add=version`),
  not found, the create page and its prompt at 1440, 768 and 390px; eight
  dialogs (edit film, add and edit version, add and edit copy, delete film,
  delete version, add source) at 1440 and 390px. Two findings were fixed: the
  release Remove button sat 2.28px off its label's cap-height center, and the
  no-results action was a button inside a link (`no-results.tsx`, shared).
  After the fixes: no deviation over 0.5px, no text under 4.5:1, no unnamed
  or nested control, no horizontal overflow.
- Review fixes (independent pre-merge review, 2026-10-04): the edit form
  deleted the terms of every family but film genres (it now carries them as
  `otherItemIds`; `classificationInput`, `otherClassificationIds` in
  `film-labels.ts`), a film titled "New" took the slug `new` that `/films/new`
  owns (now `new-2`), and `/films?page=30000` failed the offset cap (the home
  now counts and redirects before it reads). The record column names each
  family when a film has more than genres. Regression tests in
  `film-services.test.ts` and `film-home.test.ts`; full suite 1505 of 1505;
  checked in the browser (Edit film saved twice kept the Mood term; the page
  redirect; "New" became `new-2`) with no audit finding at 1440 and 390px.
- Not checked: the perfume pages in the browser after the shared move (the
  perfume integration and render tests pass); poster and still images (the
  preview has no image storage); Escape returning focus (the headless key
  event did not reach the native dialog; the shared `Dialog` is unchanged).
