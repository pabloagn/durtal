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

- `src/lib/actions/catalogue-ui.ts`: 120 more "use server" adapters, one per action with a deliberate refusal, across 36 action modules (people, editions, instances, works, collections, series, publishers, places, venues, orders, media, reading notes and queue, taxonomy and the rest). Each is `actionResult(() => mod.X(...args))`, so redirects and not-found still propagate.
  - The Identify editions search (`findEditionCandidates`), Match again's preview and save, the publisher name inbox, Mark as read and the work form's new author, from the Identify and Harmonize, data-integrity and editing surveys.
  - The film, painting and perfume records and their copies and bottles.
  - `taxonomy-ui.ts` adds `searchTaxonomyItems`, and the taxonomy assignment picker now uses the adapters.
- `src/lib/actions/catalogue-client.ts` and `taxonomy-client.ts`: the matching client wrappers. A refusal is raised again as an `ActionRefusal` (`src/lib/actions/refusal.ts`).
- `refusalMessage(error, fallback)`: the refusal's own reason, the connection message when Durtal could not be reached, else the caller's words. Next's and the engine's messages are never shown.
- `src/lib/notifications/connection.ts`: the connection-failure words and test, shared by `toast.ts` and `refusal.ts`.
- 90 screens import those writes from `catalogue-client` and show `refusalMessage` in their catches. The edition delete (`edition-actions-menu.tsx`) gained the catch it lacked. Bulk changes say how far they got and then why they stopped.
- An edition create or edit whose ISBN another edition holds names that book, and its toast has "Open that book", as the add wizard links the clash. `ExpectedActionError` and `ActionRefusal` carry an optional `href` for this (`isbnHolder` in `isbn-clash.ts`; `refusalAction` in `refusal.ts`).
- On a touch screen a toast's action (Undo, Open that book) has a 44px tall target, as its cross does (`globals.css`).
- 72 refusals in the routed modules that were plain `Error`s became `ExpectedActionError`s, so their reasons cross: the ISBN clash, "Order not found", "Already in Up next", "Cite one source" and the rest. Five faults no one can fix from the screen stay plain errors. Also Match again's "Unlock this edition before you match it again", the inbox's "Choose a publisher", a missing edition in Identify and Match again ("This edition no longer exists"), and Mark as read's partial progress ("Marked 40 before an error..."). An unknown failure with nothing written still throws, so Next logs it.
- Left as they were, each with its own way of saying why: Harmonize (already `{ ok, error }`), the eBook review steps (their `ReviewError` codes), the reader's actions (reader files belong to the reader threads), and the reading dialogs' data read (any failure shows the dialog's own error state).

## Completion Notes

- `src/__tests__/ui/refusals-reach-the-screen.test.ts` (12 tests): the message rules, the adapters and the clash link, that no client file imports a routed write from its own module, that every "use server" action a screen calls and that throws `ExpectedActionError` is routed (one named exception), that the routed modules refuse with `ExpectedActionError` (five named faults), the edition delete's catch and the bulk wording. The action-validation prover accepts the adapters' delegation.
- Browser (production build, Chromium, Firefox and WebKit at 1440, 390 and 320): a person with credits shows the refusal and stays; a person without credits is deleted with "Person deleted"; a failing edition delete says "Could not delete the edition" and keeps the edition; a favourite saves on and off; an edition edit to another book's ISBN says so, keeps the dialog open and "Open that book" opens it, with the alignment, touch and design audits clean; a film deletes; Identify editions says "ISBNdb did not answer" without a key.
- Seen while checking, also on main's build: the favourite star sometimes stays busy for over a minute after its save and refresh have finished. Reported separately.
