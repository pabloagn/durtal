# Task 0495: Open the existing work from a duplicate warning

**Status**: Completed
**Created**: 2026-10-13
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-667. When an add flow warns that the work is already in the catalogue,
the warning now opens that work in one click.

- Add book's "Possible duplicate found" step has an **Open this work** button
  beside "Add edition to this work", "Create as new work" and "Cancel". The
  duplicate card shows the work's cover: its poster, else its first
  edition's cover (what its library card shows), else "No cover".
- Add film's "already in the catalogue" panel shows each matching film's
  poster, with **Open this film** beside "Add a version to it" (now a button
  too).
- Add book's edition step, when the ISBN typed belongs to another edition,
  now has an **Open that book** button under the ISBN field. When details are
  entered by hand this is the only duplicate check (review of PR #216).
- Opening the work leaves the add flow without writing anything. When the
  person has entered something, the first click asks: "What you entered is
  not saved." with **Discard and open** and **Keep editing** (Escape keeps
  editing too). A search result picked on Add book is not something entered:
  it opens at once.

Perfumes and paintings have no duplicate warning when added, so they have
nothing to change here.

## Implementation Details

- `src/components/shared/open-work-link.tsx`: `OpenWorkLink`, a link styled
  as a button that asks inline first when its form is `dirty`. Cmd, Ctrl and
  Shift clicks open as usual (a new tab or window leaves the form as it is).
  "Keep editing" hands focus back to the link. SLN-631's shared
  unsaved-changes guard is meant to replace this question.
- `findDuplicateWork` (`src/lib/actions/works.ts`) loads the work's active
  poster and its editions' cover keys in the card's order (first created
  first), through one `duplicateWith` shared by the ISBN and title matches.
- Add book: the wizard tracks `edited`, set by the details, edition, copies
  and categorization steps' changes. `DuplicateStep` takes it and links with
  `workHref` (slug, else id). The copies badge now says "1 copy".
- `isIsbnInUse` (`src/lib/actions/wizard.ts`) also returns the book's page
  (`workHref`); the wizard keeps the clash as `{ message, href }` and the
  edition step shows `OpenWorkLink` under the field, with the same `edited`.
- The question's buttons are 12px apart (`gap-3`), as are the film match's
  links, so every gap in the action rows is equal while the question shows.
- Add film: `SameTitle` takes `dirty` (anything but the title entered) and
  lists each match as a poster (top-aligned, 48px wide), the title in full,
  its year and directors, and the two links.

## Completion Notes

- New UI test `src/__tests__/ui/open-existing-work.test.ts`: the slug and id
  links, the poster-then-edition cover and the "No cover" box, opening at
  once when nothing was entered, and the question with Keep editing, focus
  and Escape.
- Checked in headless Chrome, Firefox and WebKit at 320, 390, 768 and 1440
  on the production build with the synthetic catalogue: a long, a short and
  a missing cover on Add book, the question after an edition was edited,
  one and two films and a long film title on Add film, and the film question.
  Alignment, design, overflow and touch audits found nothing; the action rows
  keep equal gaps. The first pass found the film posters stretched to the
  row's height; they now keep their 2:3 frame.
