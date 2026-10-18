# Task 0788: eBook routes: a NUL in search, highlights past the end and on Back, an unknown eBook

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-933, from the Fourth reviewer's routing survey of 16 Oct (items 1 to 4):

1. `/ebooks?q=%00` and `/ebooks/review?q=%00` answered 500: PostgreSQL text
   cannot hold byte 0x00, and the search reached the summary query with it.
2. `/ebooks/highlights?page=99999` showed "This page is past the end" where
   every other list goes to its last page.
3. Back to the highlights from a book's "more" link landed 420 to 450px short
   in Chromium, Firefox and WebKit.
4. `/reader/<unknown id>` answered 200.

## Implementation Details

- `src/lib/ebooks/library-params.ts`, `src/lib/ebooks/review-queue/params.ts`,
  `src/lib/ebooks/highlights.ts` (`/ebooks/highlights?q=%00`, from review):
  the search term drops `\u0000` as it is parsed, before trimming and the
  200-character bound. A term of only NULs is no search.
- `src/app/(catalogue)/ebooks/highlights/page.tsx`:
  - Past the last page (of books, or of one book's marks with `ebook=`) it
    redirects there, `redirect(pageHref(BASE, search, lastPage(total,
    perPage)))`, as `/people` does. "This page is past the end" stays only for
    marks removed between the count and the page.
  - Cause of the Back offset (traced): at `popstate` the browser restores the
    scroll while the page still shows one book's marks, 1,881px tall at 1440,
    so 1,400 is clamped to 981 (Chromium) or 952 (Firefox and WebKit). Next then
    shows the list at its full height and leaves the scroll where it was. On a
    phone the short page is tall enough, so it was right there.
  - `src/components/shared/back-scroll.tsx` (`BackScroll`, at the end of the
    results): the click that leaves the list keeps its scroll for its URL in
    session storage. After Back or Forward to that URL it scrolls there once
    the list is in. A link, a filter or a page change without Back still opens
    at the top.
- `src/app/reader/[ebookId]/page.tsx`: a browser with no device id got the
  device handshake, with 200, before the eBook was looked up. The page now
  checks the eBook exists first (`ebookExists`, one indexed lookup) and calls
  `notFound()`, so an unknown id is a 404 with the same view. With a device id
  it was already a 404.

## Completion Notes

- Production build on the preview database (`--seed-reader --ebooks 80
  --seed-highlights 60`):
  - `/ebooks?q=%00`, `/ebooks?q=nad%00ja` and `/ebooks/review?q=%00` answer 200.
  - `/ebooks/highlights?page=99999` redirects to `?page=5`; with `ebook=` and
    `page=999` it redirects to that book's `page=9`.
  - `/reader/<random uuid>` answers 404 with and without a device cookie.
  - Back from a "more" link after scrolling 1400px on page 2 lands at exactly
    1400 in Chromium, Firefox and WebKit at 1440 and 390. Before: 981, 952 and
    952 at 1440.
  - 0 alignment, design and overflow findings on `/ebooks/highlights?page=2`
    and `/ebooks?q=%00` in all three engines at 1440 and 390; page weight
    within budget on every route.
- Tests: the three parsers drop a NUL (`library-params`, `review-queue-params`,
  `highlights-params`);
  the counts and page queries take `q=%00` and `nad%00ja` on a database
  (`integration/ebook-library`); the reader 404s an unknown eBook before the
  handshake (`reader/return-route`); Back restores the kept scroll and nothing
  else does (`ui/back-scroll`).
- No migration and no new packages.
