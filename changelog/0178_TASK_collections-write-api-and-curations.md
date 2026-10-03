# Task 0178: Collections Write API and First Curations

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0174
**Blocks**: None

## Overview

Collections could be created and filled only from the app. This task adds REST routes for them, behind the bearer token of task 0174, and uses them to create three curations: Des Esseintes' Library, Before the Film and The Summits. Each collection got an abstract poster.

## Implementation Details

- `GET /api/collections` lists collections with their edition counts.
- `POST /api/collections` creates a collection with `name`, `description`, `icon` and `editionIds` (in order). `requestId` makes a retry safe. Unknown edition IDs answer `404` with `missing`, and nothing is written.
- `GET` and `PATCH /api/collections/[id]` read one collection and change its name, description or icon.
- `POST` and `DELETE /api/collections/[id]/editions` add editions at the end, in the order given, or take them out.
- The routes call the server actions in `src/lib/actions/collections.ts`, so the activity log records each book that joins or leaves.
- Body schemas: `src/lib/validations/collections-api.ts`. Icons are checked against the Lucide icon list, as `setCollectionIcon` does.
- `src/lib/api/missing-editions.ts` finds unknown edition IDs before a write.
- Tests: `src/__tests__/collections-api-route.test.ts` (token, unknown fields, unknown icon, unknown editions, order).
- Docs: the Collections section of `docs/05_API_REFERENCE.md`.

## Completion Notes

- Created through the API: Des Esseintes' Library (6 editions), Before the Film (21) and The Summits (22). Each edition is the owned one where a copy exists.
- Posters were uploaded through `POST /api/media/upload`, as the app does. Full image and thumbnail are on S3 for each.
- Books that are not in the catalogue yet are left for manual entry.
