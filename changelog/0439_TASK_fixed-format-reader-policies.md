# Task 0439: Fixed-format reader policies

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: SLN-499, SLN-500, SLN-501 for runtime integration
**Blocks**: SLN-503, SLN-507, SLN-508, SLN-509

## Overview

SLN-502 extends the existing Foliate reader for PDF, CBZ and fixed-layout EPUB.
This checkpoint contains only root-authorized pure policies and focused tests,
based on reviewed reader commit `626f4870`. No adapter, UI, storage route,
annotation persistence, preference schema or vendored asset is changed.

## Implementation Details

- `canvas-budget.ts`: DPR policy, independently capped raster backing size,
  16 Mi-pixel per-page and 128 MiB aggregate limits, and three/four page-canvas
  and two/one cached-spread limits. `otherCanvasBytes` must include live and
  in-progress reservations. A caller must reserve before rendering; null means
  defer or evict. CSS/text-layer geometry remains at the requested zoom.
- `pdf-options.ts`: absolute versioned asset URLs and prescribed document
  options for the installed, pinned pdf.js 6.4.299; the worker CSP policy.
  Installed display source ignores `isEvalSupported`. The option is retained
  for compatibility, but is not credited as an effective security control.
  Source checks confirm the installed worker uses PostScript wasm/IR execution
  without native JS eval/Function construction; annotation scripting is opt-in.
  HTTP CSP enforcement and adapter application still require runtime checks.
- `pdf-range.ts`: exclusive-end ranges split into at most 256 KiB requests,
  six-read concurrency policy, exact 206/header/body validation, and a
  whole-file 200 policy requiring cancellation before body reads and app retry.
- `pdf-crop.ts`: median paper tone, strict 40-level difference, 0.4% density,
  2% padding, 25% side limits and 40% minimum area, with first-page Auto policy.
- `pdf-geometry.ts`: rotation/crop/zoom-aware coordinate conversion, normalized
  and merged user-unit rectangles, PDF locator construction and healing order.
- `pdf-text-geometry.ts`: detached offset-to-user-unit mapping from supplied
  measured glyph/ligature quads. Missing coverage returns null; no DOMRect or
  proportional division is substituted. The adapter's measurement producer
  remains gated and unimplemented in this checkpoint.
- `pdf-text-policy.ts`: unknown, sampled-no-text, has-text and confirmed-no-text
  evidence. Five empty sampled pages never disable whole-book search or speech.
  Current-page actual text controls selection; discovered sparse text recovers
  capabilities. Idle sampling is capped at five distributed pages.
- `fixed.ts` and `comic.ts`: fit/zoom/spread calculations, printed PDF size,
  deterministic segment ordering, Manga direction, folder contents and pure
  twelve-image LRU transitions.

## Completion Notes

Focused validation: nine test files, 75 tests passed, zero skips. Fixtures in
these tests are synthetic arrays/geometry; installed pdf.js source is read
directly for security compatibility checks. No performance or native-browser
proof is claimed.

Root relayed independent `PURE_SOURCE_APPROVE` for exact commit `9f40c641`:
82 tests passed, zero skipped (75 supplied plus seven adversarial checks).
Review covered extreme/exhausted canvas budgets, all four rotations with
crop/zoom, high byte ranges and text sampling. Runtime allocation reservations,
early cancellation, measured-glyph production and native PDF performance
remain integration gates. This approval does not cover subsequent asset
preparation changes.

Scoped TypeScript and lint checks cover the new files only. Full typecheck,
lint, deadcode, unfiltered zero-skip database suite, default Mac build, Docker,
CI, real large fixtures, all nine browser/width combinations, audits and every
performance row remain required after root authorizes integration and the
heavy slot. No migration or new dependency is introduced.

Upstream contract dependency: `locatorSchema` at the base commit still caps
`text.highlight` at 2,048 characters; SLN-500's shared validation must accept
the specified 10,000-character annotation quote before these locators are
integrated. That schema is intentionally unchanged here.

