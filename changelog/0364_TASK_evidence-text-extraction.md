# Task 0364: Evidence text extraction switched on

**Status**: Completed
**Created**: 2026-10-07
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0355
**Blocks**: None

## Overview

SLN-468 follow-up. The evidence store (0355) keeps the main text of each page
it fetches, so the research agent can quote from it and every quote can be
checked character for character (R3). Its extractor refused until Joris
approved two packages. He approved them on 7 Oct ("Yes all three"): this task
installs them and switches the extractor on.

## Implementation Details

- Dependencies, pinned: `@mozilla/readability` 0.6.0 (Apache-2.0) and
  `linkedom` 0.18.13 (ISC).
- `extractMainText(html, url)` (`src/lib/enrichment/extract.ts`) parses the
  page with linkedom and runs Readability on it. The main text is Readability's
  content, read out paragraph by paragraph: each block element (paragraph,
  heading, list item, quote, table cell and the like, and each line break)
  starts a new paragraph, white space inside a paragraph is collapsed, and the
  paragraphs are joined by a blank line. The store then saves it in Unicode
  NFC, as before. Menus, scripts and footers are left out by Readability.
- The title, byline, publication date and language come from Readability; the
  language falls back to the page's `lang`. The canonical URL comes from
  `<link rel="canonical">`, read before Readability changes the document, and
  is resolved against the page's URL; one that cannot be read is null.
- A page without its `<html>` element, or without its `<body>` element, is read
  as a browser reads it: linkedom builds neither, so the fragment is wrapped,
  and what follows a missing `<body>` is moved into the empty one linkedom
  adds. An empty page gives nothing, which the store refuses as "The page has
  no main text".
- `mainTextExtractor` is named `readability`, version `@mozilla/readability
  0.6.0, linkedom 0.18.13`. Each stored page's payload records it, so a quote
  can be traced to the code that cut its text.
- `scripts/enrichment/evidence.ts --fetch` already used `mainTextExtractor`: it
  now stores pages instead of refusing.
- Docs 02 (the extractor in the evidence payload's description).

## Completion Notes

- Unit `src/__tests__/enrichment/extract.test.ts` (5): a review page keeps its
  four paragraphs and leaves out the menu, script and footer; its title,
  byline, date, language and canonical URL; a fragment and a page with no
  `<body>`; an empty page and an unreadable canonical URL; the extractor's
  version string matches the pinned versions in `package.json`.
- Database suite `evidence-store.test.ts`: a new case stores a real page
  through `storeEvidencePage` with `mainTextExtractor`. The stored text reads
  back as the article's two paragraphs, and the payload names the extractor.
  15 tests pass.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 253 files, 2,818 tests, all passed.
