# Task 0137: Goodreads and StoryGraph links on each book

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-322: Store a Goodreads link and a StoryGraph link for each book, edit them in the book edit menu, and open them with one click from compact icons on the book page, beside the Rare indicator.

## Implementation Details

- Schema: `works.goodreads_url` and `works.storygraph_url`, nullable TEXT. Work-level, so every edition shares them. Migration `0028_book_links` adds the two columns only. `docs/02_DATA_MODEL.md` updated.
- `src/lib/validations/book-links.ts`: `parseBookLink` trims input, adds `https://` when the scheme is missing, upgrades `http`, and rejects other schemes, credentials in the URL, and hosts outside `goodreads.com` / `thestorygraph.com` (subdomains allowed). Empty input clears the link. `createWorkSchema` and `updateWork` both enforce it before any write.
- `src/components/books/book-links-fields.tsx`: shared "Book Links" section, placed right after Core Details in both edit dialogs (book page and library card quick edit). Errors show after a field loses focus; Save refuses invalid links with a toast.
- `src/components/books/book-links.tsx`: 28px icon links (`g` and `SG` monograms) beside the Rare toggle. They open in a new tab with `noopener noreferrer`. Stored values are checked again before render. No icon when a field is empty.
- Older migration rehearsals (0026, 0027) now assert that every existing `works` value survives with `toMatchObject`, so later added columns do not break them.

## Completion Notes

- 23 unit tests for the link rules and schemas.
- 4 PostgreSQL tests on a disposable database: canonical save, clearing one link, untouched links on unrelated edits, and rejected input writing nothing.
- Migration rehearsal on a disposable database: a populated 0027 catalogue upgrades with two null columns and no other change; re-running is a no-op.
- Browser check on a disposable preview: icons render with correct targets; a wrong-site link shows an inline error and blocks Save; a bare `goodreads.com/...` link saves as `https://goodreads.com/...`; clearing StoryGraph removes its icon; quick edit loads and saves links.
- The live database needs migration 0028 before this code runs there.