### Asset preparation checkpoint

Root subsequently authorized exact installed asset acquisition. The additive
`scripts/qa/stage-pdfjs-assets.mjs` copies 203 installed assets to the ignored
`public/vendor/pdfjs/6.4.299/` folder and writes the reproducible inventory
`src/vendor/foliate-js/pdfjs-assets.json`. Package and exported API versions
must both be 6.4.299. Every copied byte is rehashed before the publication
marker is written. No dependency is installed and no runtime source is wired.

Manifest SHA-256:
`3e8dc01789c4dd3bae28eb76565caf12540526d23503c2b3fafd490f5e71d5a8`.
Mode is `installed-unpatched-staging`; the existing worker patch and actual
layer-CSS extraction/CSP headers remain integration work. The original viewer
CSS is retained only as extraction evidence. The current vendor build script,
package scripts, adapter, UI and owner files remain unchanged.

Asset checkpoint validation: the three asset staging/version tests and ten
installed document/security-option tests passed (13 total, zero skips).
Every one of the 203 staged files matches its installed source bytes and
manifest hash; two independent staging directories produced identical
manifests. This is asset provenance evidence, not a browser or build result.

### Exact upstream preference contract

Root relayed independent `SOURCE_APPROVE` for exact asset commit `16a5f5d3`:
all 203 hashes matched and 17 isolated tests passed, including four independent
failure cases. Approval covers staging and provenance, not runtime CSP.

Root then authorized normal integration of independently approved navigation
commit `f1c4cadf994592755b3ac214f291c9e4e7fc1eea`. Merge `e7cb4c69` completed
without conflicts; no parent history or primary checkout was rewritten.

Add these fields to SLN-501's existing strict `presentationSchema`:

```ts
fixedFit: z.enum(["page", "width"]),
cropMargins: z.enum(["auto", "on", "off"]),
pdfThemePages: z.boolean(),
```

Defaults: desktop/tablet `fixedFit: "page"`, phone `fixedFit: "width"`;
all classes `cropMargins: "auto"`, `pdfThemePages: true`. Keep defaults in
`PRESENTATION_DEFAULTS`, so partial book overrides do not acquire fields they
did not set. Existing field-wise salvage plus effective-presentation merging
reads old rows over the new defaults. Use existing scope/save actions, and
leave zoom ephemeral. No extra migration.

### Measured PDF text contract for SLN-503/SLN-508 (proposed)

Adapter-internal provider, bound to the opened file's hash:

```ts
interface PdfTextPageRequest {
  fileHash: string;
  pageIndex: number; // zero-based section index
  signal: AbortSignal;
}
pdfPageText(request: PdfTextPageRequest): Promise<{
  fileHash: string; pageIndex: number; pageLabel: string; text: string;
}>
locatorForPdfTextOffsets(
  request: PdfTextPageRequest & { start: number; end: number }
): Promise<DurtalLocator | null>
```

Offsets are UTF-16 in the exact `pdfPageText` result before search folding or
speech segmentation. The producer must measure actual text-layer glyph or
ligature ranges at a known viewport, temporarily laying out detached content
in one owned offscreen measurement host if necessary; no page raster is
needed. Geometry then feeds `PdfPageTextGeometry` and the pure locator builder.
Never invent glyph widths by proportional subdivision or accept empty
detached DOMRects as an exact locator. Return null when measurement is absent.

Each request owns only its measurement host/text-layer task and late-result
delivery. Aborting search/speech must not cancel visible renders, destroy the
PDF loading task, or abort shared transport work still used by rendering.
Shared reads/page proxies require consumer leases; document close separately
invalidates all owners. Keep at most six shared PDF transport reads in flight,
bound page/geometry caches, and retire document references after at most one
second of pdf.js destruction. These effectful producers/leases are gated,
unimplemented integration work, not checkpoint proof.

Use the existing common `navigate(..., { source: "goto" })` for page-strip
jumps. No extra jump-source variant is proposed.

