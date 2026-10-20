# Task 1071: Authors and contributors can be put in order, a contributor's role changes in place, and the name search takes the keyboard

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1131, from items 6 to 13 of
`findings/editing-works-editions-survey-2026-10-18.md`.

Before this change, the edit dialogs had these problems:

- Authors and contributors kept the order they were added in. Making a
  co-author first meant removing everyone.
- An edition contributor's role couldn't change after adding.
- Every Remove had the same name.
- The contributors' X was 12px.
- Remove was disabled on the last author.
- The contributor name search had no keyboard.
- The author role was a native `<select>`.
- Contributors started collapsed in Edit edition.

## Implementation Details

- **One row for every credit** (`src/components/shared/credit-row-controls.tsx`):
  - Move up, Move down and Remove, as a film's credits have them. Each is
    named after its person ("Move Léon Bloy up", "Remove Léon Bloy"), with
    short tooltips.
  - They are 24px with a mouse and 44px on touch. `moveRow` moves a row one
    place.
  - A row moved to an end turns that way's button off, and the focus moves to
    its other button, never to the page.
  - The name wraps in full. On a phone or touch screen, it takes its own
    line with the role and the buttons under it.
- **Edit work** (`work-form.tsx`):
  - The author role is the shared compact Select.
  - Remove stays on for the last author and says "A book needs at least one
    author".
  - The recommender chips use the record forms' chip and `RemoveButton`
    (44px on touch). Their 12px cross was the touch audit's one finding on
    this dialog.
- **Edit edition** (`edition-form.tsx`):
  - Each contributor has a role Select, and moves.
  - Contributors opens by itself when the edition has any.
  - Rows keep their own keys while the form is open, so a moved row keeps
    its focus.
- **Name searches.** Both the author search and the contributor name are
  comboboxes, as the publisher picker is:
  - The arrows move through the names, and Enter picks one without saving
    the dialog. In the contributor field, a second Enter adds the name.
  - Escape closes the list and leaves the dialog open.
  - The author search lists "Create" last and leaves out authors already
    listed.
- The order saves as before: `bookAuthorQueries` and
  `editionContributorQueries` write each row's place as `sort_order`. A role
  change replaces that credit.
- **The book's address.** It follows its first author. Moving an author first
  changes it, and the old address redirecting is SLN-1129's.

## Completion Notes

- **Browsers.** Checked on a private preview, in Chromium, Firefox and WebKit
  at 1440, 390 and 320 (touch at 390 and 320):
  - Edit work moves an author first with the keyboard, and the focus stays
    on its Move down. A name is picked from the search with the arrows and
    Enter, and Escape closes the search with the dialog still open.
  - Edit edition picks a contributor's name with the keyboard and moves it
    up.
  - Saved in Chromium, the order and the new role (Editor) are in
    `edition_contributors` and `work_authors`.
- **Audits.**
  - Both dialogs pass the design, touch and overflow audits in all nine
    runs.
  - Alignment passes in 17 of 18. In WebKit at 320, with the dialog scrolled
    to its very end, the audit's own text probe makes WebKit move the
    scroller by 52px while it measures, and it reports the role menu's
    chevron 52px off. Scrolled 150px up, it finds nothing. Measured directly,
    the chevron and "Co-author" share a center (571px).
  - Page weight passes every route.
- **Tests**:
  - `ui/work-form-authors`: move up and down with the saved `authorIds`
    order, the focus at the top, named Removes, the last author's message,
    a pick by keyboard, and Escape.
  - `ui/edition-credits`: Contributors opens when it has entries; a move and
    a role change are saved in order; named Removes at 44px on touch; a pick
    by keyboard and Escape.
  - `ui/edition-draft-sections`: a removal is still an unsaved edit.

### Review on current main (2026-10-20)

- **The focus after a move.** A row moved down lost the focus: React moves
  that row's node, which blurs it. Each row now puts the focus back on the
  button pressed, or on the other one at an end.
- **The focus after Remove.** It goes to the next row's Remove, else the one
  before, else the contributor name search; it used to drop to the page.
- **Enter in the name searches.** In the contributor name, no suggestion is
  chosen until the arrows choose one, so Enter adds a new name that only
  starts like an author's ("John Smith" beside "John Smithson"). In both
  searches, Enter picks nothing while the search for what was typed is
  still out, so it never picks a name from the previous search.
- **Touch.** A wrapping name keeps a 24px line on touch, not the row's 44px.
- **Tests:** `ui/work-form-authors` adds the focus after a move down and
  after Remove, and Enter while searching; `ui/edition-credits` adds Enter
  on a typed name beside a similar author.
- **Checks on main after #613:** `pnpm typecheck` and `pnpm lint` clean,
  `pnpm test:local` 8,778 of 8,779 (`reading-goals` timed out in a hook
  under load and passes alone), `pnpm build`. The browser audit passes 18
  of 18 page loads on a book page and Add book. In Edit edition, Chromium,
  Firefox and WebKit keep the focus on Move down after a move, on Move up
  once the row is last, and on the row before's Remove after a removal.
  `page-weight.js` passes.
