# Task 0213: Film Home, Detail, Cast and Crew, and Version Editing (SLN-367)

**Status**: In Progress
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

This task was stopped at a safe point on 2026-10-03 and handed over to
another thread. Branch `codex/sln-367-films`, work-in-progress commit
`10e4f87` on top of `208555b` (`fix/backlog-0116-0121`). Not for merging as is.
Worktree: `/Users/pabloaguirre/.codex-personal/worktrees/curated-library/durtal`.
Reserved numbers: changelog 0213; migration 0054 only if one is needed (ask the
coordinator first; none is expected).

## Implementation Details

**Done (commit `10e4f87`)**
- Shared components moved out of `src/components/perfumes/` into
  `src/components/catalogue/`, so films reuse them:
  - `search-picker.tsx` and `confirm-delete-dialog.tsx`.
  - `record-fields.tsx`: chips, Add, labelled rows, `SingleChoiceField`,
    `TermListField`, `useOrganizationSearch(role)` (hints for every
    organization role) and `usePersonSearch(domain)`.
  - `curation.tsx`: `CurationProvider owner={{ kind, id }}`, the favourite
    toggle, the rating, and `PersonalNotes` with a placeholder per collection.
  - `sources-section.tsx`: owner, title and form examples per collection.
  - `holding-fields.tsx`: `StorageFields`, `AcquisitionFields`,
    `DisposalFields`, `priceError`, `readNumber`. The bottle dialog uses them.
  - The perfume screens use all of these. Typecheck passes, but the browser
    re-check is still to do.
- Shared lib: holding status labels and `HoldingStatus` in `holdings.ts`
  (`perfume-labels.ts` re-exports them); `organizationRoleQueries` in
  `work-store.ts`; `isWorkSlugClash` in `slugs.ts`.
- Film services (`src/lib/actions/films.ts`, `src/lib/catalogue/film-store.ts`,
  `src/lib/validations/films.ts`):
  - Filters: `directorIds` and `castIds`, each matched on its own role and
    both required.
  - Slugs: a new film gets `{title}-by-{director}` (the first director by name
    or as credited; the title alone without one), numbered when taken, with
    retries when another work takes it during the write. Renames keep it.
  - Roles: production companies, release distributors and copy suppliers get
    their role in the same write as the link.
  - Cards carry the poster tone.
  - New reads: `getFilmFilterOptions`, `getRelatedFilms` (by the first
    director, shared cast, two or more shared genres; each film once),
    `findFilmsByTitle` (same title or original title, for the remake or cut
    prompt) and `getFilmChoices` (countries and languages).

**Shared-file plan (announced to the other sessions)**
- `src/components/catalogue/` is the home of record parts shared by the
  collections.
- `src/components/shared/no-photo.tsx`: append `TitleCard`, the film
  no-poster stand-in, at the end of the file only. Another session has an
  open `monogramTint` edit near the top.
- `src/lib/catalogue/work-store.ts` and `src/lib/catalogue/holdings.ts`: as
  above.
- Do not touch `perfume-filters.tsx`, `perfume-grid.tsx`, `entity-filters.tsx`
  or `domain-home-shell.tsx` while the grid session has edits open there.
  Film grids take `COL_CLASSES` from its `src/components/shared/grid-columns.ts`.

**Left**
- [ ] Update `src/__tests__/integration/film-services.test.ts`. About line 297
  expects "Organization does not have the required distribution_company role"
  (the role is now written with the link), and line 191 expects the old
  `the-thing-${id}` slug. Add tests: director and cast filters together,
  filter options, related films, title matches, supplier and distributor roles.
- [ ] `src/lib/catalogue/film-labels.ts` (runtime format and parse, crew
  headings) and `film-params.ts` (URL filters: director, cast, genre, language,
  country, holding, medium, favourite, from, to). Add the film filter keys to
  `domain-switch.ts`.
- [ ] `TitleCard` in `no-photo.tsx` (append only).
- [ ] Film home (`src/app/films/page.tsx`): poster-led `FilmCard` and
  `FilmRow`, film filters, the grid inside an `@container`. Then remove the
  unused film sorts in `domain-home-shell.tsx`; tell the grid session first.
- [ ] Film detail (`/films/[slug]`, with loading and not-found pages):
  - The still as a backdrop (as on the book page), the poster, and the title
    controls via `CapAlignedControls`.
  - `DetailColumns`. Reading column: synopsis, cast with characters (collapsed
    when long), crew by role, versions with runtime and releases, copies,
    personal notes. Record column: details, genres, sources.
  - Full-width rows: related films and gallery. Rules in
    `docs/03_DESIGN_LANGUAGE.md`, "Detail pages".
- [ ] Forms:
  - `/films/new` and the edit dialog: title, original title, release date,
    synopsis, countries, languages, production companies, genres, and the
    credits editor (roles, characters, unknown or credited-as, reorder).
  - The same-title prompt: a remake is a new film; a cut is a version of the
    existing film. Explicit remake and adaptation links stay SLN-363.
  - The version dialog with releases; the copy dialog; delete with its
    blockers.
- [ ] People links: a director goes to `/films?director=…`, a cast member to
  `/films?cast=…`.
- [ ] QA on `scripts/qa/preview-local.py`:
  - Open films and perfumes locally; undo that before any commit.
  - Alignment and design audits at 1440, 768 and 390px, dialogs included.
  - Re-check the perfume pages and dialogs after the shared move.
- [ ] Docs 02, 04 and 14; typecheck, lint, full suite. Then merge the latest
  `fix/backlog-0116-0121`, push, and update Linear.

## Completion Notes
- Checks at the handover: `pnpm typecheck` and `pnpm lint` pass.
- Targeted integration tests (film and perfume suites): 11 failed and 26
  passed.
  - `film-services.test.ts` fails on the old expectations above.
  - The perfume suites hit 10-second hook timeouts on a loaded machine (the
    run took 328 s). A duplicate-key error then followed in a retried hook.
    Rerun the full suite on a quiet machine before trusting either result.
- Linear: SLN-367 is In Progress, with the handover comment posted on
  2026-10-03 (after earlier hook timeouts).
- To check the branch: `git switch codex/sln-367-films`, then `pnpm typecheck`,
  `pnpm lint` and `python3 scripts/qa/test-local.py`.
