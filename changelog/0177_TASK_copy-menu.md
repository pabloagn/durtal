# Task 0177: Copy menu (Y)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0176
**Blocks**: None

## Overview
Y opens a "Copy" menu with what the open page offers. Y then N copies the page's name: a book's title and author, an author's name, a publisher's, series', collection's, place's or recommender's name. Y then T copies a book's title, Y then I its ISBN, Y then D a place's address, Y then L the page link (every page).

## Implementation Details
- Keys: `COPY_KEYS` in `src/lib/shortcuts/shortcuts.ts`; the same key means the same thing on every page. The shortcut sheet has a "Copy" group.
- Pages give their entries with `<CopyShortcuts name title isbn address />` (`src/components/shortcuts/copy-shortcuts.tsx`, renders nothing), on the book, author, publisher, series, collection, place and recommender pages. An entry without text is not offered.
- Book name: `formatBookClipboardText()`, the same text as the page's Copy button ("Brave new world, Aldous Huxley"). Book ISBN: the first edition shown that has one, its ISBN-13 when it has one.
- The menu shows what each entry copies, in small muted text on the label's baseline. A toast confirms the copy and shows the text.
- Copy uses the clipboard API, and the older copy command where the browser refuses the clipboard API.
- The command palette lists the page's copy entries under "This page" (always when searched; with an empty search only on pages that have their own entries).
- Page entries live in a ref in `ShortcutsProvider`, not in state: state made the context change on each registration, and the pages registered again in a loop (found in the browser before commit).

## Completion Notes
- Browser on :3100, real key presses: on Brave New World, Y shows Name, Title, ISBN (9780099518471), Link; I and N copied the right text (toast and copy event). Author page: Name, Link. Place page: Name, Address, Link. Library list: Link only. No console errors across page changes.
- Alignment: menu icons and key caps 0 px off the label's line center; preview text 0 px off the label's baseline.
- Typecheck, lint and all 604 tests pass.
- The name key is N ("yank name"), at the owner's request; it was A in the first version.
