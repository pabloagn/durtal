# Task 0554: Place search says why Google refused it

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-424, the code half. Google answers 403 to the live Places key, so adding a place found nothing. The search already showed an error for a 403, but its wording ("Places API key invalid or quota exceeded") mixed two causes, and Google's own 429 (quota spent) fell through to "Places search failed".

Fixing the key itself (the Places API enabled, billing, key restrictions) is Pablo's half of the ticket.

## Implementation Details

- `src/lib/api/google-places.ts`: `placesRefusal(status)` gives each refusal its own message.
  - 403: "Google Places refused the key. Check it in Settings, Integrations."
  - 429: "Google Places is over its quota. Try again later."
- The place search (`api/venues/search-places`) and place details (`api/venues/place-details`) use it. Both still log Google's status and body, and answer 503.
- The search field shows the message under the input in red text, as it shows every error.
- `.env.example` already carries `GOOGLE_PLACES_API_KEY=`, and Settings, Integrations already checks the key (403 "refused the key", 429 "Over the quota"); neither changed.

## Completion Notes

- `src/__tests__/api/search-places.test.ts` checks both messages.
