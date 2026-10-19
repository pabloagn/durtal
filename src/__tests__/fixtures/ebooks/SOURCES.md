# E-book fixtures: sources and licences

Every file here is made by `node scripts/qa/make-ebook-fixtures.mjs`
(eBooks sub-issue 3, SLN-492), with no converter and no download. The texts
are generated from fixed word lists with a seeded random generator, and the
images are drawn by the script. The original fixtures below contain no
third-party text or image and are public domain (CC0 1.0); SLN-499's
public-domain Huysmans excerpt is described below. The font inside
`obfuscated-font.epub` retains its SIL OFL licence.

| File | What it is | Source | Licence |
| --- | --- | --- | --- |
| `epub2.epub` | EPUB 2 with an NCX | generated | CC0 1.0 |
| `epub3.epub` | EPUB 3 with a nav, a page-list and a cover image | generated | CC0 1.0 |
| `rtl.epub` | Right-to-left (Arabic) EPUB 3 | generated | CC0 1.0 |
| `vertical-ja.epub` | Vertical Japanese EPUB 3 | generated | CC0 1.0 |
| `mobi.mobi` | MOBI 6 | generated | CC0 1.0 |
| `azw3.azw3` | AZW3 (KF8) | generated | CC0 1.0 |
| `fb2.fb2` | FictionBook 2 | generated | CC0 1.0 |
| `cbz.cbz` | Comic book zip, six drawn pages | generated | CC0 1.0 |
| `text.pdf` | Text PDF (Times-Roman, a standard font, not embedded) | generated | CC0 1.0 |
| `obfuscated-font.epub` | EPUB with an IDPF-obfuscated font | generated text; the font is EB Garamond from `public/fonts/reader/` | text CC0 1.0; font SIL OFL 1.1 (`public/fonts/reader/OFL-EBGaramond.txt`) |
| `scripted.epub` | EPUB whose chapter has a `<script>` setting a global (the content policy check) | generated | CC0 1.0 |
| `corrupt.epub` | A zip cut short and filled with noise | generated | CC0 1.0 |
| `drm.epub` | EPUB with an `encryption.xml` that is not font obfuscation | generated | CC0 1.0 |
| `cover-jpeg.epub` | EPUB 3 with a 1600 x 2400 JPEG cover (encoded by sharp) and a PNG plate (`--covers`) | generated | CC0 1.0 |
| `cover-png.epub` | EPUB 3 with a 1600 x 2560 PNG cover (`--covers`) | generated | CC0 1.0 |

SLN-499 adds `nav-pagelist.epub`, `nav-pagemap.epub` and
`nav-no-contents.epub`, rebuilt independently with
`node scripts/qa/make-ebook-fixtures.mjs --navigation`. Their French text
is the first paragraph of Joris-Karl Huysmans, *Là-bas*, chapter II
(Tresse & Stock, 1895), from
[Wikisource](https://fr.wikisource.org/wiki/L%C3%A0-bas/Chapitre_II).
The original text is public domain. Repeated text, page markers, chapter
labels and notes are deterministic test structure, not a complete edition.
The first fixture has nested contents, twelve Roman and 120 numeric page
labels, multiple chapters in one spine item, a multipage final linear
section, and trailing nonlinear notes. The second exercises Adobe's
EPUB 2 page map fallback; the third has no contents or print page list.

The earlier fixtures above contain generated text. The large fixtures
(`--large DIR`) are made the same way and never committed.

SLN-503 adds `notes-links-media.epub`, rebuilt with
`node scripts/qa/make-ebook-fixtures.mjs --content DIR`. It reuses the
public-domain Huysmans paragraph attributed above. Semantic/untyped/nested
notes, script/URL probes, multilingual markers, twelve-column table and
PNG/SVG plates are generated CC0 test structures. The same command writes
the temporary 1,500,000-character/60-section search corpus and expected
original-offset manifest into DIR; these large outputs are not committed.
The preparation/acceptance recipe is `scripts/qa/reader-content.md`.
