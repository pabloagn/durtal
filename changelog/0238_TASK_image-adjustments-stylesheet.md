# Task 0238: Photo Adjustments as a Cached Stylesheet, No Zod on Every Page (SLN-385)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: SLN-294 (its page-weight target needs this shared weight gone)

## Overview
The root layout read every `image_adjustments` row and passed it to
`ImageAdjustmentProvider`. The provider wrote one inline `<style>` block for
all of them. So every full page load carried the rules once as CSS and again
as JSON in the RSC payload. The provider also called `imageAdjustmentStyles`,
which runs `zod`, so the zod chunk loaded on every page.

## Implementation Details
- `src/app/api/image-adjustments.css/route.ts`: serves the saved rules as one
  stylesheet. The current version gets
  `Cache-Control: public, max-age=31536000, immutable`. Any other `v` gets
  `no-store`, so an old URL can never be cached with new rules.
- `src/lib/media/adjustment-stylesheet.ts`: `getImageAdjustmentsVersion` is
  `max(updated_at)` plus the row count, read through `cached()` with tag
  `CACHE_TAGS.media`. A save already invalidates that tag.
- `src/app/layout.tsx`: renders `<link rel="stylesheet">` to the route with the
  version, in place of passing the rows to the provider.
- `src/components/media/image-adjustment-provider.tsx`: no `initial` prop. It
  renders only the edits saved since the page loaded. Its `<style>` comes after
  the stylesheet and has the same selectors, so an edit wins at once.
- `src/lib/utils/image-adjustment-css.ts`: the zod-free helpers (types,
  defaults, filter, selectors, `imageAdjustmentRule`). The provider and the
  editor import this module. `src/lib/utils/image-adjustments.ts` keeps the
  schema and the validating `imageAdjustmentStyles`, and re-exports the rest.
- `src/lib/utils/website.ts`: `parseWebsite` and `websiteLabel` moved out of
  `src/lib/validations/recommenders.ts`, which re-exports them. The recommender
  form, loaded by the shortcuts provider on every page, was the last client
  import of zod.

## Completion Notes
Measured on production builds (`next build` + `next start`) with live data:

| | main (c9f6359) | this branch |
|---|---|---|
| 404 page HTML | 278,212 bytes | 27,834 bytes |
| Inline adjustment `<style>` | 167,772 bytes | none |
| 404 page scripts | 1,089,834 bytes | 818,919 bytes |
| Chunk with zod on the 404 page | yes (270,084 bytes) | none |

- The stylesheet route returns the same 167,772 bytes of CSS, cached by the browser.
- Browser check on `next dev`, `/authors/sigrid-undset`: the adjusted poster's
  computed filter matches its stylesheet rule. A provider-style `<style>` for
  the same image overrides it, and removing it restores the saved rule.
- `alignment-audit.js`: 0 issues on `/authors/sigrid-undset` and the 404 page.
  `design-audit.js`: no low contrast or unnamed controls. One nested control
  on the author page comes from markup this task does not touch.
- No migration.

### Follow-up: API reference entry (2026-10-04)
- `docs/05_API_REFERENCE.md` gains an "Image Adjustments" section for
  `GET /api/image-adjustments.css`. Without it, the doc-coverage test from
  PR #24 (SLN-310) fails once both PRs are merged.
- Checked by merging this branch with PR #24's head locally: the doc-coverage
  test passes. `git merge-tree` against PRs #34 and #36 shows no conflict.
