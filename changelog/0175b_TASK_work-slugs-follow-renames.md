# Task 0175b: Work slugs follow renames

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0174
**Blocks**: None

## Overview
A renamed work kept its old slug, so its page address showed the old title. `updateWork` compared the new title with the row it had just written, so the change was never seen. Author renames and author merges never touched work slugs either. 49 of 658 works had a slug that no longer fitted their title or author.

## Implementation Details
- `src/lib/works/slug.ts`: `slugFitsBase` (the base slug or the base with a number), `refreshWorkSlug` (reads the work after the write and gives it the slug its title and primary author need; a fitting slug keeps its number) and `refreshAuthorWorkSlugs`.
- `src/lib/actions/works.ts`: `updateWork` calls `refreshWorkSlug` after a title or author change, in place of the broken comparison.
- `src/lib/actions/authors.ts`: `updateAuthor` (name change) and `mergeAuthors` refresh the slugs of the author's works.
- `src/app/api/works/refresh-slugs/route.ts`: `POST` with `dryRun=1` and `id`, behind the API token.
- `src/__tests__/utils/work-slug.test.ts`: `slugFitsBase`.
- Docs: `docs/02_DATA_MODEL.md` (works.slug), `docs/05_API_REFERENCE.md`.
- `harmonization_redirects` was not used for old slugs: its primary key is the source record, which a later merge of the same work needs.

## Completion Notes
- `pnpm typecheck`, eslint and the new test pass.
- Dry run on live data listed 49 works; each line was read before applying. Applied: 49 changed. A second dry run: 0.
- `/library/sodom-and-gomorrah-by-marcel-proust` and `/library/libra-by-don-delillo` load; the old `/library/in-search-of-lost-time-by-proust-marcel` is 404. Old slugs do not redirect.
- The rename path in `updateWork` and the author paths call the same `refreshWorkSlug`; no real book was renamed to test them.
