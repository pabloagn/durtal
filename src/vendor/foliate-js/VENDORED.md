# foliate-js, vendored

The e-book reader's engine (eBooks sub-issue 3, SLN-492). Only
`src/lib/reader/engines/foliate/**` imports this folder (an ESLint
`no-restricted-imports` rule); it is left out of lint and `tsc`, and
`src/lib/reader/engines/foliate/foliate.d.ts` declares the types the adapter
uses.

* Source: the readest fork of foliate-js, https://github.com/readest/foliate-js
* Commit: `08db610` (4 October 2026)
* Licence: MIT (`LICENSE`, John Factotum 2022)

Nothing is copied from the Readest app itself (AGPL).

## Files kept

* `LICENSE`
* `comic-book.js`, `epub.js`, `epubcfi.js`, `fb2.js`, `fixed-layout.js`,
  `mobi.js`, `overlayer.js`, `paginator.js`, `pdf.js`, `progress.js`,
  `search.js`, `text-walker.js`, `tts.js`, `view.js`
* `vendor/zip.js` with `vendor/zip.js.LICENSE` (BSD 3-Clause, Gildas Lormeau 2023)
* `vendor/fflate.js` with `vendor/fflate.js.LICENSE` (MIT, Arjun Barrett 2023)
* `pdfjs-css/text_layer_builder.css` and `pdfjs-css/annotation_layer_builder.css`
  (Apache 2.0, Mozilla Foundation 2014): `scripts/vendor-pdfjs.mjs` copies
  them to `public/vendor/pdfjs/`

Left out: the fork's checked-in `vendor/pdfjs` (pdf.js 4.7.76), its tests,
its demo reader and every other file. Durtal's own `pdfjs-dist` (pinned in
`package.json`) is used instead.

## Local patches

Each patch is marked in the code with a `Durtal patch N (VENDORED.md)` comment.

1. `pdf.js`: pdf.js is Durtal's `pdfjs-dist`, not the fork's
   `@pdfjs/pdf.min.mjs` import. `configurePDFJS({ base, load })` takes the
   loader and the `/vendor/pdfjs/` path from the adapter
   (`src/lib/reader/engines/foliate/engine.ts`); the worker, character maps,
   standard fonts, wasm decoders and layer styles are served from that path.
2. `pdf.js`: `getDocument` gets `disableAutoFetch` and `disableStream`, so a
   PDF read by Range loads only the pages shown, never the whole file behind
   them.
3. `view.js`: `lastLocation` (and the `relocate` event) also carries the
   section `index`, the place within it (`sectionFraction`) and the `reason`
   the view moved, which Durtal's locators and events need.
4. `scripts/vendor-pdfjs.mjs`, on the copied pdf.js worker (not a file in
   this folder): when the root of a PDF's page tree has as many children as
   pages, each child holds one page, so the worker records the count instead
   of fetching every child before the first page shows (one Range request per
   page of a flat, scanned PDF). The copy stops if the pinned worker does not
   contain the exact text the patch replaces.
5. `pdf.js`: the two layer stylesheets are fetched together as pdf.js loads,
   not one after the other once the first page is ready to draw.

## Updating

### SLN-502 asset preparation (runtime integration pending)

`pdfjs-assets.json` records the exact installed pdf.js 6.4.299 package/API
identity and every staged worker, CMap, standard-font, wasm, ICC and license
asset's source path, byte size and SHA-256. `scripts/qa/stage-pdfjs-assets.mjs`
reproduces the inventory and copies those assets into the git-ignored
`public/vendor/pdfjs/6.4.299/` directory. It also retains the original viewer
CSS as extraction evidence. It does not change `scripts/vendor-pdfjs.mjs`,
runtime URLs or vendored JavaScript.

The inventory is explicitly `installed-unpatched-staging`: the copied worker
has the exact installed bytes. Applying established patch 4, extracting
`layers.css`, wiring versioned URLs and enforcing HTTP worker CSP remain
separate, gated integration work. Runtime validation must verify those
transformations and their output hashes; this inventory alone proves none of
their browser behavior.

### Engine updates

Copy the files above from the new commit, apply the patches again, update
the commit and date here, and run `node scripts/qa/reader-engine-check.mjs`
in the three browsers and `node scripts/qa/reader-perf.mjs` on a preview with
`--seed-reader --reader-large`.
