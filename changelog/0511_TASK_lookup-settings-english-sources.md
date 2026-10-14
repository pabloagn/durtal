# Task 0511: Look up settings put Translate into first and offer English sources

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-687, from the e-book review of 13 Oct. Settings › Reader showed the
Lookup group's 8 default sources as 8 full edit forms ahead of "Translate
into", the setting most readers want. None of the defaults was English, so
an English book's Sources tab said "No sources for English". The
dictionaries picker was a bare file button that did not say what file it
takes or where to get one.

## Implementation Details

- Lookup (`src/app/(catalogue)/settings/reader/lookup-settings.tsx`):
  - "Translate into" comes first, with a line on what it does;
  - each source is a row (its name, then its language and site) with Edit
    and Remove icon buttons on the name's cap height;
  - Edit opens that source's form in place, one at a time, with Done and
    Cancel. Enter in a field presses Done (the form is a shortcut scope),
    and Done saves once the source is valid; an invalid save opens the row
    with the error;
  - Cancel, or Esc, puts the sources back as they were, so a new source
    goes away. With typed work, Esc asks Save, Discard or Keep editing
    (`useEscapeToCancel`);
  - "Add a source" adds a row and opens its form.
- English sources (`src/lib/reader/lookup/sources.ts`): Merriam-Webster and
  Wiktionary lead the defaults. Saved settings whose sources are still the
  first 8 defaults, untouched, read as the current defaults
  (`withCurrentDefaults`, on the server and the browser copy); edited lists
  stay as they are. Settings are now version 2: only a version 1 value is
  upgraded, so a list that removes both English sources stays that way.
- Dictionaries (`dictionaries.tsx`): one line says Look up reads StarDict
  dictionaries (a .zip, or the .ifo, .idx and .dict files), with a link to
  free packs made from Wiktionary.

## Completion Notes

- Checked headless in Chromium, Firefox and WebKit at 1440, 390 and 320 px:
  the rows, Edit, Esc (focus back on the row's Edit), Add then Enter (saved,
  kept after a reload), Esc with typed work (the question), Discard, and
  Restore the default sources.
- The alignment, design and overflow audits are clean with the rows and
  with a form open, at every width in all three browsers.
- No dictionary pack is bundled: that needs a new asset and a licence
  check, left as the ticket's optional item for the coordinator.
- The free packs link was not opened from here: the build environment has
  no web access.
