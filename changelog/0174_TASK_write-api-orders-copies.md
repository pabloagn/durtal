# Task 0174: REST API for orders, copies and works

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview
Orders, arrivals and recommendations were entered by scripts that wrote to the database through server actions. The REST API could only read. This task adds write routes, so routine catalogue work goes through the running app with a token.

## Implementation Details
- `src/lib/api/rest.ts`: `requireApiToken` (Bearer `DURTAL_API_TOKEN`, constant-time compare; unset token refuses every write with 503), `readJson`, `errorResponse` (Zod errors as 400 with issues).
- `src/app/api/orders/route.ts`: `GET` (orders of a work, or all active orders) and `POST` (calls `createOrder`). A work with an active order is refused with 409 unless `?allowDuplicate=1`.
- `src/app/api/orders/[id]/route.ts`: `GET` and `PATCH` (calls `updateOrder`; `status` and unknown fields refused).
- `src/app/api/orders/[id]/status/route.ts`: `POST` (calls `updateOrderStatus`; an invalid transition is 409 with the allowed statuses).
- `src/app/api/instances/route.ts`: `POST` (calls `createInstance`; 404 for an unknown edition or location).
- `src/app/api/works/[id]/route.ts`: `PATCH` with `catalogueStatus` (calls `updateWork`) and `addRecommenderIds`.
- `src/lib/actions/recommenders.ts`: `addWorkRecommenders` adds links and keeps existing ones.
- Docs: `docs/05_API_REFERENCE.md`, `docs/13_CONFIGURATION.md`, `.env.example`.

## Completion Notes
- `pnpm typecheck` and eslint on the changed files pass.
- Checked on :3100: no token and a wrong token give 401; an invalid body gives 400; an unknown field gives 400; delivered to shipped gives 409; a second order for a work with an active order gives 409.
- First use: 26 Amazon.nl orders of 2026-10-03 entered through `POST /api/orders`, all 201, read back through `GET /api/orders`.
- `DURTAL_API_TOKEN` is set in `.env.local` (not committed).
