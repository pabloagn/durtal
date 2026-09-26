# Task 0142: Recommender pages

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0141
**Blocks**: None

## Overview

SLN-329: Recommenders get their own pages, structured like authors but without poster or cover images: a list to browse, search and add them, and a page per recommender with every book they recommended, plus edit and delete.

## Implementation Details

- Server (`src/lib/actions/recommenders.ts`): `getRecommenderList` (shared search engine from 0141: accents, typos, ranking; sort by name, books, recent), `getRecommender` (books shaped like an author's works, by title), `createRecommender`, `updateRecommender`, `deleteRecommender` (links removed, books kept). Names must be unique ignoring case and accents. Create and update return `{ ok, error }` instead of throwing, because production hides thrown server-action messages. Every change invalidates the recommender cache, so the book edit dropdowns update at once (before, nothing ever refreshed that one-hour cache).
- Validation (`src/lib/validations/recommenders.ts`): name required; website trimmed, `https://` added when missing, `http` upgraded, other schemes and credentials refused.
- `/recommenders`: shared toolbar (search as you type, Best match/Name/Books/Recent, grid/list, size), cards and list rows with website and book count, Add Recommender dialog, shared empty/no-results/pagination states.
- `/recommenders/[id]`: author-style header (name, website, book count, menu with Copy Name / Edit / Delete), then the recommended books in the shared book grid with pagination, and a clear empty state.
- Sidebar and command palette entries. On book pages, "Recommended by" names open the recommender page; a small icon still opens their website.
- The add/edit form turns off the browser's own URL check (it blocked "youtube.com/@…" before our check could add `https://`) and puts the cursor in Name when it opens.
- No schema change.

## Completion Notes

- Unit tests for website rules and input; PostgreSQL tests for create (normalized website, cache refresh), duplicate names by case/accents on create and rename, invalid input writes nothing, delete keeps books, search with accents/typos, book-count sort, and the book list with authors and posters.
- Full suite with every database suite: 524 passed. Typecheck, lint, production compile pass.
- Browser check on a throwaway preview database: list, detail, edit (name and website without `https://`), add with redirect, duplicate refused with a message, delete back to the list, book page links, and the edit dropdown showing renamed/deleted recommenders at once.
