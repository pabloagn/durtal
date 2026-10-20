# Task 1000: A book never takes the address of a page beside its own

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1287, from the duplication survey (findings/duplication.md, section 11), confirmed by the text-normalization survey.

- **Reserved names.** Films and perfumes kept `new` out of their slugs; books did not. A book whose author's name makes no slug (a non-Latin name, SLN-1237) takes its title alone. So a book titled "New", "Import" or "Identify" got `new`, `import` or `identify`, and its page sat behind `/library/new`, `/library/import` or `/library/identify`.
- **Clash checks.** Three walks over an error's causes looked for a lost slug race.
- **Painting addresses.** New paintings took `title-<full uuid>` while every other work reads `title-by-creator`.

## Implementation Details

- `lib/catalogue/slugs.ts`:
  - `RESERVED_WORK_SLUGS` (`new`, `import`, `identify`) counts as taken whenever `uniqueSlug` picks a work's slug: books, the slug refresh after a rename, e-book accession, films and perfumes. Every kind shares `works.slug`, so one list covers every collection.
  - The films' and perfumes' local `taken: ["new"]` is gone.
  - A test checks the list against the fixed folders under `/library`, `/films`, `/perfumes` and `/paintings`, so a new fixed page needs its name added.
- **Clash checks.**
  - `isWorkSlugClash` and `createPerson`'s own loop are gone.
  - Films, perfumes, paintings and people now ask `uniqueConstraint(error)` (`lib/db/errors.ts`) for `works_slug_unique` or `authors_slug_unique`, as series already did.
- **Painting addresses.**
  - `creditedWorkSlug(id, title, credits, roleId, attempt)`, the film's slug function moved into `slugs.ts`, gives films `{title}-by-{director}` and new paintings `{title}-by-{painter}`.
  - Paintings now retry a lost slug race twice, then add their id, as films do.
  - Existing painting slugs stay as they are. A changed address needs SLN-1129's redirects first.
- `docs/02_DATA_MODEL.md`, `works.slug`: the painting format and the reserved names.

Not in this change: `NOT NULL` on `works.slug` and `authors.slug` (the ticket's 19 Oct addition). It needs a migration, Joris's own word, and a read-only check that live has no null slug. It belongs to deploy 3 of the pending migrations.

## Completion Notes

- Tests:
  - `book-saves.test.ts`: "New", "Import" and "Identify" by an author named 老子 get `new-2`, `import-2` and `identify-2`.
  - `painting-services.test.ts`: the Mona Lisa is `mona-lisa-by-leonardo-da-vinci`, and a second one adds `-2`.
  - `unique-errors.test.ts`: a work's and a person's slug race found through a wrapped error and through a readable error.
  - `reserved-slugs.test.ts`: the reserved list matches the fixed folders.
- The book, painting, film, perfume and people database suites pass, 68 of 68.
