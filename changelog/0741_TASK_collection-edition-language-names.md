# Task 0741: An edition in a collection names its language and binding

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Design polish pass 2, finding 4. In a collection of editions, each row's
facts line showed the stored codes: "fr" or "de" for the language, and a
binding such as "saddle_stitch". The book page names them ("French",
"Saddle stitch").

## Implementation Details

- `src/app/(catalogue)/collections/[id]/page.tsx`: an edition's facts use
  `languageName` and `bindingLabel`.
- `src/components/collections/add-books-dialog.tsx`: the edition results
  name the language too.
- Test: `src/__tests__/ui/collection-edition-facts.test.ts`.

## Completion Notes

- A production preview of a disposable seed database, in Chromium, Firefox
  and WebKit at 1440 and 390: Collections and its three collections. The
  alignment and overflow audits are clean. `page-weight.js` passes.
- The seed has no collection of editions, so the new words were not seen in
  a browser. The test pins both lines and the helpers' words ("French",
  "German", "Saddle stitch").
- The build's TypeScript check passes. Lint has no new warnings (the five
  `<img>` warnings are on main too). No migration, no new package.
