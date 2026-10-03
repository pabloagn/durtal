# Task 0214: Security Fixes Merge (SLN-276, SLN-277, SLN-279, SLN-280, SLN-283)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0200 (SLN-281, atomic writes), 0203 (SLN-397, bios sanitized like descriptions)
**Blocks**: SLN-382 (the release rehearsal needs a production build without database credentials)

## Overview
Four security fixes were pushed on their own branches on 2026-09-25 and never
merged. Since then `fix/backlog-0116-0121` gained about 130 commits. This task
ports each fix onto the current branch, one commit per issue, and keeps the
branch's newer behaviour wherever the code moved.

- SLN-283 (`4d32508`): applied. The backlog branch still pre-rendered pages
  at build time.
- SLN-276 (`ccc298f`): applied, with secret patterns at any depth and
  `DURTAL_API_TOKEN` in compose.
- SLN-277 (`d4a321f`): re-applied by hand on the shared description
  sanitizer.
- SLN-279 (`d3ddd31`): re-applied by hand on the current actions and schemas.
- SLN-280 (`070cc7b`): re-applied by hand on the current order sync.

SLN-281 (`d0c7b7b`) was not merged: task 0200 redid it.

## Implementation Details

**SLN-283, pages per request**: the root layout sets
`dynamic = "force-dynamic"`. `getDb()` throws during `next build`, so a route
that starts to pre-render fails the build. One conflict, in
`docs/04_ROUTES_AND_VIEWS.md`: the new paragraph about domain route folders
stays, and the force-dynamic sentence names the root layout.

**SLN-276, no secrets in the image**: `.dockerignore`, Dockerfile, compose,
Taskfile and `docs/11_DEPLOYMENT.md` as in the original. Two additions: the
secret patterns match at any depth (`**/.env`, `**/.env.*`), because a
checkout can hold a nested worktree with its own `.env` files. Compose also
passes `DURTAL_API_TOKEN`, which the REST writes read since the original fix.

**SLN-277, bios**: the backlog already rendered the bio through
`sanitizeDescriptionHtml` (SLN-397). The fix reuses that sanitizer instead of
the original `sanitizeBioHtml`.
- `cleanBioForStorage()` (`src/lib/utils/sanitize.ts`): the sanitized bio, or
  null when no text is visible. `createAuthor`, `updateAuthor`,
  `createPerson` and `updatePerson` store it. `getAuthor` and
  `getAuthorBySlug` hand bios out sanitized, so the edit dialog cannot load
  live markup.
- `src/lib/utils/html-text.ts` (no dependencies, client safe):
  `escapeHtml`, `plainTextToHtml`, `isSafeLinkUrl` (http and https, the
  schemes the sanitizer keeps).
- Rich text editor: pasted text is escaped, links that are not http or https
  are refused, and Enter starts a `<p>`, which the sanitizer keeps (a `<div>`
  would be flattened).
- The authors list shows a plain-text bio preview.

**SLN-279, validated actions**: `toUpdateSchema()` and `parseId()` in
`src/lib/validations/helpers.ts`.
- New validation: `updateAuthor`, `updateInstance`, `create/updateLocation`,
  `create/updateSubLocation`, `updateOrder`, `updateOrderStatus`,
  `updateWorkTaxonomy` and the legacy subject, genre and tag actions.
- Unknown keys are now rejected by `updateWork`, `updateEdition` and
  `updateTaxonomyItem`, which already parsed their input.
- Kept from the backlog: collections, venues, taxonomy families and the new
  domain actions already validate with strict schemas; the original
  `validations/collections.ts` was not ported. `updateWorkSchema` keeps its
  `kind: never` and optional author list.
- Deviation: edition reparenting stays (`workId` in `updateEditionSchema`),
  because task 0156 made it a supported path checked by `requireBookWork`.
  A copy cannot move to another edition through an update.
- `src/__tests__/cross-layer/actions-validate.test.ts`: every exported
  `create*`/`update*` action parses its input (`.parse`, `.safeParse` or
  `parseId`; `createPublisherFromName` hands it to `savePublisher`), and no
  `update*Schema` is unused.

**SLN-280, order status sync**: `nextCatalogueStatus()`
(`src/lib/utils/order-status-sync.ts`) only promotes. The backlog's rule that a
copy that is not deaccessioned counts as a book in hand stays. When no open
order is left, an on_order work goes back to its status before the order
(`work_status_history`, else wanted); other statuses stay. `deleteOrder`
records a `work.order_deleted` activity event instead of a history row that
the cascade removed at once. The activity icon map gained `Truck`, the icon
both order events name (they showed the fallback icon before).
`docs/02_DATA_MODEL.md`: Status Changes From Orders.

## Completion Notes
- `pnpm typecheck` and `pnpm lint`: no errors, no warnings.
- `pnpm test` (rebased on `b5d2dfc`): 1,097 passed, 391 skipped (the
  database suites). The branch before this task: 969 passed, 387 skipped.
- `python3 scripts/qa/test-local.py` (all suites on disposable PostgreSQL,
  rebased on `b5d2dfc`): 1,488 of 1,488 passed in 108 files and 41 database
  suites, 0 skipped. The new suite `order-status-sync` fails 3 of 4 tests on
  the old sync code and passes 4 of 4 now.
- Production build (`next build --webpack`, no `DATABASE_URL`): failed before
  on `/_not-found` and `/authors` ("DATABASE_URL is not set"); passes now.
  Rebased: 82 routes are dynamic; only `/icon.svg` and `/apple-icon.png` are
  static.
- Docker build context (probe `FROM scratch`, `COPY . /ctx`, dummy `.env`
  files at the root and in a nested folder): before, it held `.env`,
  `.env.local`, `.git` and `.next`; now only `.env.example` files.
- Live data, read only: the 391 stored bios use only `<p>` and `<em>`, which
  the sanitizer keeps. The author, copy and location edit payloads of all
  2,166 authors, 227 copies and 6 locations pass the new update schemas.
- Browser, on a disposable local database (`scripts/qa/preview-local.py`): a
  bio with `<img onerror>` ran its script in the edit dialog before the fix
  and loads as `<p>Novelist.</p>` after it. Pasted markup stays text, and a
  `javascript:` link is refused. The author, location, copy, edition, work,
  taxonomy, bulk status and order dialogs save. A cancelled order returned
  its book to wanted. An owned book stayed accessioned through a new order
  and its deletion.
- Alignment audit: 0 deviations on `/authors` (and the Add Author dialog),
  `/authors/[slug]` (and the Edit dialog), `/locations` and two book pages.
  The new activity icon is 0.01px from its text's cap-height center.
- Not done: a full `docker build` (it would download every package), a run
  of the production server, and the Tiptap editor that SLN-277 suggests.
  The editor's Underline button makes `<u>`, which the shared sanitizer
  drops, as the author page has since SLN-397.
- No migration. Nothing was written to the live database.
- Rotate the database, AWS and API keys if an image built before SLN-276 has
  left this machine.
