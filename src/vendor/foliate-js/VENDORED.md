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

13. Fixed navigation publishes its actual page arrival immediately. A scroll ownership guard suppresses only the corresponding later settled event at the actual clamped coordinates; displacement or wheel/pointer/touch/key input restores ordinary human scroll reporting. Frame and renderer retirement dispose input listeners. Source-only regression correction; native settlement validation remains pending.

14. Paginated numeric anchors add the primary section's exact column offset
before rounding to a container spread. Native Chromium geometry on the
navigation fixture showed a 657px leading half-spread lost at 100% (1314px
spread, two columns, 4599px prior section). Section progress uses measured
section-relative scroll pixels, including the browser-clamped final spread;
published book fractions remain within 0–1. Scrolled anchor math, fixed-layout
navigation and final-linear-section selection are unchanged. Geometry and
adapter regression source added; native retesting remains pending.

15. `paginator.js`: returning from an explicitly opened nonlinear section to a
    linear destination retires cached nonlinear views before reusing the target
    frame or constructing its nearby-view keep set. These views otherwise extend
    the physical strip beyond the last linear anchor, make `atEnd` false, and let
    the next page enter Notes. Linear frames, exact anchors/CFIs, endpoint math,
    sequential lookup and explicit nonlinear destinations retain their behavior.
    The existing adjacent-linear lookup is extracted without semantic changes
    for regression coverage. Source candidate; root native validation pending.

16. `paginator.js`: the exact native `focus()` call after Range/Element anchor
    navigation exposes its synchronous target through `navigationAnchorFocus`.
    The adapter treats that event as part of the existing navigation owner,
    retaining the real accessibility focus while preventing paragraph-level
    focus metadata from cancelling an exact saved-CFI/history landing. The
    target is cleared in `finally` (or restores its prior nested scope), never
    spans an await, and matches only that element on that renderer. Other
    human/Tab/link focus remains actionable, including during pending movement
    or paint. Focus exceptions still propagate and recovery uses the same
    bounded native focus scope. Source candidate; root native gates pending.

17. `paginator.js`: programmatic slide transitions give the root and named turn
    groups the configured slide duration. The browser's default 250ms group
    animation otherwise holds `transition.finished` and the arrival event after
    the 60ms keyboard/tap page slide has completed. Finger-tracked scrubbing and
    curl retain their existing group timelines. Lifecycle ownership, cleanup,
    and arrival ordering remain intact. Source proposal; native latency and
    visual regression verification pending.

18. `load-preparation.js`, `paginator.js`, `view.js`: newly loaded documents can
    register owned asynchronous preparation on the existing load event. The
    iframe retains its existing `visibility: hidden` and real layout until
    preparation resolves; no visible page is hidden. Load destruction aborts
    its signal, cached navigation waits for that same readiness, and preparation
    failures propagate through the load promise. Durtal captures publisher ink
    before installing theme colours and reveals through the original positioning
    and paint sequence. No new visibility toggle, geometry or benchmark timing
    change. Source proposal; native first-paint/colour/ownership gates pending.

19. `paginator.js`: cached navigation inside the current prepared section keeps
    the document's opacity stable; a different section retains the existing fade.
    Adjacent fill reanchors only when it awaited a section load that could change
    layout. A no-load fill keeps the caller's anchor without another visible-range
    scan. Relocate/focus/selection, real-load reanchoring, stabilized events,
    viewport geometry and saved CFIs remain unchanged. Source candidate; original
    native responsiveness and navigation/visual gates pending.

20. `paginator.js`: a keyboard, tap or button page slide runs 250ms
    (`PAGE_SLIDE_MS`, was 60ms, which read as a flash), in both the View
    Transition and the push paths; finger-tracked and curl timings are
    unchanged. A jump's destination fades in over 150ms instead of cutting
    from a blank page (`#hide`/`#reveal`; hiding stays instant, none with
    reduced motion or without `animated`). Durtal's book CSS sets
    `--theme-bg-color`, so the turn layers are backed with the page colour,
    not the browser's grey `Canvas`. SLN-660.

21. `comic-book.js`: a comic's contents name each image "Page N", not its
    file name inside the archive ("001.jpg"), so the contents, the bar and
    the scrubber name a page the same way. SLN-680.

22. `paginator.js`: a page turn that runs out of pages reads the edge
    section before awaiting a background fill, not after. A fill that
    finished meanwhile appended the next section, so the turn went to the
    one after it and skipped a chapter. With no fill in flight nothing
    changes. SLN-673.

