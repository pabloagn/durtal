/** Stable identity of a work's medium. Descriptive work types are taxonomies. */
export const WORK_KINDS = ["book", "film", "perfume", "painting"] as const;

export type WorkKind = (typeof WORK_KINDS)[number];

export function isWorkKind(value: unknown): value is WorkKind {
  return typeof value === "string" && WORK_KINDS.some((kind) => kind === value);
}
