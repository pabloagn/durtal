# Task 0295: Tests for the REST write routes

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0174
**Blocks**: None

## Overview

Task 0174 (SLN-417) added write routes to the REST API with no automated
tests; its "Open" note points to SLN-311. This task adds a database suite for
them, and fixes one bug the suite found.

## Implementation Details

- `src/__tests__/integration/rest-write-routes.test.ts`
  (`DURTAL_REST_WRITES_TEST_DATABASE_URL`, `/sln417_rest_writes`), 21 tests:
  - The bearer token: every write answers 401 without it or with a wrong
    one, and 503 while `DURTAL_API_TOKEN` is not set; reads need no token.
  - `POST /api/orders`: 201 with the status history and the work's catalogue
    status (`on_order`); 409 for a second active order unless
    `allowDuplicate=1`; 400 for an invalid body or no JSON; 404 for an
    unknown work.
  - `PATCH /api/orders/[id]`: changes details; refuses `status`, unknown
    fields, an unknown order and an invalid id.
  - `POST /api/orders/[id]/status`: records the move, sets the delivery date,
    makes the work `accessioned`; 409 with the allowed statuses for an
    invalid move; 400 and 404.
  - `POST /api/instances`: 201; 404 for an unknown edition or location; 400.
  - `PATCH /api/works/[id]`: a rename moves the slug; catalogue status;
    recommenders are added and the existing ones kept; 400 and 404.
  - `PATCH /api/editions/[id]`: title and subtitle only; 400 and 404.
- Fix: `PATCH /api/works/[id]` with a recommender id that does not exist
  answered 500 (the foreign key refused the insert). Because the title is
  written first, a title in the same request was saved anyway (read from the
  code order). The route now checks the recommenders before any write and
  answers 404 "Recommender not found". `docs/05_API_REFERENCE.md` says so.

## Completion Notes

- No route to create works or editions was added; that part of SLN-417's
  note stays open.
