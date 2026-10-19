# Task 0774: The reading import says why it refused

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0770
**Blocks**: None

## Overview

SLN-1168, from the review of #519. The reading import's buttons called their
server actions directly, and its store refused with plain errors. On the live
app every refusal ("Choose a book first", "These reads are already in
Durtal", a page past the last page) became Next's production sentence. An
import that stopped partway said the same, though what went in was sound and
pressing Import again finished it.

## Implementation Details

- The seven reading-import actions go through `actionResult` adapters in
  `catalogue-ui.ts` and `catalogue-client.ts`. `import-client.tsx` imports them
  from the client adapters and shows `refusalMessage(error, fallback)`, with
  its own words for commit, undo and Match again. The page refreshes after a
  failure too, so an import that stopped offers the rest.
- `lib/reading/import/store.ts` and `notes.ts`: the refusals are
  `ExpectedActionError`s. "Each row needs its number" stays a plain error: no
  screen can cause it.
- `commitImport`: when a chunk fails after others went in, the refusal says
  "The import stopped partway: N readings are in. Import again to add the
  rest." With nothing written, the error passes on as it was.
- `deleteAuthor`: a book person who also has a film, painting or perfume
  credit gets "Remove this person's credits before deleting the identity",
  as the shared delete says, rather than the foreign key's message.
- The guard test is transitive: `src/__tests__/helpers/refusal-reach.ts` follows
  each action a screen calls outside the adapters through every module it
  calls, and finds any `ExpectedActionError` on the way. The 13 left each say
  why in their own way, and are named with that reason; an allowance that no
  longer applies fails the test. A fixture checks a refusal raised one module
  away is found.
- Not done here: splitting `catalogue-client.ts` by domain. Page weight passes,
  and it measures HTML and server time, not scripts.

## Completion Notes

On a production preview, in Chromium, Firefox and WebKit at 1440, 390 and 320: with one import open in two tabs, an import committed in one and a row's Skip pressed in the other shows "This row was imported; undo the import to change it". The alignment, touch and design audits report nothing with the toast showing, and page weight passes. In WebKit the row's buttons sometimes stayed busy after a decision (3 of 10 runs at 320); that is the dropped transition SLN-1141 fixes, and with that fix applied 10 of 10 runs freed them at once.

Rechecked after merging main's reading import focus work (SLN-955, SLN-956), on a production build of main b7a671ce with this change: the same case shows the same reason in all three browsers at 1440, 390 and 320 (9 of 9). Commit was ready again within 0.4 s every time, and the audits report nothing, with no sideways scroll.