### Owned worker and backing allocation source checkpoint

`pdf-worker.ts` creates a per-document native module worker from the exact
versioned same-origin URL and hands its explicit port to `PDFWorker.create`.
No global worker port or fake-worker fallback is used. Initialization failure
terminates the native port; close destroys both abstractions once. Worker
load/message failures are observed through a promise for the adapter to race.
This does not claim the HTTP CSP has been wired or verified.

`canvas-ledger.ts` reserves bytes and page slots synchronously before canvas
creation, including pending work. It enforces the reviewed aggregate/pixel
limits and three/four page slots, freezes raster plans, cancels its own paint
before zeroing backing dimensions, releases failed/reentrant allocations and
cleans every owner even when one cancellation throws. The renderer must evict
cached pages before reserving replacements or reducing the spread mode.

Ten focused lifecycle tests passed, zero skips. Scoped TypeScript, source lint
and whitespace checks passed. Test worker/paint objects are deliberate doubles;
real worker startup, raster painting and memory/performance proof remain gated.

### Bounded transport source checkpoint

`PdfRangeSource` owns at most six concurrent bounded reads, coalesces identical
intervals through consumer leases, keeps 32 chunks (at most eight MiB), and
caps the pending queue. A departing consumer cannot abort another consumer's
read; the last departing consumer cancels the shared fetch. Close rejects all
consumers immediately and prevents late callbacks/cache publication.

Headers are validated before body consumption. A CDN whole-file 200 is
cancelled and retried through the session's app route. App-route 200 or invalid
206 headers are cancelled and rejected. Accepted 206 bodies stream into an
exact bounded destination; truncated/oversized bodies fail. URL refresh is
shared and attempted once, and fallback remains sticky. `forPdfOwner` aborts
delivery while leaving shared pdf.js page/font work running.

Fourteen transport and four consumer-lifetime tests passed, zero skips,
including cache eviction, high offsets, shared refresh, unfinished prefetch,
and a fetch double that ignores abort. Scoped TypeScript, source lint and
whitespace checks passed. These modules await adapter wiring; no live HTTP,
browser, large-fixture, performance or build result is claimed.

### Measured-text producer source checkpoint

`pdfTextRuns` defines the exact UTF-16 page text and inter-item separator ranges.
`measurePdfTextLayer` renders the actual pdf.js TextLayer in an owned,
layout-active offscreen shadow host, waits for fonts, measures grapheme ranges
through DOM `getClientRects`, and converts all measured corners through the
known viewport into PDF user units. It preserves surrogate/grapheme offsets;
missing/nonfinite/empty geometry stays absent. No proportional subdivision
of PDF item widths is used. Crop/zoom/rotation apply later through the same
stored user-unit geometry.

The measurement queue owns one active host. Caller abort can remove/cancel
only its owned host/layer; it does not touch shared page/document/transport
or visible-render lifetimes. A cancelled queued delivery cannot allow later
measurement to overtake the still-active producer. Closing rejects all owners.

Seven focused producer tests passed, zero skips; scoped TypeScript, source
lint and whitespace checks passed. These tests explicitly use a layout double
with unequal glyph advances and a ligature. Actual browser font/rotation
alignment remains required. Provider caching and public adapter APIs are not
wired in this checkpoint.

### Concrete PDF session source checkpoint

`openPdfSession` passes the explicit owned worker and reviewed document options
to the real pdf.js API. Its range transport assembles each logical interval
from bounded HTTP chunks and emits one `onDataRange` callback at the requested
begin offset: installed 6.4.299's range reader completes on its first callback,
so unsolicited chunk callbacks would truncate data. This required logical
assembly is separate from refusing whole-file HTTP 200 bodies.

`PdfSession` shares page/text production, pins pages with consumer leases, and
evicts unpinned page proxies. Cached text is capped at 16 pages and four MiB of
UTF-16 strings, including empty pages. Requests validate the file identity and
offsets; page text and measured locators share one text source. Close aborts
delivery/measurement/transport immediately and races pdf.js teardown against
one second, then releases its document/task/worker references and native port.
Opened-session transport or native-worker failures trigger owned teardown.

