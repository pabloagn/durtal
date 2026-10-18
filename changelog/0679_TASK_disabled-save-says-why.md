# Task 0679: A disabled Save says what it waits for

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-945, finding 4 of `findings/forms-survey-2026-10-15.md`. In 24 forms an empty title or name turned Save off with nothing saying why. Six already said it on main (person, series, film, perfume, painting, new collection, through `RequiredNameHint`). The organization dialogs kept Save on and let the browser's own bubble say "Please fill out this field".

## Implementation Details

The line sits beside Cancel and Save, as `RequiredNameHint` (`src/components/shared/required-name-hint.tsx`) already does, and goes when the field has text:

- Edit work: "Give the book a title"; Add and Edit edition: "Give the edition a title".
- Add and Edit place: "Give the place a name"; Add and Edit recommender: "Give the recommender a name".
- New and Edit taxonomy family: "Give the family a name", and "Choose at least one place this family applies" when every place is unticked; New item: "Give the item a name".
- Edit collection: "Give the collection a name".
- Add source (books, films, paintings, perfumes): "Name the source to save", and a line for a missing or future consulted day.
- A series' Add books: "Choose a book to add".
- Add a quote or note: "Write the passage to save", "Write the note to save", through a `hint` on the reading dialogs' `DialogFooter`.
- Add and Edit organization: Save is off while the name is empty, with "Give the organization a name"; the field is `aria-required` instead of `required`, so the browser's bubble no longer shows.

Rows that held the line without `flex-wrap items-center` gained them, so on a phone the line takes its own row above the buttons instead of pushing them out.

Not changed: Add to collection's inline field (its placeholder already says "Find or create a collection") and the book's Add copy, whose save does not wait on a field.

## Completion Notes

- New `ui/save-hints.test.ts`.
- Production preview: Edit work, Add a quote, Add organization, Add recommender, Add place and New family, in Chromium, Firefox and WebKit at 1440, 390 and 320. Emptying the field shows the line and turns Save off; typing removes it. At 1440 the line's centre is level with Save's (0px); at narrow widths it wraps to its own row. No page or dialog scrolls sideways.
