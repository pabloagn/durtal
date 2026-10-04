# Task 0244: Every Page Sets Its Own Browser Tab Title (SLN-393)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Most pages set no title, so every tab and history entry read "Durtal".
`/harmonize` read "Harmonize · Durtal | Durtal" because its own title repeated
the root template `%s | Durtal`. Every page now has a title in the form
`<Name> | Durtal`.

## Implementation Details
- List and form pages export a static `metadata` with the page heading:
  Library, Authors, Publishers, Add publisher, Publisher names, Recommenders,
  Series, Suggested books, Collections, Places, Provenance, Locations,
  Taxonomy, Identify editions, Films, Paintings, Perfumes, and the 404 page
  ("Page not found").
- `/harmonize` now sets `title: "Harmonize"`.
- `/` sets `title: { absolute: "Dashboard | Durtal" }`. The root layout's
  template does not apply to a page in the layout's own segment.
- Detail pages export `generateMetadata`:
  - book: "<title> by <authors>" (title only when the work has no author)
  - author, publisher, recommender, collection, place: the name
  - publisher edit: "Edit <name>"
  - series: the series title
  - taxonomy family: the family name; taxonomy item: "<item> · <family>"
  - a missing record: "<Kind> not found"
- Each detail page wraps its loader in React `cache()`, as
  `src/app/perfumes/[slug]/page.tsx` already did, so the title and the page
  share one database read per request.

## Completion Notes
- Checked with `curl` against `next dev` on every route: each `<title>` reads
  `<Name> | Durtal`. A missing book renders the 404 page, titled
  "Page not found | Durtal".
- `/films`, `/paintings` and `/perfumes` return the 404 page on main while
  those domains are closed. Their titles take effect when the domains open.
- No visible change on the page, so the alignment and design audits do not
  apply.
