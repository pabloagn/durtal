# Task 0393: Browser Journeys for Collecting, Books and Cross-Kind Cases

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0282
**Blocks**: None

## Overview

SLN-516, what task 0282 (SLN-379) left out of the browser journeys: collecting
perfumes, films and paintings (collections hold them since SLN-362), the book
flows, and the cross-kind cases. `scripts/qa/journeys.mjs` gets three journeys,
`collect`, `books` and `kinds`. Like the others they run against a disposable
database only.

## Implementation Details

`scripts/qa/journeys.mjs`:

- **collect**: adds a perfume, a film and a painting; collects the perfume
  into a new collection from its Actions menu (Create & add), then the film
  and the painting into the same one; on the collection's page the three show
  in the order added; moves the painting earlier, and the order holds after a
  reload; removes the film, which leaves the collection and keeps its page;
  deletes the collection and the three records.
- **books**: adds a publisher (`/publishers/new`); adds a book through the
  add-book wizard with an author, a series (position 1), an edition with an
  ISBN-13 and that publisher, and a hardcover bought from a shop with its
  price; the book's page shows all of them; the series and the publisher's
  page list it; adds a second edition and a paperback copy of it from the
  book's page. Then acquisition: a wanted book through the wizard (Fast
  Track), hunted in that publisher's edition (Hunting for, Add target); its
  edition added; ordered from the hunt's Order link with that edition named;
  marked delivered in the provenance pipeline. The hunt then reads received
  and the book Accessioned. Deletes the two books.
- **kinds**: one person writes a book, directs a film, makes a perfume and
  paints a painting, each chosen or created in the record's own form, and
  their page lists all four under Books, Films, Perfumes and Paintings. The
  perfume gets two formulations and a 2 ml sample of the Extrait. The film
  credits a performer as "The Twin / The Double", and both characters show in
  its cast; it gets a director's cut with its own runtime. The painting's
  original is owned by a museum and lent to a kunsthalle for an exhibition,
  and a museum poster reproducing it shows under Reproductions, not with the
  original. Deletes the sample and the reproduction (each holds its record),
  then the film, the perfume, the painting and the book.
- Without a journey name the script runs every journey that needs no seed:
  perfumes, films, paintings, collect, books and kinds. `reading` and
  `import` still need their seed and run only by name.
- Shared helpers: fill a field or pick from a list by its label, pick or
  create in a search picker, add and delete a record, delete a book, read a
  toast. The collection journeys' create and delete steps use them; what they
  check is unchanged. A menu item is clicked inside the open menu, so the
  Collections item is not taken for the sidebar's Collections link.
- The people, the publisher, the series and the venues a run makes stay in
  the disposable database; every name carries the run's stamp, so runs do not
  collide.

```bash
python3.12 scripts/qa/preview-local.py --start --seed-large 50
node scripts/qa/journeys.mjs --disposable http://127.0.0.1:3410
node scripts/qa/journeys.mjs --disposable http://127.0.0.1:3410 collect books kinds
```

## Completion Notes

Built and run in a cloud container, on main 23e1e798:

- `node scripts/qa/journeys.mjs --disposable http://127.0.0.1:3410` on a
  production build with a disposable database and the synthetic catalogue
  (`preview-local.py --start --seed-large 50`): all six journeys pass.
  No journey record is left in the library, perfumes, films, paintings or
  collections afterwards.
- `pnpm typecheck` clean; `pnpm lint` 0 errors, 77 warnings, as on main;
  `pnpm deadcode` clean; `scripts/qa/test-local.py` 2,958 of 2,958, none
  skipped. No page changes, so no page audits.
- Not run here: on a restore of the newest backup (the cloud has no backups).

### Found, not changed

- The collections dialog says "Collection created and books added" when it
  creates a collection from a perfume, a film or a painting, and deleting a
  collection says "Collection deleted. Books remain in your library." whatever
  it held.
- As task 0282 found: a deleted or mistyped perfume, film or painting address
  shows its not-found view with status 200, not 404, because those segments
  stream through `loading.tsx`. Readers see the right page.

### Not covered

- The reader, API and harmonization flows that 0282 also listed: SLN-516 asks
  for book entry, edition and copy, series, publisher and acquisition only.
