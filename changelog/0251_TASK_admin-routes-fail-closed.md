# Task 0251: Admin Media Routes Fail Closed (SLN-423)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Three media maintenance routes checked `ADMIN_TOKEN` only when it was set.
It was not set on the Mac, so anyone who could reach the app could rewrite
S3 files and media rows in bulk: `POST /api/media/reprocess`,
`POST /api/media/apply-crops` and `POST /api/media/backfill-palettes`.

## Implementation Details
- `src/lib/api/admin.ts` adds `requireAdminToken(req)`, modelled on
  `requireApiToken` in `src/lib/api/rest.ts`. Without `ADMIN_TOKEN` it answers
  503. A missing or wrong `x-admin-token` header answers 401. The comparison
  uses `timingSafeEqual`.
- The three routes call the helper first, before they read any row.
- Settings, Integrations now shows the routes as "Off" (refused) when the
  token is not set, not "Open".
- `.env.example` has an `ADMIN_TOKEN=` line. `docs/11_DEPLOYMENT.md` has an
  Admin Token section, and `docs/05_API_REFERENCE.md` matches.
- `src/__tests__/api/admin-token.test.ts` covers the helper and the 503, 401
  and success answers of each route. The apply-crops integration test now
  sends the token.

## Completion Notes
- No other admin route exists. The other unprotected API routes (media
  upload, comments, export, reader, venues, search and more) are called by
  the app's own pages from the browser, which holds no token. Protecting them
  needs a login or a same-origin check, not this token, so it stays out of
  this task.
- Not done here, because they need Pablo: a real token in `.env.local`, and
  binding the dev server to this Mac only (`-H 127.0.0.1`).
