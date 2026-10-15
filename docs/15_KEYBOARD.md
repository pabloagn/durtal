# Keyboard: ownership contract and coverage

SLN-630, the first step of SLN-629 (a keyboard-native app). This document
holds the rules every key follows (the contract), the global key map with
its conflicts against the owner's requested mappings, the page-action
coverage by page family, and one row per dialog in the app. Later tickets
(SLN-632, SLN-571, SLN-633, SLN-634) change the code and update this file.

Source read: `main` plus #223, 13 Oct 2026. "Browser-checked" means a
headless Chromium, Firefox and WebKit journey ran on a disposable preview
(the reviews of #217 and #223, and SLN-638's journeys); everything else is
read from the source and covered by unit tests at most.

## 1. The contract

### Who gets a key

1. **The topmost layer owns the key.** Layers, top first: the unsaved-work
   question, a list or menu open inside a field (combobox, picker, date
   picker), a leader menu (N, G, Y, E, R), the command palette, the
   topmost `Dialog`, a page draft (`useEscapeToCancel`), the page. One
   layer handles a key and stops it; a layer below never sees a key a layer
   above handled (`hasOpenSurface`, the surface lease in
   `src/lib/ui/surface-state.ts`).
2. **The reader owns its own keys** on `/reader/*` (`READER_VIEW_RE`). The
   global handler leaves Enter, Esc and letters there to the reader's
   handlers and its shortcut sheet. The reader's Esc takes one layer per
   press: a dialog or the panel the focus is in; then, from the page,
   read-aloud, the open search panel, the search itself (its results bar
   and marks, SLN-675), and full screen. With nothing left, Esc asks
   "Leave the book?" (SLN-744): Leave holds the focus, so Esc then Enter
   leaves (the place saved first) and Esc twice stays.
3. **IME composition is never a key** (`isComposing`: `isComposing` or key
   code 229). Esc that ends a composition closes nothing; Enter that picks a
   character saves nothing.
4. **A held key acts once.** An auto-repeated Enter is consumed (never a
   second save, submit or click), except in a text box, a rich text field
   and the reader, where it types. A repeated letter never runs a page key
   again.
5. **Page letters never fire** while typing (`isTyping`: inputs, text
   boxes, selects, comboboxes, contenteditable), with a dialog or surface
   open, with ⌘, Ctrl or Alt held, or in the reader. "?" and "/" may take
   Shift; letters never do.

### Enter

| Focus | Plain Enter | Shift+Enter | ⌘Enter |
|---|---|---|---|
| One-line field in a native form | the browser submits the form (once) | - | the dialog's or page's save button |
| One-line field outside a form (`isConfirmField`) | the group's main button (`data-shortcut="next"`, else `data-variant="primary"`) | - | save button |
| Search, filter or suggestion field with a list | picks the active (else first) result | - | save button |
| Text box in a dialog (`isDialogTextBox`) | the dialog's main button, once | new line | save button |
| Text box marked `data-enter="ignore"` (one entry per line) | new line | new line | save button |
| Text box on a page | new line | new line | save button |
| Rich text field (Tiptap) | new paragraph | line break | save button (`passSaveThrough`) |
| The dialog itself, or text in it (`isQuietInDialog`) | the dialog's main button | - | save button |
| A button, link, checkbox, select, tab, menu item | its own Enter | - | save button |

- **Add book:** Enter and ⌘Enter on the work's details step press Fast Track
  (`data-shortcut` on the wizard's buttons); on the search and duplicate
  steps they pick a result.
- **The main button is never a danger button.** A Delete, Remove, Discard
  timer or Undo import is pressed by click, Tab then Enter, or Space, never
  by plain Enter from a field or the dialog. This is deliberate: an Enter
  meant for a field must not delete. ⌘Enter is the exception where the
  danger button is marked `data-shortcut="save"`: the shared delete
  confirmation (`ConfirmDeleteDialog`: films, paintings, perfumes, their
  copies, versions, bottles and formulations, organizations, venues,
  retailers, work links, readings, lookup history) and Undo import. The
  book's own Delete (`delete-confirm-dialog.tsx`) has no mark, so ⌘Enter
  does nothing there.
- **Disabled means nothing happens.** When the main button is disabled (the
  form is invalid, or saving), Enter does nothing and the draft stays.
- **Native and custom never both run.** The custom handler skips a field in
  a native form (`el.form`), and a handled key is `preventDefault`ed.

### Esc

- Closes the topmost layer only. A list in a field closes before its
  dialog; a dialog closes before the page draft.
- A layer with unsaved work asks first: **Save** (when the form has one;
  Enter), **Discard**, **Keep editing** (Esc). Keep editing restores focus
  and the draft unchanged. The same question guards Close, Cancel
  (`data-dismiss`), the backdrop, a link that leaves the page, the G and N
  menus, A then a key, and the palette (`leavePage`).
- **Unsaved** means the fields differ from what the form opened with
  (`draft`, which also reads `data-draft-value` for pickers), or the form's
  own comparison (`dirty`). A field changed back is clean again. After a
  successful save the form closes; a failed save keeps the draft open.
- **Already saved is not unsaved.** The media manager, Collections ticks and
  the edition cover dialog save each action as it happens; Esc closes them
  at once.

### Leader menus

N, G, Y, E and R open a menu (`LeaderMenu`); a letter, or ↑ ↓ then Enter,
picks; Esc closes; a click outside or a new page closes. A opens no menu: it
waits for the key that says what to add (section 2). E and R open only where the page
registered actions (`useEditActions`, `useReadingActions`).

## 2. Global key map and conflicts

Current keys (`src/lib/shortcuts/shortcuts.ts`, `src/lib/catalogue/domains.ts`):

| Keys | Now | Owner's request (SLN-629, 632, 571) | Conflict |
|---|---|---|---|
| A | a prefix only (SLN-632): the next key adds; Esc, another key or a modifier end it; a key after 1.5 s acts on its own | A is only a prefix; N opens New | resolved |
| N | opens the New menu (SLN-632; R then N is still Up Next inside the R menu) | opens the New menu | resolved |
| A B | Add book | Add book | none |
| A P | Add perfume (SLN-632) | Add perfume | resolved |
| A U | Add publisher (was A P) | - | resolved |
| A A | Add person | Add person | none |
| A F | the page's item: favourite it; on a page with no favourite star, Add film (SLN-571) | Favourites (current item) | resolved: the item wins, Add film is the fallback |
| A C | the page's item: its collections picker; elsewhere, Create collection (SLN-571) | Add to collection (current item) | resolved: the item wins, Create collection is the fallback |
| A I | Add painting | - | none |
| A R, A S, A L | recommender, series, place | - | none |
| F | nothing (was the favourite; SLN-571) | A then F | resolved |
| E W, E M, E T | Work (book, film, perfume, painting), Media wherever the page has media, Taxonomy (book) | keep E W; E M on every page with media | resolved (SLN-633) |
| E C, E P, E O, E S, E R | the page's item: Collection; Person, Publisher or Place; Organization; Series; Recommender (SLN-633) | Edit collection on a collection page | resolved: the letter is the first of what it edits |
| G … | Go to: D, B, F, E, I, A, P, S, C, O, M, T, H, R, K, "," | keep | none |
| Y … | Copy: N, T, I, D, L | keep | none |
| R … | book page reading: S, P, U, F, A, L, T, N, Q, H | keep | none |
| S, /, ?, ⌘K | palette, search this list, help, palette | keep | none |
| Alt+F | fix a field's title case or name order | keep | none |

Other notes for SLN-632:
- A client navigation closes an open leader menu and drops a pending A
  (resolved in SLN-632).
- The help sheet, the palette's key hints (`command-palette.tsx`) and the
  menus read the same lists, so one registry change updates all three. The
  favourite's "F" tooltip is its own constant and must move with it.

## 3. Page actions by family

Visible actions on each detail page, and the keys that reach them today.
"E menu" lists the `useEditActions` entries.

| Page | Edit | Media / images | Add to collection | Favourite | E menu | Y copy |
|---|---|---|---|---|---|---|
| Book `/library/[slug]` | Edit Work, Edit Taxonomy (actions menu) | Manage media | work button (A C), edition buttons | A F | W, M, T | yes |
| Film `/films/[slug]` | Edit (actions menu) | Images | Collections (A C) | A F (curation star) | W, M | yes |
| Perfume `/perfumes/[slug]` | Edit | Images | Collections (A C) | A F (curation star) | W, M | yes |
| Painting `/paintings/[slug]` | Edit | Images | Collections (A C) | A F (curation star) | W, M | yes |
| Person `/people/[slug]` | Edit | Manage Media | - | A F | P, M | yes |
| Publisher `/publishers/[slug]` | Edit (editor page) | Manage media | - | A F | P (opens the editor page), M | yes |
| Organization `/organizations/[slug]` | Edit | none | - | none | O | yes |
| Collection `/collections/[id]` | Edit | Artwork | - | A F | C, M | yes |
| Series `/series/[id]` | Edit | none | - | A F | S | yes |
| Place `/places/[slug]` | Edit, Archive | none | - | A F | P | yes |
| Recommender `/recommenders/[id]` | Edit | none | - | A F | R | yes |

Since SLN-633 every row with an Edit button takes E then the first letter
of what it edits, and every row with media takes E then M. Each runs the
same dialog (or, for a publisher, the same editor page) as the visible
button, and the actions menu and the collection's buttons show the keys.
Not bound, with the reason: Delete (never a key, as Enter never presses
it), a place's Archive and Restore and a person's Merge (not edits of the
item's fields), and a series' or collection's Add books (an add, not an
edit; its own button is one Tab away). An organization has no media and no
favourite star, so A then F adds a film there.

## 4. Dialogs

One row per `Dialog` in the source (97). "Where" is the file and line of
the `<Dialog>`. Kinds:

- **Edit form**: fields and a Save or Create. Enter follows the table
  above; Esc and every close ask when unsaved.
- **Step form**: an edit form shown one step at a time. Enter presses the
  visible step's main button (Next, then the last step's Create).
- **Confirm**: a question with one main answer. Enter presses it unless it
  is a danger button.
- **Picker / manager**: each choice or upload saves at once; nothing is
  unsaved. Esc closes, and Enter presses Done where the dialog has no other
  main action (SLN-634).
- **Viewer**: nothing to save. Esc closes, and Enter presses Done
  (`Dialog`'s `done` prop, SLN-634).
- **Reader-local**: the reader's own keys.

The Add book wizard, Add film, Add perfume, Add painting and the publisher
editor are pages, guarded by `useEscapeToCancel`; so are the in-page
editors of notes, publishers' links, acquisition targets, order panels,
the identify queue and the harmonize workspace (16 files).

| # | Dialog | Where | Kind | Main action on Enter | Unsaved guard |
|---|---|---|---|---|---|
| 1 | Review prepared fixes | `app/(catalogue)/harmonize/workspace.tsx:682` | Review | Apply prepared fixes | none |
| 2 | Resolution record | `app/(catalogue)/harmonize/workspace.tsx:737` | Viewer | Done | none |
| 3 | One record, fully connected | `app/(catalogue)/harmonize/workspace.tsx:1234` | Confirm | none: Merge is not pressed by Enter, as a danger button | none |
| 4 | title | `app/(catalogue)/library/[slug]/delete-confirm-dialog.tsx:38` | Confirm | Delete (danger): Enter does nothing; Esc closes | none |
| 5 | Edition cover | `app/(catalogue)/library/[slug]/edition-cover-dialog.tsx:149` | Manager (saves each action) | Add the typed image address | dirty (a typed address) |
| 6 | Add Edition | `app/(catalogue)/library/[slug]/edition-add-dialog.tsx:99` | Edit form | Save / Create (submit) | draft |
| 7 | Edit Edition | `app/(catalogue)/library/[slug]/edition-edit-dialog.tsx:124` | Edit form | Save / Create (submit) | draft |
| 8 | Add Instance | `app/(catalogue)/library/[slug]/instance-add-dialog.tsx:137` | Edit form | Save / Create (submit) | draft |
| 9 | Edit Instance | `app/(catalogue)/library/[slug]/instance-edit-dialog.tsx:199` | Edit form | Save / Create (submit) | draft |
| 10 | Edit Work | `app/(catalogue)/library/[slug]/work-edit-dialog.tsx:124` | Edit form | Save / Create (submit) | draft |
| 11 | Edit taxonomy | `app/(catalogue)/library/[slug]/work-taxonomy-edit-dialog.tsx:98` | Edit form | Save / Create (submit) | draft |
| 12 | New location | `app/(catalogue)/locations/actions.tsx:69` | Edit form | Save / Create (submit) | draft |
| 13 | Edit location | `app/(catalogue)/locations/location-card.tsx:208` | Edit form | Save / Create (submit) | draft |
| 14 | Delete $name | `app/(catalogue)/locations/location-card.tsx:266` | Confirm | Delete (danger) | none |
| 15 | Edit person | `app/(catalogue)/people/[slug]/author-edit-dialog.tsx:98` | Edit form | Save / Create (submit) | draft |
| 16 | Merge people | `app/(catalogue)/people/[slug]/author-merge-dialog.tsx:82` | Confirm | none: Merge is not pressed by Enter or ⌘Enter, as a danger button | draft |
| 17 | Add person | `app/(catalogue)/people/author-create-dialog.tsx:108` | Edit form | Save / Create (submit) | draft |
| 18 | Link an institution | `app/(catalogue)/places/[slug]/venue-institutions.tsx:181` | Edit form | Save / Create (submit) | draft |
| 19 | venue ? "Edit venue | `app/(catalogue)/places/venue-create-dialog.tsx:216` | Edit form | Save / Create (submit) | draft |
| 20 | New order | `app/(catalogue)/provenance/order-create-dialog.tsx:163` | Step form | Next, then Create Order | draft, picked book, method or status |
| 21 | Edit Order | `app/(catalogue)/provenance/order-edit-dialog.tsx:171` | Edit form | Save / Create (submit) | draft |
| 22 | Export for Goodreads | `app/(catalogue)/settings/data/data-actions.tsx:90` | Action | Export | none |
| 23 | Reset display settings? | `app/(catalogue)/settings/display/display-settings.tsx:174` | Confirm | Reset | none |
| 24 | Reorder families | `app/(catalogue)/taxonomy/taxonomy-actions.tsx:102` | Edit form | Save order | dirty |
| 25 | Collections | `components/books/add-to-collection-dialog.tsx:218` | Picker (saves each tick) | Done (each tick saves) | none |
| 26 | Configure columns | `components/books/column-config-dialog.tsx:72` | Edit form | Save | dirty + Save |
| 27 | Mark $count | `components/books/mark-read-dialog.tsx:80` | Confirm | Mark as read | none |
| 28 | Match again | `components/books/match-again-dialog.tsx:221` | Picker | Pick a result | none |
| 29 | Edit Work | `components/books/work-quick-edit-dialog.tsx:128` | Edit form | Save / Create (submit) | draft |
| 30 | title | `components/catalogue/confirm-delete-dialog.tsx:35` | Confirm | Delete (danger): Enter does nothing; ⌘Enter deletes (`data-shortcut="save"`); Esc closes | none |
| 31 | Add source | `components/catalogue/sources-section.tsx:142` | Edit form | Save / Create (submit) | draft |
| 32 | Add to your list | `components/catalogue/wanted-section.tsx:152` | Edit form | Save / Create (submit) | draft |
| 33 | Order | `components/catalogue/wanted-section.tsx:155` | Edit form | Save / Create (submit) | draft |
| 34 | Link a work | `components/catalogue/work-relations.tsx:92` | Edit form | Save / Create (submit) | draft |
| 35 | Add to collection | `components/collections/add-books-dialog.tsx:139` | Edit form | Save / Create (submit) | draft |
| 36 | Edit collection | `components/collections/collection-controls.tsx:150` | Edit form | Save / Create (submit) | draft |
| 37 | Delete collection | `components/collections/collection-controls.tsx:196` | Confirm | Delete (danger) | none |
| 38 | New collection | `components/collections/create-collection-dialog.tsx:78` | Edit form | Save / Create (submit) | draft |
| 39 | Review all filtered eBooks | `components/ebooks/review-all-dialog.tsx:46` | Confirm | Review these eBooks | none |
| 40 | titles[action] | `components/ebooks/review-bulk-dialog.tsx:94` | Two-step confirm | Preview next group, then confirm | none |
| 41 | title | `components/ebooks/review-confirm.tsx:40` | Confirm | Confirm | none |
| 42 | `$mode === "automatic_undo | `components/ebooks/unlink-ebook-dialog.tsx:41` | Confirm | Unlink | none |
| 43 | Catalogue status · $work.title | `components/ebooks/work-review-dialog.tsx:56` | Step form | Preview accessioned status, then Confirm status change | none |
| 44 | copy ? "Edit copy | `components/films/copy-dialog.tsx:93` | Edit form | Save / Create (submit) | draft |
| 45 | Edit film | `components/films/film-actions.tsx:61` | Edit form | Save / Create (submit) | draft |
| 46 | Look up on Wikidata | `components/films/source-lookup.tsx:44` | Edit form | Save / Create (submit) | draft |
| 47 | version ? "Edit version | `components/films/version-dialog.tsx:105` | Edit form | Save / Create (submit) | draft |
| 48 | label | `components/media/image-adjustment-editor.tsx:385` | Edit form | Save / Create (submit) | draft |
| 49 | Manage media | `components/media/media-manager-dialog.tsx:360` | Manager (saves each upload) | Done (each upload saves) | none |
| 50 | organization ? "Edit organization | `components/organizations/organization-dialog.tsx:59` | Edit form | Save / Create (submit) | draft |
| 51 | object ? `Edit $ART_OBJECT_KIND_LABELS[kind].toL | `components/paintings/art-object-dialog.tsx:116` | Edit form | Save / Create (submit) | draft |
| 52 | Edit painting | `components/paintings/painting-actions.tsx:60` | Edit form | Save / Create (submit) | draft |
| 53 | Look up in a museum | `components/paintings/source-lookup.tsx:60` | Edit form | Save / Create (submit) | draft |
| 54 | TITLES[mode] | `components/paintings/whereabouts-dialog.tsx:107` | Edit form | Save / Create (submit) | draft |
| 55 | bottle ? `Edit $CONTAINER_LABELS[bottle.containe | `components/perfumes/bottle-dialog.tsx:84` | Edit form | Save / Create (submit) | draft |
| 56 | formulation ? "Edit formulation | `components/perfumes/formulation-dialog.tsx:125` | Edit form | Save / Create (submit) | draft |
| 57 | Edit perfume | `components/perfumes/perfume-actions.tsx:73` | Edit form | Save / Create (submit) | draft |
| 58 | Note a retailer | `components/perfumes/retailers-section.tsx:146` | Edit form | Save / Create (submit) | draft |
| 59 | Record a price | `components/perfumes/retailers-section.tsx:158` | Edit form | Save / Create (submit) | draft |
| 60 | Look up on Wikidata | `components/perfumes/source-lookup.tsx:44` | Edit form | Save / Create (submit) | draft |
| 61 | Page controls | `components/reader/fixed-layout-controls.tsx:22` | Reader-local | reader keys | none |
| 62 | Go to | `components/reader/goto-dialog.tsx:60` | Reader-local | reader keys | none |
| 63 | Note | `components/reader/note-dialog.tsx:84` | Reader-local | reader keys | none |
| 64 | Reading settings | `components/reader/presentation-settings-dialog.tsx:91` | Reader-local | reader keys | none |
| 65 | Reader shortcuts | `components/reader/shortcut-sheet.tsx:14` | Reader-local | reader keys | none |
| 66 | label | `components/reader/speech-options-menu.tsx:85` | Reader-local | reader keys | none |
| 67 | title ?? TITLES[purpose] | `components/reading/book-picker.tsx:86` | Picker | Pick a book | none |
| 68 | Abandon | `components/reading/dialogs/abandon-reading-dialog.tsx:80` | Edit form | Save / Create (submit) | draft |
| 69 | Edit reading | `components/reading/dialogs/edit-reading-dialog.tsx:339` | Edit form | Save / Create (submit) | draft |
| 70 | Finished | `components/reading/dialogs/finish-reading-dialog.tsx:79` | Result | Close | none |
| 71 | Finish | `components/reading/dialogs/finish-reading-dialog.tsx:101` | Edit form | Save / Create (submit) | draft |
| 72 | stopping ? "Stop the timer | `components/reading/dialogs/log-progress-dialog.tsx:230` | Edit form | Save / Create (submit) | draft |
| 73 | editing ? `Edit $noun | `components/reading/dialogs/note-dialog.tsx:187` | Edit form | Save / Create (submit) | draft |
| 74 | Log a past read | `components/reading/dialogs/past-read-dialog.tsx:92` | Edit form | Save / Create (submit) | draft |
| 75 | editing ? "Edit session | `components/reading/dialogs/session-dialog.tsx:235` | Edit form | Save / Create (submit) | draft |
| 76 | Start reading | `components/reading/dialogs/start-reading-dialog.tsx:182` | Edit form | Save / Create (submit) | draft |
| 77 | Set a reading goal | `components/reading/goal-dialog.tsx:98` | Edit form | Save / Create (submit) | draft |
| 78 | Undo this import | `components/reading/import/import-client.tsx:499` | Confirm | Undo import (danger): Enter does nothing; ⌘Enter undoes (`data-shortcut="save"`) | none |
| 79 | Finished this book? | `components/reading/reader-tracking.tsx:297` | Question | Finish reading | none |
| 80 | Remove this highlight? | `components/reading/reader-tracking.tsx:302` | Confirm | Remove (danger) | none |
| 81 | Not for me because… | `components/reading/suggestions/not-for-me-dialog.tsx:32` | Edit form | Save / Create (submit) | draft |
| 82 | Pick one for me | `components/reading/suggestions/pick-one.tsx:43` | Picker | Start reading | none |
| 83 | title | `components/reading/timer-chip.tsx:206` | Question | Stop timer | none |
| 84 | Still reading? | `components/reading/timer-chip.tsx:292` | Question | Still reading | none |
| 85 | A timer is running for $timer.title | `components/reading/timer-chip.tsx:343` | Question | Stop it and start this one | none |
| 86 | elapsed < 60 ? `Discard the timer for $timer.tit | `components/reading/timer-chip.tsx:371` | Confirm | Discard timer (danger) | none |
| 87 | isEdit ? "Edit recommender | `components/recommenders/recommender-form-dialog.tsx:106` | Edit form | Save / Create (submit) | draft |
| 88 | Add books | `components/series/add-series-books-dialog.tsx:88` | Edit form | Save / Create (submit) | draft |
| 89 | isEdit ? "Edit series | `components/series/series-form-dialog.tsx:118` | Edit form | Save / Create (submit) | draft |
| 90 | Keyboard shortcuts | `components/shortcuts/shortcuts-help.tsx:41` | Viewer | Done | none |
| 91 | New taxonomy family | `components/taxonomy/create-family-dialog.tsx:57` | Edit form | Save / Create (submit) | draft |
| 92 | New $familyName | `components/taxonomy/create-item-dialog.tsx:96` | Edit form | Save / Create (submit) | draft |
| 93 | Delete $family.name | `components/taxonomy/delete-family-dialog.tsx:61` | Confirm | Delete (danger) | none |
| 94 | Delete $item.name | `components/taxonomy/delete-item-dialog.tsx:70` | Confirm | Delete (danger) | none |
| 95 | Edit $family.name | `components/taxonomy/edit-family-dialog.tsx:98` | Edit form | Save / Create (submit) | draft |
| 96 | Merge Item | `components/taxonomy/merge-dialog.tsx:77` | Confirm | none: Merge is not pressed by Enter or ⌘Enter, as a danger button (no form) | draft |
| 97 | Unsaved changes | `components/ui/dialog.tsx:232` | Unsaved question | Save (Enter), Discard, Keep editing (Esc) | none |

### Demonstrated (browser-checked) so far

- The #217 review: Esc on clean, typed and changed-back Add book, Add film,
  Add painting, Add perfume, the publisher editor; Edit Work's Esc, Close,
  backdrop and Cancel; a list inside Edit Work taking the first Esc; Add a
  quote; the acquisition-target editor; Configure columns.
- The #223 review: Add book's middle steps offering Save; links, G P, A P
  and the palette asking with typed work; Enter and Shift+Enter in Edit
  Work's Description; IME Enter; a held Enter sending one save; Ctrl+Enter
  in Log a past read's review; Table of contents (fixed: it now keeps
  Enter).
- SLN-638: the edition cover dialog, a typed address asking on Esc.
- SLN-634: 11 dialogs (seven forms, two viewers or managers, the
  Collections picker, Delete collection) at 1280 and 390px, each through
  Enter, Shift+Enter, Esc clean and with typed work, the question's Esc and
  Discard, Close, the backdrop and Done; New order's steps by keyboard.

### Gaps found by this inventory

1. **Viewers have no Done** (resolved in SLN-634). Keyboard shortcuts and
   Resolution record show a Done primary (`Dialog`'s `done`), so Enter
   closes them. "One record, fully connected" is a merge confirmation, not
   a viewer: Enter does not press Merge, as with a danger button.
2. **Pickers and managers** (resolved in SLN-634). Collections and Manage
   media close on Enter through Done. ⌘Enter in their own field (the
   collection name, the image URL) presses that field's Create & add or
   Add (`data-shortcut="save"`), not Done. Pick one for me presses Start
   reading. In Match again the selected source filter is the primary, so
   Enter presses it again and nothing changes.
3. **Danger confirmations** (Delete, Remove highlight, Undo import, Discard
   timer): plain Enter does nothing by design; ⌘Enter presses Delete in the
   shared delete confirmation and Undo import (section 1). SLN-629 says "Plain Enter invokes
   the primary Accept". This needs the owner's word before Enter may delete.
4. **Step dialogs** (browser-checked in SLN-634). In New order, Enter
   presses the visible step's main button: Next on each step, then Create
   Order. A picked book, method or status is unsaved work, so Esc asks
   first (fixed in SLN-634: Esc closed it before). Review bulk eBooks is
   read from source only.
5. **E and A** as in sections 2 and 3.
6. **The leader menu** survived a client navigation (resolved in SLN-632).

## 5. Verification plan for the dependent tickets

On a disposable preview only (`scripts/qa/preview-local.py --start
--seed-large 50 --s3-dir DIR`), headless Chromium, Firefox and WebKit,
Esc sent as key code 27, nothing written to live data.

- **SLN-632:** N opens New; A then B, P, A, U, F, C, I, R, S, L each run
  their one action; A then Esc, A then an unknown key, A held, A with ⌘,
  and A while typing do nothing; a client navigation closes an open menu;
  the help sheet, the palette and the menu show the same keys.
- **SLN-571:** A then F favourites and unfavourites the page's item once
  (held keys too), and A then C opens that item's collections picker, on a
  book, a collection, a person, a publisher, a series, a place and a
  recommender; on a page with no item they fall back as SLN-632 decides.
- **SLN-633:** on each row of section 3, E then each listed letter opens the
  same dialog as the visible button, after a direct load and after a client
  navigation from another family, and never two dialogs.
- **SLN-634:** each row of section 4: Enter (main action once, or nothing
  for a danger button), Shift+Enter, Esc clean, Esc dirty then Keep editing
  and Discard, Close, Cancel and the backdrop; plus the Edit collection
  Description case, IME, held Enter, and a picker inside a form.
