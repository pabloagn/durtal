# Task 0677: Settings text, and new copies start with no condition

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-924, findings 6 and 7 of `findings/settings-survey-2026-10-16.md`.

- Data: the Goodreads export's button was named "Download goodreads file" and its toast read "Exporting goodreads file".
- Three straight apostrophes sat beside typographic ones: "Days I'd like to read each week", "Goodreads' own export format", the reader's "Book's value".
- Reading: changing when the timer asks said only "Saved the timer's question".
- Lookup: Logeion and Perseus Word Study are listed for Latin and for Ancient Greek, and both rows' buttons were named "Edit source Logeion" and "Remove source Logeion".
- General: a new copy started in condition Mint, though most copies are not mint.

## Implementation Details

- `settings/data/data-actions.tsx`: the label goes into the button's name and the toast with only its first letter lowered, and "Goodreads" keeps its capital ("Download Goodreads file", "Download books").
- The three apostrophes are ’.
- `settings/reading/reading-settings.tsx`: the toast says the new value, "“Still reading?” now asks after 1 h 30 min".
- `settings/reader/lookup-settings.tsx`: each source's Edit and Remove buttons carry its language, "Remove source Logeion (Ancient Greek)", "Edit source Merriam-Webster (English)".
- `lib/actions/settings.ts`, `lib/hooks/use-app-settings.tsx` and the blank copy draft (`EMPTY_INSTANCE`, `components/books/instance-form.tsx`): the fallback condition for a new copy is now none (null) instead of Mint. The fallback applies only when the settings row is missing. Migration 0052 creates the `new_copy_condition` column with default `'mint'` and inserts the row, so every existing and new database (live, a fresh install, a preview) still starts copies as Mint. Today that changes in Settings, General, Condition, "None". Making none the real default needs a migration, which waits on Joris's word, so SLN-924's condition point stays open.

## Completion Notes

- New `ui/settings-text.test.ts` (the Goodreads capital, the apostrophes, the empty default) and a lookup test that Logeion's two rows have different button names; the existing lookup tests use the new names.
