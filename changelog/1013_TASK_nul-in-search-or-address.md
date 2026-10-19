# Task 1013: A NUL character in a search or an address no longer fails the page

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1137. Postgres refuses byte 0x00 in text, and the search normalizer kept
U+0000, so `?q=%00` showed the error screen on most lists, and a NUL in a
record path, the publisher review's `publisher` or the works and authors
APIs answered 500. A NUL inside a palette search failed its organisations
query. The e-book cases were fixed in #506; this covers the rest in one
place rather than in every parser.

## Implementation Details

- `src/proxy.ts`: a query holding U+0000 in a key or a value redirects to
  the same address without it, keeping the rest of the query. A path
  segment holding one shows the catalogue's not-found view (rewritten to
  `/_missing`, which only the catch-all page matches); an API path answers
  404. Another name is still refused first.
- `src/lib/utils/search-text.ts`: `normalizeSearchText`, and so
  `searchTokens`, drop U+0000, so "nad\0ja" searches for "nadja".
- `src/lib/utils/like.ts` and `textContains`: the raw text sent to `ilike`
  and `search_normalize` drops it too, for server actions that search
  without going through the proxy.
- `quickSearch` drops it before trimming.

## Completion Notes

- Over HTTP on production builds, private previews, every address from the
  survey (16 lists with `?q=%00`, the publisher review, `zodiac` and
  `country`, four record paths, three APIs and an API record path): main
  780d17e1 showed the error screen or a 500 on 15 of 28; this change on
  none. Lists redirect once to `?q=`, record paths are 404 with the
  ordinary not-found view, the APIs answer 200 after the redirect.
- Tests: `broken-addresses.test.ts` covers each list, the other keys, the
  APIs, the record paths, the host check and addresses left alone (an
  escaped `%2500`, other control characters); `search-text` and `like`
  tests; a quick-search database test finds a publisher and a series from
  "nad\u0000ja". The proxy and helper tests fail on main.
