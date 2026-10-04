# Task 0287: Google Books Quota Handling (SLN-425, code half)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Without `GOOGLE_BOOKS_API_KEY`, Google Books shares Google's anonymous quota
and answers 429. Search then lost the source silently: it read as "no
results". Now a refused call backs off without hammering the API, the add-book
search and the Match dialog say "Google Books is over its quota", the other
sources keep working, and the integrations page shows the last call. The key
half of SLN-425 waits for Pablo's key: the code already sends
`GOOGLE_BOOKS_API_KEY` when it is set (it is optional and never committed).

## Implementation Details
- `src/lib/api/google-books-quota.ts`: `googleBooksFetch` wraps every Google
  Books call (search, and Match's record read in `src/lib/match/source.ts`).
  A 429, or a 403 whose reason is a quota one, is retried twice, after 250 ms
  and 500 ms (or a shorter Retry-After); only one call retries at a time, the
  others give up at once. Then no call goes out for a cool-down that doubles
  on each refusal in a row (30 s, 1 min, 2 min … 15 min; a longer
  Retry-After wins); a call that works ends it. The SLN-299 timeouts stay.
  The state lives on `globalThis`, so route handlers, server actions and
  pages, which Next.js bundles apart, share one cool-down per process.
- `searchGoogleBooks` returns no results while over the quota;
  `searchNotices()` (`search-engine.ts`) says why. `/api/search` and
  `/api/match` return `notices`; `useDebouncedSearch` (add-book wizard) and
  `match-again-dialog.tsx` show them above the results. Match's read of a
  Google Books record throws `GoogleBooksQuotaError`, whose message says the
  same.
- `src/lib/settings/integrations.ts`: Google Books shows "Last search call"
  ("Worked at …", "Over the quota at …; paused before the next try", "Failed
  at …", or "None since the app started").
- Tests: `src/__tests__/api/google-books-quota.test.ts` (retries, cool-down
  and its doubling, one retrying call among five, a call that works, 403
  reasons, Retry-After, the notice); `book-search.test.ts` resets the state
  and checks the notice.

## Completion Notes
Checked on a disposable local database, with Google's real anonymous quota
(it answered 429): the first search logged three refused Google calls and
showed the notice above the Open Library results; searches during the
cool-down made no Google call and still showed it; the integrations page read
"Over the quota at 14:28 UTC; paused before the next try". Alignment and
design audits on `/library/new` and `/settings/integrations` at 1440px: the
notice adds no deviation (the result rows' arrow icons, 3.69px off, are
older than this task), 0 unnamed and 0 nested controls.

### Review fixes

- A missing or blank Retry-After now means "no hint": the retries wait 250 ms
  and 500 ms. Before, `Number(null)` gave 0 and the three tries went out at once.
- Calls that give up while a pause already runs do not count another refusal,
  so one search with four Google queries pauses 30 s, not 240 s.
- `previewMatch` and `applyMatch` return `{ ok: false, error }` when Google
  Books is over its quota (production hides a thrown action's message); the
  Match dialog shows it. Closing the dialog clears the old notices.
- The settings check goes through the quota state: no call while it pauses,
  and the check counts as the last call.
- One time limit for the whole call, retries included; refused bodies are
  cancelled.
- Tests: the 250 and 500 ms delays, exactly 7 requests for 5 calls at once,
  one refusal for calls that give up together, one signal across tries, the
  Match quota path, the route notices and the settings line.
