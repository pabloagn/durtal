# Task 0293: Shared UI Components (SLN-302)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-302: near-copies of UI components, where a fix lands in one copy and not the other. This task makes each free pair one shared component and splits the two large provenance files. Pairs whose files open PRs change wait for those PRs (see Not changed).

Every existing file and export stays, so no page that imports them changes: the shared code is in new files that the old ones wrap.

## Implementation Details

- **Authors** (`src/components/authors/author-form.tsx`): one `AuthorForm` with `mode: "create" | "edit"`, its values type, `authorFormValues(author)` and `authorPayload(values)`. Creating, the name field still offers the sort, first and last names and takes the focus; editing, it is a plain field. Updates go through a state setter, so the name and the names it offers land together. `AuthorCreateDialog` and `AuthorEditDialog` keep their props and behaviour (448 + 436 lines became 131 + 122, beside a 416-line form).
- **Works** (`src/components/books/work-form.tsx`): one `WorkForm` for the book page's Edit Work and the list's quick edit, with `workFormValues`, `workPayload` (the same checks in the same order) and `idPrefix` for the field ids (705 + 669 lines became 139 + 155, beside a 617-line form). The book page still moves to a new address after a title or author change; the quick edit still refreshes the list. The book page's reset on opening no longer uses an effect.
- **Editions and copies**: their add and edit dialogs already shared `EditionForm` and `InstanceForm`; the payload each built twice is now `editionPayload` and `instancePayload` beside the form.
- **Selection** (`src/lib/hooks/use-selection.ts`): one `useSelection`. `useLibrarySelection` and `useAuthorSelection` wrap it, because the pages that import them are changed by open PRs; they can import `useSelection` directly afterwards.
- **Error pages** (`src/components/shared/section-error.tsx`): one `SectionError` (the design system's empty state, with Try again and a back link) for the book, author and provenance error pages and, through `DomainError`, the perfume, film and painting ones. The three book-side pages had their own markup and now look like the collections' error page.
- **Provenance**: `provenance-shell.tsx` (1,286 lines) split into `order-model.ts` (order types, status words and colours, poster, author and date helpers), `pipeline.tsx` (summary cards, order cards, columns) and `order-detail-panel.tsx`; `order-create-dialog.tsx` (881 lines) into the dialog and `order-create-steps.tsx`. The dialog's own status-label map, poster and author helpers were copies of the shell's and now come from `order-model.ts`.

## Completion Notes

- Every changed dialog in **Chrome, Firefox and Safari**, on a disposable copy of the live data, on this branch merged with main d6d0981: create an author; edit one (filled in, saved, still there after a reload); Edit Work on a book page (the same); the list's quick edit (filled in, saved); add and edit an edition; add and edit a copy; the provenance page and the first step of a new order. 9 of 9 pass in each browser. The same flows passed on main's code before the change (Chrome). Safari needed main's dialog fix (SLN-443) first: before it, every dialog in Safari showed only its header.
- Alignment and contrast audit on `/provenance`, `/authors` and a book page at 1440, 768 and 390px: nothing new. Two findings were there before and are on main too: the "Add to collection" icon 8.69px off the title of a book with no ISBN, and two author cards whose link has no name.
- Page weight: `/provenance` 261 KB, the same as main; `/library` is over its budget on main too (SLN-381).
- `pnpm typecheck` clean; `pnpm lint` 0 errors and no new warnings; the full suite (`scripts/qa/test-local.py`) 1,774 of 1,774.

### Not changed (open PRs change these files)

- The two media managers (`media-manager-dialog.tsx` is in #60).
- The two bulk action toolbars (#56, #58, #63).
- Splitting the add-book wizard (#64, #71).
- Callers of `useLibrarySelection` and `useAuthorSelection` (`library-shell.tsx`, `authors-shell.tsx`: #56, #58, #63).
