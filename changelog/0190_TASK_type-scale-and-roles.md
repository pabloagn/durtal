# Task 0190: One type scale, type roles and SectionHeading

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0181, 0186
**Blocks**: None

## Overview

SLN-389. The app rendered 14 font sizes (8 to 58px across pages), titled sections at 21, 24 or 30px depending on the page, gave cards 18, 21 or 24px titles, and used 39 heading and 17 label class sets. Now there is one scale of seven sizes, one role per job, and one component for section titles.

## Implementation Details

- `src/styles/globals.css`: `--text-*: initial` clears Tailwind's sizes; the scale is 12 (`micro`), 14 (`xs`), 16 (`sm`), 21 (`lg`), 30 (`2xl`), 38 (`3xl`), 46px (`4xl`). `text-base`, `text-xl`, `text-5xl`, `text-nano` and arbitrary sizes no longer generate CSS.
- Roles (`@utility`): `type-page-title`, `type-section-title`, `type-item-title`, `type-group-title`, `type-stat`, `type-label`, `type-caption`.
- `src/components/shared/section-heading.tsx`: title, optional count (secondary), icon (cap-aligned), description and action; 16px below. Used for 38 section titles, including the dashboard rows and every carousel (`HorizontalCarousel`).
- Page titles use `type-page-title` (the Reader page now uses `PageHeader`, 46px instead of 30px). Dialog titles use `type-section-title`; the dialog header row carries the same type for its cap-aligned buttons.
- Card titles: every card (book, author, series, place, collection, publisher, recommender, reader, dashboard rows) uses `type-item-title`, 21px. Publisher and recommender cards were 24px; collection and publisher edition cards 24px; dashboard author cards 18px.
- Rows that carry a title's type for `CapAligned` (publisher card, series books, taxonomy family card, venue list item, dialog header, carousel arrows) carry the role, so their icons stay on the cap height.
- Form group titles in dialogs: `type-group-title`. Field labels in `Input`, `Select`, `Textarea`, `DatePicker`, the rich text editor and raw labels: `type-label`, 6px above the field (`mb-1` became `mb-1.5`).
- Small uppercase labels (26 sites in sans and mono, 12 and 14px, three trackings): `type-caption`.
- Stat numbers: `type-stat` (serif 38px) on the dashboard (was mono 30px) and Provenance.
- Arbitrary sizes: 9, 10, 11px became 12px; 13px became 14px; the 8px ⌘ became 12px; the 48px placeholder initials 46px; the Goodreads monogram 17px became 16px with its offset retuned to stay within 0.15px of its old position.
- `src/app/harmonize/harmonize.css`: its 16 pixel sizes now use the scale variables (58px title → 46px, 22–24px → 21px, 28–32px → 30px, 9–12px → 12px, 13–14px → 14px, 18px → 16px).
- The "Hunting for" section on the book page gets the standard 32px bottom margin; "Editions" sat 8px under its text.
- `docs/03_DESIGN_LANGUAGE.md` (Typography: Scale, Roles) and `CLAUDE.md` state the scale and the roles.

## Completion Notes

Measured on the dev server at 1440×900 on 22 pages and the Edit Work dialog:

- Rendered sizes, all pages together: before 8, 9, 10, 11, 12, 13, 14, 16, 18, 21, 22, 23, 24, 30, 32, 38, 46, 48, 58px; after 12, 14, 16, 21, 30, 38, 46px. `/harmonize` alone went from 15 sizes to 7.
- Headings: every page title 46px, every section title 30px, every card and item title 21px. Edit Work dialog: title 30px, group titles 21px secondary, all 14 field labels 14px medium with 6px to the field.
- Space under every section title: 16px (22 sections measured). Space between sections on the book, author and place pages: 32px.
- Cards of one grid share one height on every list page and the dashboard.
- `scripts/qa/alignment-audit.js`: no new deviations. The comment editor's −0.52px is gone (13px became 14px). Left, tracked in SLN-392: book page "2019" +0.61px, Provenance stat cards +8.38px, Locations counts +0.61px.
- `pnpm typecheck` and eslint on the changed files pass.
- Not changed: the reader's own overlay panels (16px titles, in the scale), the sidebar wordmark (30px), and the labels that wrap their input on publisher forms (SLN-332 rebuilds those forms).
