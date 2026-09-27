import { POISON_LABEL } from "./poison";

/**
 * Book marks: personal labels on a work, each stored in its own boolean
 * column. Filters and bulk actions list them as one group. A new mark is one
 * entry here plus its column, badge and action.
 */
export const WORK_MARKS = [
  { key: "rare", label: "Rare" },
  { key: "poison", label: POISON_LABEL },
] as const;

export type WorkMarkKey = (typeof WORK_MARKS)[number]["key"];

/** Name of the group in filters and menus. */
export const MARKS_LABEL = "Marks";

/** Known mark keys from a comma-separated URL value, each once. */
export function parseMarks(value: string | null | undefined): WorkMarkKey[] {
  const known = new Set<string>(WORK_MARKS.map((m) => m.key));
  return [
    ...new Set(
      (value ?? "").split(",").filter((v): v is WorkMarkKey => known.has(v)),
    ),
  ];
}
