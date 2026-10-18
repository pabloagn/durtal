# Task 0770: Server refusals say why on the screen

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-942 (actionResult adapters)
**Blocks**: None

## Overview

SLN-1033. Many writes refuse on purpose with a message written for people ("Remove this person's credits before deleting the identity"). A production build hides a thrown server action's message, so the screen showed a generic failure, or for an edition delete nothing at all. Every such write now sends its refusal as data, and the screen shows the reason.

## Implementation Details

- `src/lib/actions/catalogue-ui.ts`: 94 more "use server" adapters, one per write with a deliberate refusal in 31 action modules (people, editions, instances, works, collections, series, publishers, places, venues, orders, media, reading notes and queue, taxonomy and the rest). Each is `actionResult(() => mod.X(...args))`, so redirects and not-found still propagate.
- `src/lib/actions/catalogue-client.ts` and `taxonomy-client.ts`: the matching client wrappers. A refusal is raised again as an `ActionRefusal` (`src/lib/actions/refusal.ts`).
- `refusalMessage(error, fallback)`: the refusal's own reason, the connection message when Durtal could not be reached, else the caller's words. Next's and the engine's messages are never shown.
- `src/lib/notifications/connection.ts`: the connection-failure words and test, shared by `toast.ts` and `refusal.ts`.
- 73 screens import those writes from `catalogue-client` and show `refusalMessage` in their catches. The edition delete (`edition-actions-menu.tsx`) gained the catch it lacked. Bulk changes say how far they got and then why they stopped.
- Harmonization already returns `{ ok, error }` and is left as it was. Films, paintings and perfumes writes beyond SLN-942 are unchanged.

## Completion Notes

- `src/__tests__/ui/refusals-reach-the-screen.test.ts` (9 tests): the message rules, the adapters, that no client file imports a routed write from its own module, the edition delete's catch and the bulk wording. The action-validation prover accepts the adapters' delegation.
- Browser (production build, Chromium, Firefox and WebKit at 1440, 390 and 320): a person with credits shows the refusal and stays; a person without credits is deleted with "Person deleted"; a failing edition delete says "Could not delete the edition" and keeps the edition; a favourite saves on and off.
- Seen while checking, also on main's build: the favourite star sometimes stays busy for over a minute after its save and refresh have finished. Reported separately.
