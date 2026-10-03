# Task 0194: Publisher country links (SLN-330)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0125
**Blocks**: None

## Overview
`publishing_houses.country_id` pointed to the wrong country for 100 houses, while the `country` text was right: 92 "United States" houses linked to "United States Minor Outlying Islands" and 8 "India" houses to "British Indian Ocean Territory". The old import matched the text with "contains" against the formal names in `countries`. 33 more houses with a country text had no link.

## Implementation Details
- `src/lib/utils/countries.ts` (pure): `countryLookup` and `resolveCountry` match a country text exactly against the table's name, its short form before the comma ("India, Republic of" → "India"), the English name of the row's ISO code ("North Korea"), and common forms ("UK", "USA", "England"). A key two rows share decides nothing. With several countries ("United Kingdom; United States", "United Kingdom/India"), the first is the primary one; the text keeps all of them.
- `savePublisher` and the taxonomy engine set `country_id` with it. The old exact-name query matched no formal name ("United States of America"), so the app left most links empty.
- `scripts/ingest/seed_publishers.py`: the "contains" fallback is gone; exact name, short name or a common form only.
- `scripts/publishers/country-links.ts`: re-links every house with a publisher kind from its text. Dry run by default with a report; `--apply` in one transaction, with the old links saved for `--undo`. Organizations without a publisher kind are left alone.
- Docs: `docs/02_DATA_MODEL.md`.

## Completion Notes
- Tests: 15 unit tests (`src/__tests__/utils/countries.test.ts`), 1 PostgreSQL test (save links "United States", "UK", the first of several, and nothing for unknown text). Publisher suite: 55 passed.
- Live dry run: 255 houses; 133 links change and 122 stay. 100 wrong links corrected (91 US, 8 India, 1 "United Kingdom; United States" that pointed to the US islands) and 33 empty links filled (UK 14, US 9, several countries 8, Spain 2). No link is removed.
