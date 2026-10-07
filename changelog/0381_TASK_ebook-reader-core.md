# Task 0381: E-book reader core: the engine, fast open, the reading view, input and places

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0385
**Blocks**: None

## Overview

SLN-492, the e-book epic's sub-issue 3. `/reader/[ebookId]` opens an e-book
from its stored file by HTTP Range, so a 300 MB PDF shows its first page
after about 2 MB. The engine is foliate-js (the readest fork), vendored
behind Durtal's own `ReaderEngine` interface; it reads EPUB, MOBI, AZW3, FB2,
CBZ and PDF. The view has the glass bars, Contents and Settings; keys, taps,
swipes and the wheel turn pages from anywhere, also after clicking into the
text; and each device's place is saved as the reader goes, without ever
slowing a page turn. Scripts inside a book never run, and nothing loads from
another origin than the app and the CDN.

New packages, approved by Joris on 7 October 2026 ("Yes packages"):
`pdfjs-dist` 6.4.299 (pinned) and `construct-style-sheets-polyfill` 3.1.0
(pinned; foliate-js's fixed-layout code imports it).

## Implementation Details

The engine:

- `src/vendor/foliate-js/`: the readest fork of foliate-js at `08db610`
  (4 October 2026), MIT, with its zip.js and fflate and their licences, and
  pdf.js's two layer stylesheets. `VENDORED.md` there records the files kept
  and the five local patches (Durtal's `pdfjs-dist` injected through
  `configurePDFJS`; `disableAutoFetch` and `disableStream`; the section and
  the reason on `relocate`; the worker's page tree; both layer styles
  fetched at once). The fork's pdf.js 4.7.76 is not copied.
- Only `src/lib/reader/engines/foliate/**` may import it: an ESLint
  `no-restricted-imports` rule and a `no-restricted-syntax` rule for dynamic
  imports. The folder is left out of lint and `tsc`; `foliate.d.ts` declares
  what the adapter uses. knip follows its imports (`knip.json`).
- `src/lib/reader/engine.ts`: `BookSource`, `DurtalLocator` (the epic's
  contract), `BookInfo` with `capabilities`, `TocItem`, `Presentation`,
  `ResolveResult`, `EngineEvents` and `ReaderEngine` (`open`, `destroy`,
  `goTo`, `next`, `prev`, `goLeft`, `goRight`, `currentLocator`,
  `setPresentation`, `locatorFromSelection`, `resolve`, `on`).
- `engines/foliate/engine.ts` implements it, loaded with `await import()` in
  an effect, never on the server. `locator.ts` turns a relocate into a
  `DurtalLocator` (quote cut at 64 characters on each side; a PDF gets
  `pdf: { page }` and no CFI). `resolve` takes the CFI when the file hash
  matches, else the text quote inside `href` and then the whole book
  (`quote-match.ts` over `approx-match.ts`, approx-string-match 2.0.0, MIT,
  ported to TypeScript), else `totalProgression`.
- `scripts/vendor-pdfjs.mjs` copies pdf.js's worker, character maps,
  standard fonts, wasm decoders and the layer styles to
  `public/vendor/pdfjs/` (git-ignored) before `pnpm dev` and `pnpm build`;
  `.dockerignore` keeps the script in the image's build context.

Fast open:

- `src/app/reader/[ebookId]/page.tsx` reads everything in one query
  (`src/lib/ebooks/delivery/reader-book.ts`): the e-book, its readable files
  (stored or verified, no DRM, a format the reader opens; never quarantined,
  missing or replaced), the file to open (`?file=` over the preferred file),
  this device's place and the linked book's page. Reader plug-ins
  (`plugins.ts`, empty here) load in parallel.
- An inline script carrying the page's nonce (`src/lib/reader/first-range.ts`)
  starts the first byte ranges as the HTML arrives: a zip's central directory
  (from the manifest when sub-issue 5 has written one, else the last 65,557
  bytes), a PDF's first 256 KiB and last 64 KiB (the whole file up to
  320 KiB), the first 64 KiB of a MOBI or AZW3. For a PDF it also starts
  pdf.js's worker, which pdf.js then reuses (`GlobalWorkerOptions.workerPort`).
  Every range is explicit (`bytes=a-b`), so CloudFront never needs a
  preflight. The engine's modules and the reading font are preloaded.
- `zip-reader.ts`: zip.js over a reader whose size the catalogue knows; one
  request reads an entry's local header and its data; an LRU of decoded
  entries (32 entries, 8 MB). `remote-blob.ts`: MOBI, AZW3 and PDF as a blob
  over Range, reading ahead, fetching only the bytes it does not already
  hold. A 403 refreshes the signed URL once; a network failure against the
  CDN moves that book to the app route for the session.
