# Task 0926: Search finds names and titles in every script

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-1228

## Overview

SLN-1234, from findings/intl-text-survey-2026-10-19.md. The palette found nothing for "한강", "채식주의자" or "猫である", Books found no book for "Достоевский", and People found no one for "प्रेमचंद". The query was folded in the browser by stripping every combining mark before it reached SQL: Hangul broke into jamo, "で" became "て", "й" became "и" and Devanagari lost its signs, while `search_normalize()` folds the stored text differently, so the two never met. One Chinese or Japanese character ("猫") found nothing in the palette, which waited for two characters, and "🦉" folded to nothing and listed unrelated e-books.

## Implementation Details

- `searchWords(query)` in `src/lib/utils/search-text.ts`: the query's words as typed (NFC, split on spaces, punctuation and symbols; a piece with no letter or digit is dropped). `textSearchCondition` and `textSearchRank` (`src/lib/actions/utils/text-search.ts`) take their words from it, and `search_normalize()` folds each word in SQL as it already did, now from the same text it folds on the stored side. This path serves the palette, Books' author match, people, organizations, places, series, collections, recommenders, taxonomy and notes.
- The highlights search (`src/lib/ebooks/highlights.ts`) compared the browser fold with `search_normalize()` of the text too; it now sends `words` and folds each in SQL. The pattern is still a constant to the planner, so the trigram index applies as before.
- `isSearchableQuery(query)`: the palette (`command-palette.tsx`) and `quickSearch` search on two characters, or one Chinese, Japanese or Korean character, and never on symbols or punctuation alone. `searchScore` matches nothing for such a query, so the palette's own entries don't all show for "🦉".
- `normalizeSearchText` is unchanged. The ticket suggested recomposing it, but e-books store its output as their search text (`ebooks.search_text`) and compare queries with it, so changing it would part new queries from stored rows until a backfill. It is no longer used against `search_normalize()`; its comment and docs/02 now say so. `search_normalize()` is unchanged (Arabic and Hebrew points are SLN-1235).
- Docs: `docs/02_DATA_MODEL.md` (search normalization).
- Tests: `quick-search.test.ts` (한강, 채식주의자, 猫である, 猫, Достоевский, प्रेमचंद, Nádas through the palette, Books' condition and People's; ё, Greek accents, Turkish İ and ı and Latin accents fold as before; "🦉" and "a" search nothing), `ebook-highlights.test.ts` (Korean, kana and Cyrillic in a highlight and its note), `search-text.test.ts`, `highlights-params.test.ts`, and `domain-search.test.ts` (a query of "%%" returns the empty result early).

## Completion Notes

The new database test fails on main and passes here. On a private preview's production build with nine books imported through the app, in Chromium, Firefox and WebKit: the palette finds 한강 (her book and her), 채식주의자, 猫である and 猫 (吾輩は猫である), Достоевский (both books and him), प्रेमचंद (गोदान and him), ελυτης and "istanbul hatirasi"; "🦉" shows nothing. /library?q=Достоевский lists both books and /people?q=प्रेमचंद finds him. Alignment, design and overflow audits are clean on the palette, Books and People at 1440, 390 and 320; page weight passes. The search suites (domain, people, e-books, authors, series, collections, publishers, recommenders, taxonomy, notes) pass.

"كِتَابُ" typed with its points still finds a different book: that needs `search_normalize()` to drop the points, a migration (SLN-1235).
