# Task 0402: Add to collection finds works by author, and opens on Books

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-554. In the "Add to collection" dialog, the Books, Films, Perfumes and Paintings tabs searched only titles. A search for "huysmans" in Books showed "Nothing matches". The dialog also opened on the Editions tab.

## Implementation Details

- `searchWorksForCollection` (`src/lib/actions/collections.ts`) searches one text made of the normalized title and every creator: all name forms of each author (`authors.search_text`), and the director, perfumer or painter credits (the person's names, or `credited_as` when the credit has no person). Each query word may match any part, so "huysmans damned" finds "The Damned".
- `src/components/collections/add-books-dialog.tsx`: the tabs are Books, Editions, then the other kinds. The dialog opens on Books each time. The placeholders say "Search title or author…" (director, perfumer, painter). The empty message says "Try another search".

## Completion Notes

Checked in the live dialog on :3100 against counts worked out in SQL:

| Tab | Query | Before | After |
|---|---|---|---|
| Books | huysmans | 0 | 3 (Against Nature, Domesticity, The Damned) |
| Books | Joris-Karl Huysmans | 0 | 3 |
| Books | huysmans damned | 0 | 1 (The Damned) |
| Books | Péter Nádas | 0 | 2 (A Book of Memories, Parallel Stories) |
| Books | huysmanns (typo) | 0 | 3 |
| Books | nature (title, control) | 1 | 1 |
| Perfumes | kurkdjian | 0 | 1 (Baccarat Rouge 540) |
| Editions | huysmans (control) | 3 | 3 |

Gates: `pnpm typecheck` passes; eslint has no errors; `pnpm test:local` 287 files, 3130 tests pass; alignment audit on the open dialog checks 35 icons with 0 issues; `node scripts/qa/page-weight.js` passes.

The library has no films or paintings yet, so the director and painter searches were checked only for their placeholders.
