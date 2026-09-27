# Task 0145: Collection icons

**Status**: Completed
**Created**: 2026-09-27
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0139
**Blocks**: None

## Overview

SLN-336: each collection can have an icon, picked from Lucide, the line icon set the app already uses (`lucide-react` 1.7.0, 1,694 icons, ISC license, free). The icon is the collection's identity, in addition to its poster and background. It shows to the left of the collection name.

## Implementation Details

- Migration `0031_collection_icon`: `collections.icon text` (nullable). It stores the PascalCase key of `lucide-react` `icons`, e.g. `BookOpen`.
- `setCollectionIcon(id, icon | null)` in `src/lib/actions/collections.ts`: stores only real Lucide names.
- `CollectionIconPicker`: the icon button beside the collection name. It opens a Linear-style panel: search ("Search 1,694 icons", Enter picks the first match), 56 suggested icons for a library, then all icons, and "Remove". Escape or an outside click closes it.
- The panel (`icon-picker-panel.tsx`) holds the whole icon set and loads only when it opens.
- `CollectionIcon` renders a chosen icon on the server, so pages show it at once and ship no icon set. `CollectionIconLazy` is the client version; it loads the set only when an icon must show.
- Icons show on the collection page header (28px, 1.5px line), collection cards (collections grid, book page) and the add-to-collection dialog.

## Completion Notes

- PostgreSQL test `collection-icon.test.ts` (`sln336_test`): set, change, clear, read back; rejects unknown names, prototype keys, long names, bad ids and missing collections. `collection-media-migration.test.ts` now allows later collection columns.
- Full suite with all database suites: 549/549. Typecheck and lint pass.
- Browser check on a local copy of live data with `0031`: the picker opens, search finds 2 "flame" icons, Enter saves Flame; the header, the collections grid card and the add-to-collection dialog show it.
