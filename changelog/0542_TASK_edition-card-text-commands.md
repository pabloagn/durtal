# Task 0542: A calmer edition card and one text-command style

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-693, from the design audit (SLN-641 slice 1, finding P1 "Edition card"). The edition card mixed commands into its metadata, and it used two heading styles:

- "Edit publisher links" was a ghost button inside the publisher names.
- A linked publisher was 1.08:1 from plain text and looked the same at rest.
- Delete sat mid-row beside Cover and Match.
- "Add a quote" was secondary text, the same as the label beside it.
- Contributors had a band of their own, with links that showed only on hover.
- "Copies" used the edition title's own role.

## Implementation Details

- **`text-command`** (`src/styles/globals.css`) is the one style for a command or link set in a line of text:
  - `accent-primary` with a quiet underline at rest, brighter on hover;
  - on touch, a 44px tall box (padding, cancelled by a negative margin) that does not move the line.
  - docs/03, Buttons, says when to use it.
- **Edition card** (`edition-detail-card.tsx`):
  - The header block is title, publishers, facts and identifiers, then one action bar: Edit, Cover and Add instance as labelled ghost buttons.
  - The first button's ink starts at the text edge on every row, and the Actions menu's icon ends at the right text edge.
  - Add instance and the menu wrap together, so a narrow row never leaves the menu alone.
- **Actions menu** (`edition-actions-menu.tsx`) holds Add to collection, Match again and Edit publisher links (Link publisher when there are none), then Delete edition, set apart. This is the same `EntityActionMenu` as the book's own menu, which gains `size` and `label` props.
  - `edition-delete-button.tsx` and `edition-match-button.tsx` are gone.
  - `EditionPublishers` takes `command={false}` and opens its editor on `editPublisherLinks(editionId)`.
- **Publishers**: linked houses are text commands, and unlinked publisher text stays plain. The row is not drawn when there is nothing to show.
- **Contributors** join Publication details as label/value rows, by role; names with a page are text commands.
- **Quotes** (`edition-quotes.tsx`) is a group: the count, or "No quotes yet", then "Add a quote", both as text commands.
- **Groups**: Publication details, Genres, Tags, Quotes and Copies all use `SectionHeading as="h4"`, a new level in the caption role with 8px below (docs/03, Typography). "Copies" is no longer an h3 beside the edition title.
- **Add instance** drops its own padding override, so it matches the other buttons.

## Completion Notes

- `pnpm typecheck` and `pnpm lint` report no errors and no new warnings.
- Headless Chromium, Firefox and WebKit, on the book page (Ada or Ardor: 3 editions, a linked imprint, an introduction, a copy) at 320, 390, 1024 and 1440:
  - 0 overflow, alignment, touch or contrast issues.
  - The title, publishers, facts and first action ink share one left edge at every width (37px at 320/390, 381px at 1440).
  - The action bar is one row at 390 and two rows at 320.
- Every menu item opens its dialog or the publisher editor and returns focus to the menu.
- The interaction audit passes, and `page-weight` passes (book page 172 / 400 KB).
- Pressing Escape in the publisher editor's search moves focus out but leaves the editor open. Main does the same, so this change does not cause it.
