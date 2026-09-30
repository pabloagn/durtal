# Task 0170: Edition covers, publisher search box, language codes

**Status**: Completed (live migration 0035 not applied yet)
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0125
**Blocks**: 0171

## Overview
Step 1 of the publishing houses and editions rework. Before this task:
- The publisher page and the edition card showed only the edition's own cover. 222 placeholder editions (`phantom_canon`) have no cover, so their books showed "No cover", although the book had a poster. The edition card showed no image at all.
- The publisher link box was a text box that filtered a closed drop-down list. Typing showed nothing. It had no accent or typo search and could not create a house.
- Languages were free text: `en`, `eng`, `English`, `fre` and `fr` side by side.

## Implementation Details
- One image rule for an edition: its cover, else the book's active poster (with its crop and adjustments), else "No cover". `src/lib/utils/edition-image.ts`, `src/components/books/edition-cover.tsx`. Used on the edition card (cover on the left) and the publisher page (`getPublisherCatalogue` returns the poster).
- Publisher search box (`src/components/publishers/publisher-picker.tsx`): results show as you type, from the server (`searchPublisherOptions`: the publishers list search engine, names and aliases, accents and typos), arrow keys and Enter, Escape clears. `allowCreate` adds "Create publisher “…”" (`createPublisherFromName`). `PublisherChoice` holds one house; `PublisherChip` shows a chosen house. Hook: `src/hooks/use-publisher-search.ts`. The book page and the publisher editor no longer preload every house.
- Used in the edition link box, the edition form ("Choose publisher identities manually"), the wanted-edition form and the imprint parent in the publisher editor.
- Link box: when one house is chosen and the edition's publisher or imprint text matches no house, a checkbox saves that text as an alias of the house. The count of other unconfirmed editions with the same text is shown. `getUnmatchedEditionNames`; `setEditionPublisherLinks(editionId, ids, aliases)` refuses a name that already matches a house (it would make that match ambiguous), a name the edition does not carry, and an alias with two houses.
- Languages: migration `0035_language_codes` adds `language_code(text)`, `stored_language(text)` and BEFORE triggers on `editions.language` and `works.original_language`, and converts existing values. Stored form: ISO 639-1, else ISO 639-3. `src/lib/utils/language.ts` converts values from metadata sources in the app (Match, the add-book wizard) and shows English names. The edition form uses the language list.
- Shared pagination icons now sit on the cap-height center of their labels (`CapAligned`). They were 0.61px off where the text snapped to a half pixel.
- `docs/02_DATA_MODEL.md` updated.

## Completion Notes
- Live data before: 636 editions, 115 with a house. Languages: `en` 611, `eng` 14, `English` 2, `fre` 1, others 8.
- On a local copy of live data after migration 0035: `en` 629, `es` 5, `fr` 3, `ja` 1 (638 editions). Works: `en`, `es`, `fr`, `ru` only.
- Browser checks on the local copy: search finds NYRB from "new york rev" and Vintage from "vintge"; Enter picks and never submits the form; creating a house from the edition form works; saving the alias from the link box on "Idiocy" linked 20 more editions to NYRB (NYRB: 2 → 23 books). Placeholder editions show the book poster.
- Alignment audit: 0 deviations over 0.5px on the book page (with the link box and the edit dialog open), the publisher page, the publisher editor and the add-book wizard. Checkboxes: 0.01px.
- Tests: `src/__tests__/utils/language.test.ts`, `edition-image.test.ts`; publisher database tests for search, create, aliases and language codes. Full suite: 696 passed.
- Migration 0035 is not applied to the live database. It needs approval.