Installed PageViewport exposes point conversion rather than the former
rectangle method. `pdfGeometryViewport` supplies the internal geometry
contract by converting all four corners through the actual point API.

Eleven focused session tests and four viewport bridge tests passed, zero
skips. Scoped TypeScript, source lint and whitespace checks passed. pdf.js,
HTTP and native Worker objects are injected doubles in these tests. The
session is concrete source preparation; the common foliate adapter, vendor
render callbacks, public measured-text methods, HTTP CSP and UI still await
wiring and native proof.

### Owned raster render source checkpoint

`PdfRasterRenderer` now calls the actual `PDFPageProxy.render` canvas API through
the allocation ledger. Every pending paint is reserved before backing creation;
the viewport stays at CSS scale while the render transform uses the exact
backing/CSS ratios. It pins the page only while painting and adopts a result
only if its frame still owns it. Cancellation clears the pending backing and
cannot retire another live page. Hidden cached backings are released before
new reservations; an exhausted aggregate budget releases the outgoing backing
before replacement. Identical raster work is reused.

Five focused integration tests passed with page/canvas doubles, zero skips,
covering live plus pending counts, replacement, hidden eviction, independent
cancellation, extreme zoom and frame removal during paint. Scoped TypeScript,
source lint and whitespace checks passed. Native raster/memory proof is gated.

### Production PDF producer binding checkpoint

The common foliate adapter now opens the actual `PdfSession` and passes it to
`makePdfBook`; the former vendor `makePDF` path is no longer the production PDF
opener. The book uses owned raster canvases, the actual pdf.js TextLayer, safe
link annotations, outline/page labels and common fixed-layout navigation. Page
frame retirement cancels owned work before removal. Visible selection uses the
mounted viewport and measured DOM rectangles to store PDF user-unit geometry.

Stable consumer contract: `PdfTextPageRequest` contains `fileHash`, zero-based
`pageIndex` and the original owner `signal`; `PdfPageText` returns those file/page
identities, `pageLabel`, and exact UTF-16 `text`. Adapter methods `pdfPageText`
and `locatorForPdfTextOffsets` forward the unchanged request through frozen
`bindPdfTextProvider(actualSession, exactLayerCss)`. Offset requests add `start`
and `end` in that exact string. The session owns shared page/text production;
measurement owns only its host/layer. Consumers do not open, cache, destroy or
replace the producer. Close/open failure clears the adapter's provider.

`pdfViewport(doc)` exposes the mounted page's actual point-conversion bridge to
internal foliate consumers. Rectangles are in PDF user units, never CSS pixels
or CFIs. The exact installed layer rules and explicit plane rotation are shared
between visible text and detached measurement; missing geometry remains null.
The search consumer patch is intentionally not applied here: SLN-503 can consume
this public producer without copying it. PDF decoration integration still
requires the approved shared SLN-500 contract.

Asset source now deploys the pinned worker, CMaps, fonts, WASM and ICCs under the
same versioned URL as the adapter. Generated runtime provenance records patch 4
and installed layer-rule extraction separately from the unchanged raw inventory.
Next headers supply native worker HTTP CSP; bounded initial PDF prefetch refuses
whole-file 200s before consuming bodies, and late prefetch cannot recreate a
worker already claimed by the document.

QUIET-494 was active while preparing these changes and has since been released.
No new runner, typecheck, lint, formatting, asset execution, build, native browser,
Docker, font, stress or live/cloud work has been performed for this checkpoint.
Three binding tests are authored and unexecuted; earlier scoped test evidence
above remains historical and does not verify this changed adapter. Request a
bounded focused verification slot before those checks. Full fixed-format UI,
CBZ integration, decoration/healing, native alignment, HTTP CSP, memory/range
performance and combined acceptance gates remain outstanding.
