# Task 0925: A person's save over a change from another tab is refused

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0920
**Blocks**: None

## Overview

SLN-1244. With Edit person open in two tabs, the second save wrote back the first tab's old values: tab A set Real name, tab B (opened before A saved) changed Website, and A's Real name was replaced by the earlier value, with "Person updated" in both tabs. The person editor now has the guard Edit work has (0920): a save over a change made since the dialog opened is refused with "This person changed in another tab or window. Reload to see it, then save again.", and the dialog stays open with what was typed.

## Implementation Details

- `personEditFingerprint(id)` and `STALE_PERSON` in `src/lib/catalogue/person-fingerprint.ts`: md5 of the fields Edit person shows and saves (names, gender, nationality, birth and death dates and places, biography, website, Open Library and Goodreads ids). Aliases, photos, credits and the favourite mark have their own controls and do not change it.
- `getPersonEditFingerprint(id)` and `updateAuthor(id, input, fingerprint?)` in `src/lib/actions/authors.ts`: given a fingerprint, the save locks the person and checks it in the same atomic, so two saves of one view never both land. A person deleted or merged away since the dialog opened is refused with "This person no longer exists." rather than told to reload. Saves without one work as before.
- `AuthorEditDialog` reads the fingerprint just before the person when it opens, so a save landing between the two reads makes its save refused rather than let older values through, and sends it with the save. The refusal comes back as a result through `catalogue-ui`, as other refusals do.
- Docs: `docs/06_SERVER_ACTIONS.md` (`updateAuthor`).
- Tests: `src/__tests__/integration/people-credits.test.ts` (a stale fingerprint is refused and changes nothing; the current one saves; an alias leaves it alone; a deleted person is named as gone).

## Completion Notes

The ticket's sequence, on a private preview's production build in Chromium, Firefox and WebKit at 1440: tab A and tab B open Edit person; A sets Real name and saves ("Person updated"); B changes Website and saves. B is refused with the sentence above, its dialog stays open with the typed website, and after a reload A's Real name is stored and the website is empty. The people suite passes with the new test. Review (19 Oct): `updatePerson` no longer takes a fingerprint, since nothing calls it with one; the check before the lock went, so the locked check is the one tested. Alignment, design and overflow audits are clean on the refused dialog in all three browsers at 1440, 390 and 320; page weight passes.
