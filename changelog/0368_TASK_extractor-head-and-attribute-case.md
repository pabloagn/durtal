# Task 0368: The extractor reads a page with no head tag, and attributes in any case

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0364
**Blocks**: None

## Overview

A follow-up to 0364 (PR #145), from Review's patch for two rare page shapes.
A page that leaves out its `<head>` or `<html>` tag lost its title, and an
old page with attribute names in capitals let readers' comments into the
main text, where the research agent could quote one as the outlet's.

## Implementation Details

All in `extractMainText` (`src/lib/enrichment/extract.ts`):

- **No `<head>` or `<html>` tag.** Both are optional in HTML. linkedom adds
  an empty `<head>` and `<body>` and leaves the page beside them, and 0364
  moved all of it into the body, the `<title>` included. Now the title,
  meta, link and base elements go to the head, as a browser puts them, and
  the rest to the body. A page with no `<html>` element is wrapped in
  `<html>` only, with its doctype removed, so its own `<head>` and `<body>`
  keep their places.
- **Attribute names in capitals.** HTML reads attribute names in any case,
  but linkedom keeps them as written, so Readability could not see
  `CLASS="comments"`, and the canonical link and language were missed. Each
  attribute name with capitals is now lowercased after parsing, outside SVG
  and MathML, where case matters (`viewBox`).

## Completion Notes

- `src/__tests__/enrichment/extract.test.ts`, two new tests from Review: three
  pages that leave out their `<head>` or `<html>` tag keep their title and
  canonical URL, and the heading that repeats the title is dropped; a page
  written in capitals keeps its language and canonical URL and leaves out its
  comments. Both fail on main's code and pass with the fix. 7 tests pass.
- Review ran Readability's own 128 test pages with the patch: the same words
  as without it on every page.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 257 files, 2,869 tests, all passed.
