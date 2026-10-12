# Task 0460: Reader fixes on the iPhone

**Status**: Completed
**Created**: 2026-10-12
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0438, 0454
**Blocks**: None

## Overview

Joris read on his iPhone and found the reader unfinished: the dictionary did
nothing, selecting text shook, the read-aloud voices were poor and often said
"No text available here to read aloud", the top bar overflowed, the bottom bar
lost its right side, a tapped bar button stayed pressed, four fonts were too
few and there was no quick way between a dark and a light page. This task fixes
each one.

## Implementation Details

### Bars

- `reader-bar-item.tsx` is the one top-bar control. In the bar it is the
  32px (44px on touch) cap-aligned icon button with its tooltip; inside the
  phone's More menu it renders as a menu item with its shortcut. Bookmark,
  highlights, download, read aloud and the speech button all use it.
- Below 640px the top bar keeps Contents, Bookmark, Settings and the fixed
  layout controls, and puts the rest in a More menu (read aloud, search,
  highlights, download, full screen, shortcuts and the page colours). Wider
  screens keep every button and gain a Page colour menu.
- An opened menu holds the bars, and `OutsideTapBackdrop` (a clear layer
  portalled to the body, since the glass bar would contain a fixed child)
  closes it on the first tap outside. The layer stays until that tap's click
  lands on it: removed on touch down, the click fell through and opened
  whatever lay beneath (closing Look up opened Contents in the phone check).
  The lookup uses the same layer.
- A pressed button no longer stays lit. The bar buttons focused themselves on
  tap, so the dialog gave focus back to them on close and iOS showed the focus
  ring and tooltip. `focusOpener` now focuses only for the keyboard or a mouse.
- The bottom bar's status slot used `lines-1` (one line high, overflow hidden),
  which cut the 44px "Track this book" button. The slot is now a flex row
  capped at 60% of the bar, and long labels truncate inside it.

### Selection and dictionary

- On a touch screen the selection toolbar docks above the bottom bar instead
  of following the selection under the finger, which made it shake.
- Read-aloud preparation follows the selection after 500ms of stillness rather
  than on every handle move.
- A long press no longer opens the lookup after 450ms: that fought iOS's own
  selection. Selecting a word and tapping Look up opens it.
- Look up keeps the last selection's details, because tapping the button
  clears the iframe selection on iOS; the lookup it opens from a touch no
  longer closes when that selection clears, and a backdrop closes it.
- Look up is a text button so it reads as an action beside Highlight and Note.

### Read aloud

- Natural narration runs through a server provider interface
  (`src/lib/reader/narration/`). ElevenLabs is the first provider, called with
  plain `fetch`; `ELEVENLABS_API_KEY` stays on the server. Without a key the
  reader keeps the device voices exactly as before.
- `GET /api/reader/narration` lists the voices (cached for an hour);
  `POST /api/reader/narration/speech` returns one sentence's MP3, with the
  sentence before as `previous_text` so intonation carries on. Both are
  same-origin only. A 300-entry, 48MB memory cache means a sentence heard again
  is not paid for twice.
- `cloud-speaker.ts` plays the sentences in one audio element, fetching the
  next while the current one plays. It plays a tenth of a second of silence in
  the starting tap, which lets iOS play the later sentences, and keeps reading
  with the screen locked. A refusal (no credits, a refused key) shows its
  reason and the device voice takes over for a minute.
- Natural voices come first in the voice menu, with each voice's accent and
  character. Choosing a device voice is remembered and turns natural voices
  off; choosing a natural voice turns them back on.
- "No text available here to read aloud" came from preparation failing on a
  page whose first sentence started on the page before or on an image page.
  Preparation now reads on to the next text, the Read aloud button is always
  enabled, and a tap prepares when nothing is ready yet.
- The reader CSP allows `media-src 'self' blob: data:` for the audio.

### Fonts and page colour

- Seven OFL families join Literata, EB Garamond and Inter: Source Serif 4,
  Libre Baskerville, Alegreya, Lora, Newsreader, Merriweather and Atkinson
  Hyperlegible Next, from the Google Fonts library at commit
  `bd8f81ddb5c74d5c8897b36ad88b440266245103`, hash-pinned in
  `scripts/reader-fonts/upstream-sources.json`.
- `build.py` pins the width axis at 100 (Merriweather), skips a script subset
  a family covers with fewer than 32 characters (that text uses the fallback
  font whole), and writes a name-only preview file per family for the font
  picker. Rebuilding left all 36 existing files byte-identical.
- `measure.mjs` measures every shipped family; `CHAR_WIDTH_EM` follows the
  metrics file.
- The settings dialog opens with Page colour (Dark, Light, Sepia) and a font
  picker that sets each name in its own face, from preview files of a few
  kilobytes. The old Book theme list is gone.
- The font list lives only in the zod enum and JSONB preferences: no
  migration.

## Completion Notes

- New: `reader-bar-item.tsx`, `outside-tap-backdrop.tsx`, `font-picker.tsx`,
  `cloud-speaker.ts`, `src/lib/reader/narration/*`, the two narration routes
  (in `docs/05_API_REFERENCE.md`), 50 subset files, 10 preview files and 7
  licences under `public/fonts/reader/v1/` (86 subset files in all).
- The bar menus sit in `CapAlignedControls`, not `CapAligned`, whose box
  clips a menu.
- Checked in headless WebKit and Chrome at 390 and 430 px with touch, and at
  1440 px: bars inside the screen, the More and Page colour menus, light page
  applied, no button left pressed, ten fonts set in their own faces and applied
  to the book, the docked selection toolbar holding still while the selection
  grows, Look up staying open after the selection clears, a tap outside
  closing it without pressing what lies beneath, and Read aloud sending
  sentences to the narration route (stubbed: the cloud cannot reach
  ElevenLabs or Wikimedia). The alignment audit is empty in every one of those
  states; the reader engine check (opens, touch, bars, dialogs) passes 90 of
  90; the reader page is 25 KB of HTML in 30 ms.
- Tests: narration provider and routes, the natural-voice speaker, natural
  voice choice, ten font families with their previews; the touch-hold lookup
  tests now assert that a hold leaves selection to the browser.
- Configuration: `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID` and
  `ELEVENLABS_MODEL_ID` (`docs/13_CONFIGURATION.md`, `.env.example`).
