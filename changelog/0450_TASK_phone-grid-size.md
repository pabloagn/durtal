# Task 0450: Make phone card sizing effective

**Status**: In Progress
**Created**: 2026-10-10
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0449
**Blocks**: Physical phone acceptance

## Overview
A trusted-touch production diagnostic changed the slider and saved preference from 6 to 2 to 8, while 358px and 398px content stayed one column. The input and persistence worked; every requested density shared a 432px two-column threshold.

## Implementation Details
- On coarse-pointer phone layouts, Large projects preference 2 to one column; Compact projects higher values to two columns when the container has at least 328px: two 160px cards and an 8px gap. Below that space it stays one column and reports the actual layout.
- Native controls and CSS select the phone presentation before hydration; resizing does not write preferences. The desktop 2–8 preference and 208px minimum, and mosaic sizing, remain unchanged.
- Compact padding/hit-area rules live outside the column container query so nested card containers do not suppress them. Compact cards have 8px body padding, full wrapping titles and identifying metadata, natural heights and separated 44px actions. Favourite controls remain inside the compact card edge.
- Large image sizing uses a conservative 767px phone bound; Compact retains the 432px desktop bound. This avoids understating a single Large phone card.
- Coverage includes books/publisher books, people, publishers, recommenders, series, places, collections, films, perfumes and paintings. Owner sorting/filter files are untouched.

## Completion Notes
Focused tests passed 43/43 across five files, including native input/persistence, resize without cookie writes, mosaic, measured narrow feedback, SSR hydration and the Large phone image-size bound. TypeScript passed; changed UI source lint passed with zero errors and two existing image warnings on unchanged lines. Independent exact source review and combined full gates/build remain pending. Required candidate checks include coarse WebKit 390/430, tight containers, landscape and desktop, trusted touch/keyboard, cookie/reload/resize and mosaic, and all card families with long/short/absent content and unclipped actions. Poster first-request bounds, full visible opacity and physical iOS acceptance remain separate pending checks.