- `deferred-images.ts`: a reflowable EPUB's images over 96 KB are blanks of
  their real size (read from the image's header) until their section is
  shown, so a 10 MB plate does not hold up the first page.
- Failures show "This eBook could not be opened" with the reason, Retry and
  "Open the <format> instead" (`open-error.tsx`); nothing waits more than 30
  seconds. A place that no longer resolves opens at the start with a note.

The reading view:

- `reader-view.tsx` and `src/components/reader/`: a top `glass-bar` (Back,
  the title with the chapter beside it through `CapAligned`, Contents,
  Settings, Full screen where the API exists) and a bottom one (chapter and
  percent). The bars hide together after 3 seconds or on a turn, come back
  on a centre tap, near the top or bottom edge, or on focus; hidden bars are
  `inert`. Contents and Settings are glass dialogs; Settings has the five
  settings of the `durtal-reader-settings` cookie, which Settings › Reader
  keeps editing.
- `presentation.ts` writes the dark theme into the book with its tokens
  resolved to literal colours; images are left as published. EB Garamond and
  Inter are self-hosted in `public/fonts/reader/` under stable names (OFL
  1.1, licences beside them), one file per Unicode range, cached for a year
  (`next.config.ts`).

Input (`src/lib/reader/input.ts`): one layer on the app document and on
every section document. Arrows (left and right, which the engine maps by the
book's direction), Space and Shift+Space, PageUp and PageDown, Home and End,
`t`, `s`, `f`, Esc. Nothing fires in a text field or slider, with a
modifier, or while a dialog or the palette is open (Esc aside). Taps on the
outer 30% turn, the centre toggles the bars; a swipe of 40 px turns; a long
press never turns; one page per wheel gesture. `registerReaderKey` for
plug-ins.

Places (`src/lib/reader/positions.ts`, `position-queue.ts`):

- The `durtal-device` cookie (a random uuid, 400 days, HttpOnly, Secure on
  https, `SameSite=Lax`) is set by `src/proxy.ts` on the first reader page;
  the label ("iPhone · Safari") comes from the user agent.
- `GET` and `POST /api/reader/[ebookId]/position`: zod checks the locator,
  progression 0 to 1, a chapter cut to 300 characters and a time at most 5
  minutes ahead. The upsert on `(file_id, device_id)` keeps the newest place
  by the reader's clock and the greatest `furthest_progression`.
  `getRecentlyOpened` now returns these places.
- Saving is off the input path: at most once every 2 seconds, flushed by
  `sendBeacon` on `pagehide` and when the tab is hidden; a failed send is
  kept for the next flush, a refused one dropped.

Content security: `src/proxy.ts` gives every `/reader/*` page a
Content-Security-Policy with a fresh nonce (`src/lib/reader/csp.ts`):
`script-src 'self' 'nonce-…'` (`'unsafe-eval'` only in development),
`object-src 'none'`, `base-uri 'none'`, the CDN only when `EBOOK_CDN_URL` is
set. The Read button and the copy's "Open" link are plain links, so the
reader always loads as a full page with its policy.

Fixtures and checks:

- `src/__tests__/fixtures/ebooks/`: 13 small files (256 KB in all), made from
  scratch by `scripts/qa/make-ebook-fixtures.mjs`, with `SOURCES.md`. With
  `--large DIR` it writes a 5 MB EPUB, a 50 MB illustrated EPUB, a 300 MB
  scanned PDF, a 2,000-page EPUB and a 2 MB chapter, never committed.
- `scripts/qa/preview-local.py --seed-reader` (needs `--s3-dir`) stores and
  catalogues them under fixed ids; `--reader-large DIR` adds the large ones.
- `scripts/qa/reader-perf.mjs` with budgets in `reader-perf.json`;
  `scripts/qa/reader-engine-check.mjs` (Chrome over CDP, Firefox over BiDi,
  WebKit through Playwright, all headless) with an `--only endurance` check:
  300 turns through the 50 MB EPUB and the 300 MB PDF at 390 px.
- `scripts/qa/page-weight.json`: `/reader/*` (the seeded EPUB, found on
  Against Nature's page) at 400 KB and 800 ms, skipped where no book has an
  e-book.
- The no-Calibre and glass checks leave the vendored code as published.

Docs: 01 (the engine and the adapter rule), 02 (`ebook_positions` written,
newest per device wins), 03 (the reading view), 04 (`/reader/[ebookId]`, its
keys and gestures), 05 (the position route), 07 (reading by range).

## Completion Notes

{{NOTES}}