23. `paginator.js`: a third turn style, `fade`. A keyboard, tap or button
    turn lays the outgoing page's View Transition snapshot over the still
    incoming page and fades it out over 180ms (`PAGE_FADE_MS`), so no frame
    is blank; without View Transitions it swaps at once. Finger drags and
    their settle keep the push, as with no layered style. `slide` and `curl`
    are unchanged. SLN-660.

24. `paginator.js`: a jump to a section that is not loaded keeps only the
    loaded views that run unbroken up to it (at most two on each side). It
    kept any view within two sections, so after a jump from Chapter 2 to
    Chapter 4 the strip read Chapter 2, Chapter 4, and one back turn went to
    the end of Chapter 2, skipping Chapter 3. SLN-673.

25. `paginator.js`: `uncollapse` (exported) anchors a collapsed point that
    sits before white space on the next glyph. A saved place is the first
    visible point of the screen; when a page starts after a line wrap, that
    point is the space the wrap leaves hanging at the end of the previous
    column, whose only boxes have no width and sit in that column, so the
    reopen scrolled one page early. When only white space is left in the
    text node (the next word starts italics, a link or a note mark), it walks
    on to the next glyph, or anchors on an image met first. SLN-676.
26. `page-hold.js` (new, Durtal's), `paginator.js`, `fixed-layout.js`: a page
    change that has to load first keeps the page on screen until the next one
    is ready, then lets it go: a jump fades it (180ms), a turn slides (250ms)
    or fades (180ms) it in its direction. With `animated` off it swaps at
    once, nothing moves when the page did not change, and a hold lasts at
    most 3 s. A View Transition takes the snapshot. Chromium and Firefox run
    no animation frames inside its update callback, and loading needs them,
    so there the snapshot is taken with an empty update and held by an
    endless animation while the page changes under it; only the book is
    held, with the reader's controls (`[data-reader-chrome]`) kept above it,
    since Chromium can leave the book out of a whole-screen snapshot. WebKit
    does run frames there but keeps a book snapshot's new layer blank, so it
    changes the page inside the update and holds the whole screen, fading
    turns too. Which engine this is, the first hold finds by waiting for a
    frame inside the update, for three of the page's frames measured just
    before (100 to 500ms), so a busy page is not misjudged. That first hold
    has named the book: in WebKit the name goes inside the update, so the
    new page is taken with the screen, and the held book fades. The
    paginator uses it for jumps and for turns into a section that is not
    loaded, where it hid the page and faded it in from blank (patch 20); the
    fixed layout for every turn and jump of PDFs and comics, which now read
    `animated` and `turn-style` too. Without View Transitions, or during
    another one, nothing changes. SLN-660.

27. `paginator.js`: a nonlinear section opened from a link (notes) stands
    alone in the loaded strip (`getStripNeighbourIndex`, exported): no
    section is kept beside it on the jump, loaded before it to fill a short
    spread, or preloaded after it. Chained after the chapter before, it began
    in that chapter's last spread when the chapter ended on a left page, and
    the settle a quarter second later took the chapter for the current
    section, so the reader showed the chapter's last page number. Turns out
    of it, the start and end tests and linear sections' own strips are
    unchanged.

28. `paginator.js`: switching between pages and the scroll flow keeps the
    place. The switch scrolled to the anchor while the views still had the
    old flow's size, so the scroll was clamped short (into the scroll flow,
    up to three screens back at 390px) and the next settle kept that spot.
    Two frames later, once the views have grown, it scrolls to the same
    anchor again unless a navigation or a scroll replaced it. And
    `uncollapse` anchors a range with no boxes on its start: a page holding
    only an image reports the point before the image (its paragraph's start
    to the image's start), so the switch on that page went to the book's
    start. SLN-674.

29. `paginator.js`: a saved place reopens on the same side of the spread.
    In two-page spreads a chapter can begin on a right-hand page, in the
    previous chapter's last spread, so the side each page takes depends on
    every chapter loaded before it (a chapter with an odd column count flips
    the sides after it). Read on from the book's start, every earlier chapter
    is in the strip; reopened, only the chapter itself was, so half the time
    the saved first words came up on the right with the page already read on
    the left. A navigation to a collapsed point (what a saved place is) that
    lands on a later page of its spread now loads earlier chapters, one at a
    time and at most four (`SPREAD_ALIGN_SECTIONS`), until the point begins
    the spread. The strip's last spread is cut short where the strip ends, so
    a point on a chapter's last page first loads the next chapter. A jump to
    a chapter, a mark or a search result is unchanged.
    And the first place is taken on the book's own fonts: `#display` waits
    for the view's `fontReady`, at most a second, before anchoring, as
    Firefox laid the screen out on a fallback font first. SLN-696.
