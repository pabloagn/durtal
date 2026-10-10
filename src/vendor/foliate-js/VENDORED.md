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
  `search.js`, `text-walker.js`, `tts.js`, `view.js`, `footnotes.js`
* `vendor/zip.js` with `vendor/zip.js.LICENSE` (BSD 3-Clause, Gildas Lormeau 2023)
* `vendor/fflate.js` with `vendor/fflate.js.LICENSE` (MIT, Arjun Barrett 2023)
* `pdfjs-css/text_layer_builder.css` and `pdfjs-css/annotation_layer_builder.css`
  (Apache 2.0, Mozilla Foundation 2014), retained as upstream evidence. The
  concrete PDF adapter uses layer rules from its pinned installed pdf.js.

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

6. `mobi.js`, `fb2.js`: expose each section's existing serialized text as
   `loadText()`. The navigation index scans it in bounded slices without
   creating another whole-section DOM. KF8 retains raw fragment identifiers
   alongside its existing selectors, so Kindle-addressed contents anchors
   use their markup offsets too.

7. `fixed-layout.js`: accept srcdoc-only PDF page sources, await owned render
   promises before navigation/preload completion, and invoke `onDestroy` before
   frame removal. The PDF book owns render/text cancellation and backing release.
   Its spread callback synchronizes the three/four-canvas ledger and cached
   spread limits. Other formats retain their existing loading path.

8. `epub.js`: `createDocument({signal})` uses the optional loader's
   `loadTextOwned` for pristine search/note acquisition. Shared renderer reads
   retain their own lifetime. The original document parser and content are kept.
9. `view.js`: `foliate-search:` marks use the requested theme colour, outline
   other hits and highlight the current hit at 35% opacity. Search values are
   independent of history (`foliate-note:`) and ordinary annotation CFIs. Link
   events also carry keyboard activation for app-owned note focus behavior.
10. `footnotes.js`: copied from the exact pinned commit
   `08db61054bd5bc21f244c6ad128f103b6427b03c`; unpatched SHA-256
   `733fd1fab6e1fc752aa7159836997f3ce692816edd820f5b590fc10e8d2d0d40`
   (Git blob `00870d9d9f4a6e1bdd9a8d44f4e313f9f0aa461c`). Export
   `isFootnoteReference`, `getReferencedType` and `locateNote`; the last reuses
   the upstream fragment extent decisions without extracting/mutating the
   pristine document. A detached reference's missing parent is guarded. The
   original `FootnoteHandler` is retained. Existing MIT `LICENSE` is unchanged
   (SHA-256 `b621ffc351fe263bc9b09dd0bc1c9332fda9c462a3904c1e4f0b4d3236b9c28c`).

## Updating

### SLN-502 asset provenance and runtime source

`pdfjs-assets.json` records the exact installed pdf.js 6.4.299 package/API
identity and every staged worker, CMap, standard-font, wasm, ICC and license
asset's source path, byte size and SHA-256. `scripts/qa/stage-pdfjs-assets.mjs`
reproduces the inventory and copies those assets into the git-ignored
`public/vendor/pdfjs/6.4.299/` directory. It also retains the original viewer
CSS as extraction evidence. This raw inventory remains unchanged by runtime
integration.

The inventory is explicitly `installed-unpatched-staging`: the copied worker
has the exact installed bytes. Runtime `scripts/vendor-pdfjs.mjs` stages the
same versioned inventory, applies established patch 4 exactly once, and extracts
the installed top-level text/image/annotation layer rules into `layers.css`.
Its generated `ASSETS.json` records both upstream and deployed hashes for the
two transformations and uses mode `durtal-runtime-patched`. The adapter and
worker HTTP CSP now use the versioned path. This integration source has not
yet been executed or verified; raw provenance proves no native behavior.

### Patch 11 — measured PDF rectangle navigation

`fixed-layout.js` exposes `showPageRect` to the Durtal adapter. It pans the real
mounted page frame to a measured, crop-adjusted rectangle and retains fixed
scroll/pan ownership. It allocates no surface and derives no text geometry.
This source addition has not been executed in the native acceptance matrix.

### Engine updates

Copy the files above from the new commit, apply the patches again, update
the commit and date here, and run `node scripts/qa/reader-engine-check.mjs`
in the three browsers and `node scripts/qa/reader-perf.mjs` on a preview with
`--seed-reader --reader-large`.

12. Fixed-layout PDF page sources return actual cropped dimensions after paint; live and scroll frames adopt those dimensions and preserve position during refresh. Source candidate; native checks pending.
