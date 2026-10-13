# Task 0521: An edition's cover from its own dialog, and the book's cover in one click

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-638. An edition's cover could only be set by typing an address in Edit
edition, and adjusted only when it already had one. Now a Cover button on
the edition card opens "Edition cover": choose or drop an image (an
address is optional), use the book's cover, put the edition's own cover
back, or adjust it. No migration: the edition keeps its two cover keys, and
"the book's cover" is what the edition shows with none, as before.

## Implementation Details

- `src/app/(catalogue)/library/[slug]/edition-cover-dialog.tsx`: the dialog.
  It replaces the lone "Adjust edition cover" button on the edition card. It
  shows the current cover and its source, and the book's beside an own
  cover. "Or paste image URL" matches the book's media dialog; with an
  address typed, Esc asks first and Save adds it.
- `src/components/media/upload-zone.tsx`: an optional `send` target
  (`UploadTarget`: a file and an address) for an image that is not a media
  row. Without it the zone posts to the media routes as before.
- `src/app/api/editions/[id]/cover/route.ts`: POST, a multipart file or JSON
  `{ imageUrl }`. 400 for bad input, 404, 409 when the edition changed, 422
  when the image cannot be read.
- `src/lib/catalogue/edition-cover.ts`:
  - `replaceEditionCover` reads the edition, stores the image as a new
    immutable attempt (`allocateCoverStage` with the new `upload` source:
    the file's SHA-256 and size; an address goes through
    `processAndUploadCover`), then writes the keys, source and palette in
    one write guarded by the edition snapshot. A refused or uncertain write
    keeps the attempt (`retainCoverAttempt`); nothing is deleted.
  - `switchToBookCover` clears the own keys and palette in the same guarded
    way and returns the own cover it replaced. Its images stay stored.
  - `restoreEditionCover` puts an own cover back, only while the edition
    shows the book's cover, only for keys in the edition's own folders
    (`isOwnEditionCoverKey` in `src/lib/s3/keys.ts`), and only when both
    images are still stored. The palette is read again from the thumbnail.
- `src/lib/actions/edition-cover.ts`: the server actions `showBookCover` and
  `restoreOwnCover` (strict schema of the three cover fields).
- Shared asset safety (SLN-572's rule): the book's poster is never copied
  into the edition, and no change deletes an image.

## Completion Notes

- Built from a handed-over draft from the quick-wins thread, applied by
  hand, then finished: "Or paste image URL", the Esc question for a typed
  address, tests and docs.
- Tests:
  - `src/__tests__/integration/edition-cover.test.ts` (disposable
    `sln638_test`, real images, a fake bucket that refuses unconditional
    writes): a file and an address; an unreadable image; the edition
    changed meanwhile; switching to the book's cover and back; foreign,
    climbing and missing keys refused; a sibling edition untouched; the
    route's statuses.
  - `src/__tests__/s3/keys.test.ts`: `isOwnEditionCoverKey`.
  - `src/__tests__/s3/cover-stage.test.ts`: the upload source needs its hash
    and size.
- Not in this task: an own adjustment of the book's cover for one edition
  (the book's cover is adjusted on the book), and a cover picker inside Add
  and Edit edition, which keep their address field.
- Docs: `docs/04_ROUTES_AND_VIEWS.md` (edition card), `docs/05_API_REFERENCE.md`.
