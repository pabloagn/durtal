# Task 0758: Sentence case everywhere, and separators that never start a line

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
SLN-851. The wording survey (`findings/wording-survey-2026-10-15.md`), section 5
(sentence case) and section 6 (lines that start with punctuation). Design pass 5
item 5 ships with it.

## Implementation Details
- "Up Next" is "Up next" everywhere: actions, menus, toasts, filters, the
  suggestion source, import lines, errors, the shortcut list and the activity
  log, matching the tab and its page title.
- Dialog titles, tabs, section headings, form labels, menu items, statuses and
  browser tab titles take a capital on their first word only: Edit work, Add
  edition, Edit instance, Title & identifiers, Genres & tags, Core details,
  Catalogue status, Series position, Sort name, Life dates, Birth place, the
  edition card's labels, the copy record's Dust jacket / File size / On loan,
  On order, Lent out, In transit, In storage, Not available, the rich-text
  toolbars (Insert link, Bullet list, Numbered list, Code block, Clear
  formatting), Similar works, Associated editions, Edition contributions,
  Book links, Merge item, Copy name, Add book/film/painting/perfume. Proper
  names keep theirs: "Open Library key".
- "Retry Undo" (e-book review) reads "Try undoing again".
- The taxonomy item dialog's "New Art Movements Item" is "Add to Art Movements"
  (`create-item-dialog.tsx`).
- Section 6: a journal row's line keeps each "·" with the item before it (a
  non-breaking space, `reading-tiles.tsx`), and the dictionary note keeps each
  file extension with the word before it (`settings/reader/dictionaries.tsx`).
- Plurals, number grouping and raw values stay with the Quick-win thread.

## Completion Notes
- Tests: `sentence-case.test.ts` fails on any of the survey's title-case
  strings coming back, and pins the taxonomy title and the dictionary note;
  `journal-separators.test.ts` renders a journal row (fails without the fix).
  Tests that asserted the old strings now assert the new ones.
