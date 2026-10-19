# Task 0966: Titles and names without invisible characters

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
A title or name pasted from a web page or an e-book can carry characters that show nothing: a soft hyphen, a zero-width space, a byte order mark, bidi marks. Kept, "Ver­schwinden" never matched a search for "verschwinden", and duplicate checks missed it and saved a second record. Search also kept ligatures ("ﬁ") and fullwidth letters ("Ｈｕｘｌｅｙ") as they were. This is the JS half of SLN-1393. The SQL half (`search_normalize`) rides in SLN-1235's text-folding migration.

## Implementation Details
- `src/lib/utils/clean-text.ts` (new): `cleanText` strips the invisible format characters and returns NFC.
  - Stripped: U+00AD, U+200B, U+200E-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+206F and U+FEFF. The direction marks and isolates (LRM, RLM, U+202A-U+202E, U+2066-U+2069) go too: in a title or name they change nothing a reader sees, and search ignores them either way.
  - The zero-width joiners U+200C and U+200D stay, because Persian, Indic scripts and emoji need them. This differs from the ticket's "and joiners" for stored text only; search drops them (below). The Mongolian vowel separator (U+180E) stays as well, because it shapes the letters around it (review of #576).
  - No-break spaces stay: search folds them as spaces on both sides.
- `src/lib/validations/helpers.ts`: `cleanString()` is `z.string().overwrite(cleanText)`, so `.trim()`, `.min()` and `.max()` check the cleaned text.
- Titles and names in the shared schemas use it: works, editions, authors and people (aliases included), series, publishers and organizations (with aliases), films, paintings, perfumes, venues, places, locations, collections, taxonomy items and families, and recommenders.
- The duplicate checks clean what they are given, so a pasted name finds the clean record it repeats: `findNamedDuplicates` (the same-name warning when adding), `findOrCreateAuthor` and `findDuplicateWork`. The SQL `search_normalize` doesn't strip these characters yet, so cleaning the input is what makes them match.
- `src/lib/catalogue/book-store.ts`: `bookAuthorFor`, which Fast Track, the wizard and orders use for a typed author, matches and stores the cleaned name. `validations/fast-track.ts` cleans its own title and author, and the wizard's author and an order's new book (`actions/orders.ts`) are cleaned in their schemas, so a name of only invisible characters is refused as missing rather than saved empty (review of #576).
- `src/lib/ebooks/ingest/metadata.ts`: e-book ingest's `clean` (titles, subtitles, authors, series, publisher) applies `cleanText`.
- `src/lib/utils/search-text.ts`: `normalizeSearchText` folds compatibility forms with NFKC before it strips accents. It also drops every format character (`\p{Cf}`, joiners included) instead of turning it into a space.

## Completion Notes
- `src/__tests__/utils/clean-text.test.ts` (new):
  - Each stripped character goes, and the rest of the text stays as typed.
  - The joiners stay, and decomposed letters compose.
  - Work, author, edition and series schemas store the clean title or name.
  - A title of only invisible characters is refused as "Title is required".
- `search-text.test.ts`: "Ver­schwinden" with each format character normalizes like "Verschwinden". "ﬁ" matches "fi", and fullwidth matches plain.
- `ebooks/ingest/metadata.test.ts`: e-book titles and names lose the characters.
- `integration/duplicate-names.test.ts` (PostgreSQL 16): "W.\u00a0G.\u200b Se\u00adbald" finds W. G. Sebald as a same-name person, `findOrCreateAuthor` reuses him, and `findDuplicateWork` finds The Rings of Saturn by a pasted title. A new author typed with a soft hyphen is stored without it.
- `integration/fast-track.test.ts` (PostgreSQL 16): Fast Track stores a pasted title and author clean, and `bookAuthorFor` matches a pasted name to the clean author and creates a new one clean.
- Mutation checks: without the schema overwrite, 2 schema tests fail; without the ingest clean, the metadata test fails; without the three duplicate-check changes, the integration test fails.
- Text already stored keeps its characters; no backfill. No migration, no new package.
