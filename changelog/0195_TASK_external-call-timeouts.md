# Task 0195: Time limits on outgoing calls, a real geocode queue, non-Latin search results (SLN-299)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
The geocode and Google Places routes called outside services with no time limit, so a silent service could hang a request. Two concurrent geocode requests both read the same "last request" time and fired together, against Nominatim's one-request-per-second rule, and a busy answer (429, HTML) became a generic 500. Search results without an ISBN were merged by a key that kept only `[a-z0-9]`, so two different Cyrillic or Japanese titles both became "" and were merged into one.

## Implementation Details
- `src/lib/api/external-fetch.ts`: `fetchWithTimeout` (8 s by default; a caller's own signal still works), `fetchOk` (a non-OK answer throws `ExternalFetchError` with its status), and `serialThrottle` (a queue: each task starts at least the gap after the one before; a failed task does not block the rest).
- `src/app/api/geocode/route.ts`: Nominatim calls go through the queue with a time limit. No answer → 504; busy (429) → 503 with "Try again in a moment"; another error → 502.
- `src/app/api/venues/search-places/route.ts`, `place-details/route.ts`: time limit; no answer → 504. Their existing status handling stays.
- `src/lib/api/search-engine.ts`: the dedup and ranking key is the shared `normalizeSearchText`, which keeps every script's letters; a result with no title to compare is never merged.
- The other items in the ticket were already done: the book sources (ISBNdb, Google Books, Open Library) have an 8 s limit, Match reads its source with a 10 s limit (task 0184), cover downloads are guarded by SLN-278, and the search-engine comment already names ISBNdb as primary.

## Completion Notes
- Tests: `src/__tests__/utils/external-fetch.test.ts` (6): time limit with the host named, a non-OK status, the caller's own abort, the queue spacing with a failure in the middle, two different non-Latin titles kept apart, the same one merged. Unit suite: 879 passed.
