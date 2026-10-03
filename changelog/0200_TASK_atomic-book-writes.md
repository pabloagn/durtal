# Task 0200: Atomic Book Writes and the One-Write Wizard (SLN-281)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0103 (the reverted transaction attempt), 0197 (SLN-365)
**Blocks**: SLN-366, SLN-367, SLN-368 (new domain services follow this shape)

## Overview
Adding a book wrote its rows one call at a time. The wizard made up to eight
server calls (author, work, taxonomy, edition, each copy, each collection), so
a failure halfway left an author with no book, a book with no edition, or an
edition with half its copies. A new edition, Fast Track, and an order for a
book not yet in the library had the same gaps, and a new author got its slug
in a second write.

Each of these now saves in one transaction: everything is checked and planned
first, then one `atomic()` batch writes every row and its activity. A failure
writes nothing and deletes the cover that was uploaded for it.

This ports the old `SLN-281` branch (d0c7b7b, 112 commits behind) onto the
current code instead of merging it. The atomic helper, taxonomy saves,
`setActiveMedia`, venue writes and the author merge were already atomic.

## Implementation Details

**Plans** (`src/lib/catalogue/book-store.ts`): each plan decides ids and slugs
before the write and returns the queries to run inside the batch.
- `bookAuthorFor(name)`: the author with that name, or a planned new one
  (sort name, unique slug).
- `resolveBookCredits(entries, known)`: credits by `authorId` or by
  `authorName`; names are matched without case, accents or punctuation, and
  repeated names or credits are kept once.
- `planBookWork(input, primaryAuthorName)`: the work, series, authors,
  subjects, recommenders and the `work.created` activity.
- `planBookEdition(input)`: uploads the cover under the new edition's id, then
  the edition, publishers, contributors, genres, tags and
  `work.edition_added`; `discardCover()` removes the cover after a failure.
- Shared helpers: `uniqueSlug()` (`src/lib/catalogue/slugs.ts`),
  `workTaxonomyQueries()` (`src/lib/catalogue/work-taxonomy.ts`, also used by
  `updateWorkTaxonomy`), and `lockCollection` / `addMembers`
  (`src/lib/collections/members.ts`, moved from the collection actions).

**The wizard** (`src/lib/actions/wizard.ts`, `src/lib/validations/wizard.ts`):
- `createBookFromWizard(input)` takes the whole book: author name, work or
  `existingWorkId`, taxonomy, edition, up to 50 copies, collections. It checks
  the ISBN, locations, collections and the existing book, plans the rows,
  then writes author, work, taxonomy, edition, copies, collection links and
  activity in one batch. It returns `{ ok: false, error }` instead of
  throwing, because production hides a thrown message.
- `isIsbnInUse(isbn13)`: the edition step checks the ISBN before it moves on,
  and shows "Another edition already has this ISBN (…)" on the field.
- `src/app/library/new/wizard.tsx` makes one call on submit.

**Other writes**:
- `createWork` and Fast Track use the same plans.
- `createEdition`: duplicate ISBN check, credits by name, one batch.
  `updateEdition`: the row, publishers, credits (with new authors), genres and
  tags in one batch. The edition dialogs send a new contributor's name
  instead of creating the author first, and the add dialog warns when the
  cover could not be downloaded.
- `createAuthor` and `updateAuthor` write the slug with the row.
- Orders: `createOrder`, each status change and `deleteOrder` write the order
  and its history together. A status change is refused when the order moved
  since it was read. New `createOrderForNewBook` writes author, book (on
  order) and order in one batch. The order dialog keeps a typed book as a
  draft ("Select new book") until submit, so a cancelled dialog writes
  nothing.

**Layout** (the wizard page, found by the 390px audit): the six step labels
need about 600px and made the page scroll sideways on a phone. Below 640px the
wizard shows "Step 3 of 6 — Edition" and a bar, as the order dialog does. The
step footers wrap like the Details footer instead of breaking button labels.

**Left as is**: the work edit dialogs still create an author when the user
asks for a new one; that is an explicit action of its own. `updateEdition`
uploads a changed cover before its batch, so a failed save can still replace
the stored cover (as before). `deleteOrder` writes a history row that the
order's delete then removes by cascade (as before).

## Completion Notes
- Tests: `src/__tests__/integration/atomic-book-writes.test.ts` (14, on a
  disposable local database): the full wizard save, author reuse, duplicate
  ISBN, a late failure on the second copy (no rows, cover deleted), a cover
  that cannot be downloaded, an edition for an existing book, credits by
  name, edition saves, author slugs, and orders including the stale status
  guard. `src/__tests__/validations/wizard.test.ts` (4).
  `book-saves.test.ts` now checks activity rows, not a mock.
- Browser, on a copy of live data: a duplicate ISBN stops the edition step;
  a full wizard save created the book, edition, copy, collection link and
  four activity rows with the existing author; a cancelled order draft wrote
  nothing, a completed one wrote author, book, order and history; an edition
  with a duplicate ISBN and a new translator wrote nothing.
- Alignment and design audits: the wizard steps and the order dialog at 1440,
  768 and 390px; no deviation, no low-contrast text, no sideways scroll.
- No migration.
