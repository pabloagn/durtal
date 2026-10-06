/*
 * The lists the book page's edit dialogs choose from (SLN-510), loaded when a
 * dialog opens through getEditOptions. Pure: the action, the hook and the
 * tests share it.
 */

export const EDIT_OPTION_GROUPS = [
  "series",
  "workTypes",
  "recommenders",
  "genres",
  "tags",
  "subjects",
  "categories",
  "themes",
  "literaryMovements",
  "artTypes",
  "artMovements",
  "keywords",
  "attributes",
] as const;
export type EditOptionGroup = (typeof EDIT_OPTION_GROUPS)[number];

/** Each dialog's lists */
export const WORK_EDIT_GROUPS = ["series", "workTypes", "recommenders"] as const;
export const TAXONOMY_GROUPS = [
  "subjects",
  "categories",
  "themes",
  "literaryMovements",
  "artTypes",
  "artMovements",
  "keywords",
  "attributes",
] as const;
export const EDITION_GROUPS = ["genres", "tags"] as const;
export type TaxonomyGroup = (typeof TAXONOMY_GROUPS)[number];

/** One choice; a series' title is its name */
export interface EditOption {
  id: string;
  name: string;
}

export type EditOptions = Partial<Record<EditOptionGroup, EditOption[]>>;

/**
 * A dialog's list: the items already chosen while the full list loads, so it
 * never shows an empty list and what is selected stays in view; then the
 * full list, with any chosen item it lacks (one created since it loaded).
 */
export function withChosen(loaded: EditOption[] | undefined, chosen: EditOption[]): EditOption[] {
  if (!loaded) return chosen;
  const known = new Set(loaded.map((o) => o.id));
  return [...loaded, ...chosen.filter((c) => !known.has(c.id))];
}
