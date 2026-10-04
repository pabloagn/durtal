# Task 0284: Catalogue Timing at Scale, and Filter Lists on Demand

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0267
**Blocks**: None

## Overview

SLN-381, the gate task 0267 left open: how the collections behave in a large catalogue. This task adds a way to seed one and to time it query by query, measures a small and a large catalogue against the book pages, and fixes what the numbers showed.

## Implementation Details

- `scripts/qa/seed-large.sql`, run by `scripts/qa/preview-local.py --seed-large N` on a disposable preview: N perfumes (three formulations, a house, two perfumers, twelve positioned notes, two families, some bottles), N films (a director, two screenwriters and 140 cast credits with characters, two cuts, two countries, two languages, a company, two genres, a copy) and N paintings (a museum-owned original with six location records, a painter, a movement, two genres, some reproductions). `max(600, 10N)` people share the credits of all three kinds, with their real domains, as the app records them.
- `preview-local.py --log-sql FILE`: the database bridge appends one JSON line per query (time, rows, text, parameters).
- `scripts/qa/catalogue-timing.mjs`: requests each route twice (first and repeat) and reports server time, HTML size, query count, summed and slowest query time, query texts sent more than twice in one request, and `EXPLAIN ANALYZE` of the slowest distinct queries (`--explain CONTAINER`).
- Fixes:
  - **Filter options load when the filter is about to open** (`src/hooks/use-lazy-options.ts`; pointer over the Filter button, focus, or opening it), no longer with every page. The perfume, film and painting homes stop sending every house, perfumer, director, cast member, painter, venue and term in their HTML. The panel says "Loading filters…" until they arrive, and how to retry if they fail.
  - **A filter group lists at most 200 options at once** (`src/components/shared/filter-dropdown.tsx`), with a line such as "200 of 16,075 shown. Type to narrow."; its search reaches every option, and chosen options always stay listed. This also applies to the book filters.
  - **People counts** for the filters deduplicate (person, work) pairs once and count per person, instead of sorting every credit (`creditedPeople` in `films.ts`; perfumers and painters).
  - **A perfume page no longer re-checks** that the perfume and each formulation exist before reading each formulation's perfumers and classification: it has just read them (two queries fewer per formulation).

## Completion Notes

Disposable restores of the newest live backup (673 books, 2,166 authors), `next dev`, with 50 and with 2,000 records per kind seeded (2,000: 6,000 works, 292,000 credits, 20,000 people, 12,000 location records). Times are the repeat request; the first request of a route in `next dev` sends about twice the queries. The "before" column is main's code with the same seed.

| Route, 2,000 per kind | Before: time, HTML, queries (SQL ms) | After |
|---|---|---|
| `/films` | 302 ms, 1,918 KB, 10 q (288 ms) | 107 ms, 198 KB, 4 q (33 ms) |
| `/films?page=20` | 292 ms, 1,919 KB, 10 q (258 ms) | 112 ms, 199 KB, 4 q (38 ms) |
| `/perfumes` | 191 ms, 622 KB, 9 q (109 ms) | 95 ms, 216 KB, 4 q (25 ms) |
| `/perfumes/seed-perfume-1` | 209 ms, 223 KB, 47 q (204 ms) | 181 ms, 222 KB, 35 q (152 ms) |
| `/paintings` | 126 ms, 380 KB, 10 q (113 ms) | 83 ms, 160 KB, 4 q (23 ms) |
| `/library` (book baseline) | 87 ms, 313 KB, 4 q (22 ms) | 86 ms, 313 KB, 4 q (24 ms) |
| `/authors` (book baseline) | 168 ms, 186 KB, 8 q at 50 per kind | 155 ms, 186 KB, 8 q (159 ms) |

- Opening the filter panel, after: at 2,000 per kind, 305–384 ms for films (6 queries; the director group lists 200 of 2,000), 122–132 ms for paintings, 191–239 ms for perfumes; at 50 per kind, 60–143 ms.
- At 50 per kind the homes were already small (`/films` 279 KB, `/perfumes` 260 KB); the HTML grew with the catalogue only through the filter lists.
- Book pages do not slow down with 20,000 people credited on films, perfumes and paintings: `/library` and `/authors` take the same time as at 50 per kind. (A first seed left every seeded person a book author, as the insert trigger does until the app replaces the domain; `/authors` then took 600 ms. The seed now records each person's real domains, as `createPerson` does.)
- Cache and paging: creating, editing and deleting a perfume, film or painting shows at once in its list, search, favourites and export (`scripts/qa/journeys.mjs`, task 0282). Lists page by number: the count comes first, and a page past the end goes to the last one (task 0266), so an insert moves later rows by one place and none is lost.
- `pnpm typecheck`, `pnpm lint` (0 errors), `python3 scripts/qa/test-local.py` (1,617 tests in 131 files, 0 skipped): pass.
- `node scripts/qa/page-weight.js` on the restore without a seed: 9 of 10 routes within budget; `/library` 313 of 300 KB, as on main.

### Review fixes

- `seed-large.sql` refuses any database but `durtal_preview`, adds a few countries, languages and movements when a fresh database has none, and fails loudly if it links none. On a fresh preview (`preview-local.py --seed-large 5`, no backup) it seeds 15 works with their countries, languages and movements.
- `catalogue-timing.mjs` refuses port 3100 and other hosts, and `--explain` only in a `durtal-preview-*` container. It replays only reads (`select`, `with`), each inside a transaction that is rolled back.
- `--log-sql` creates the log's folder, and a failed log write never breaks the query. `.gitignore` ignores `*.jsonl`: after `--from-dump` the log holds catalogue data.
- The fixed filter groups (such as copies and favourites) show at once; the record lists join them when they load, and stay away if the load fails.
- `src/__tests__/ui/filter-dropdown.test.ts`: one load however often it is started, a new start after a failure, 200 of 250 options with the count line, chosen options kept past the limit, no line when all fit, the load starting on pointer and click, the loading and failure rows.
- `scripts/qa/page-weight.json`: budgets for `/perfumes`, `/films` and `/paintings` (300 KB, 1,000 ms). On a restore with 300 per kind: 216, 197 and 160 KB.
- `alignment-audit.js` and `design-audit.js` with the panel open on the seven pages that use it (`/perfumes`, `/films`, `/paintings`, `/library`, `/authors`, `/places`, `/publishers`) at 1440, 768 and 390 px, and on the three collection homes with the panel loading (slow network) and failed (offline): 0 deviations, 0 low-contrast rows; the count line, "Loading filters…" and the failure row all measured. The design audit counts two unnamed controls on `/authors`: two author card links whose card has no text, the same on main's code, not in the panel.

### Not changed

- **The cast and director counts** still take about 160–190 ms at 2,000 films with 16,075 cast members, now only when the filter panel opens. An index on `work_credits (role_id, person_id, work_id)` would let them read the index alone; it needs a migration, which is left until the pending migrations 0057 and 0058 are on main.
- **Detail pages** send 26–35 queries each, mostly small reads. A perfume still reads perfumers and classification once per formulation (two queries each); one batched read would remove them.
- **`/library`** stays at 313 of 300 KB; that budget is left to the page-speed work.
