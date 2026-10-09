# Reader content QA (SLN-503)

Use the isolated ticket branch and the assigned heavy/native slot. These commands
prepare fixture files only; the preview, browser runs and database work still
require that slot. No live S3 upload is part of this recipe.

```sh
node scripts/qa/make-ebook-fixtures.mjs --content /private/tmp/durtal-reader-content-corpus
pnpm exec tsx --tsconfig tsconfig.json scripts/qa/seed-reader-content.ts --corpus /private/tmp/durtal-reader-content-corpus
```

The second command prints a disposable object directory, SQL file and reader
URLs. It calls the application's `ebookGoldFileKey` helper, copies objects under
the existing bucket name `durtal`, and writes the SQL without executing it. Apply
that SQL only to the disposable preview database and use the printed directory
as the preview's local S3 directory. This keeps the canonical
`gold/ebooks/epub/<sha-prefix>/<sha>/file.epub` layout. It creates no bucket,
staging object, credentials or delivery configuration.

`notes-links-media.epub` is a 44 KB committed fixture. It contains semantic
footnotes, endnotes, rear notes, definitions, bibliography, a long note,
empty anchors, untyped short/long destinations, nested notes, strict URL probes,
Greek/Cyrillic/CJK and compatibility letters, linked/small/large images, inline
SVG and SVG-as-image, and a twelve-column 72-row table. Text is the public-domain
Huysmans excerpt already attributed in `SOURCES.md`; other structures and artwork
are generated CC0 fixtures. All script probes must remain unset.

The large EPUB has exactly 1,500,000 original UTF-16 text characters across 60
sections. `messe` occurs once in each; `Gilles de Rais` occurs only in sections
5, 31 and 60. Each section contains the three recorded forms `Là-bas`, `La-bas`,
`LÀ-BAS`; `search-1500k-expected.json` records their original offsets. The large
files are temporary and must not be committed. Use SLN-502's actual 500-page
text PDF fixture and provider for PDF acceptance, including rotated page 7,
image-only page 3, page labels and the sparse-text recovery case.

Required browser evidence uses headless Chromium, Firefox and Playwright WebKit.
Use actual protocol keyboard/pointer/touch input for all gesture claims; DOM
dispatch and synthetic events in unit tests are not native interaction proof.
Do not use Safari GUI, safaridriver, iOS automation or VoiceOver.

Check search from toolbar, `/` and Mod+F in book frames, the field's native second
Mod+F, all options, wrap order, nonlinear hits, streaming groups, Stop/new-query/
close races, 5,000 cap, 500 marks per section and history/annotation coexistence.
At phone widths check the results bar, roving keyboard selection and one-chain
Back. Check note kind/extent, nested replacement, Go to note/Back, keyboard and
pointer focus, outside/Escape/page-turn dismissal, and warm/cold image leases.
Check all strict URL schemes and destinations without duplicate navigation.
Check image/link eligibility, pinch, wheel, double activation, keys and pan bounds.
Check table wrapping through layout changes, CFI and selection stability,
fragmentation/scrolled mode, RTL edges, genuine touch ownership and viewer styles.
Retain plugin regression and all earlier reader performance rows.

Record ten runs per desktop (50 Mbps, 20 ms) and phone (9/1.6 Mbps, 150 ms, CPU4),
with p75: first search result <=1,000 ms, EPUB whole search <=6,000 ms, EventTiming
INP <=200 ms, no main-thread task >50 ms during search, cancellation idle <=100 ms;
PDF first result <=1,000 ms and no new requests after 500 ms of cancellation
(record whole-PDF time). Warm/cold note <=100/300 ms; warm/cold internal link
<=300/1,000 ms; viewer open <=100 ms; 95% zoom frames <=16.7 ms and no LoAF >50 ms.
Record the 2 MB chapter parse time (<200 ms desktop), HTML growth <=1 KB and
first-load JS growth <=8 KB gzip, with separate worker/panel/viewer chunks.

Audit all viewport/theme/coarse-pointer surfaces for <=0.5 px cap alignment,
named 16 px icons, 44 px coarse targets, contrast and visible glass grain,
including search marks and floating-surface collision. Full builds, DB suite,
CI, independent review, main merge and live deployment remain separate gates.
