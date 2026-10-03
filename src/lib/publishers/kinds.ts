/**
 * The three levels of publishing houses (task 0179), as the book trade uses
 * them: a group owns publishers, a publisher owns imprints, and the imprint
 * is the brand printed on the book. Pure module.
 */
export const HOUSE_KINDS = ["group", "publisher", "imprint"] as const;
export type HouseKind = (typeof HOUSE_KINDS)[number];

export const HOUSE_KIND_LABEL: Record<HouseKind, string> = {
  group: "Group",
  publisher: "Publisher",
  imprint: "Imprint",
};

/** The type a parent must have: imprints sit under publishers, publishers under groups */
export const PARENT_KIND: Record<HouseKind, HouseKind | null> = {
  group: null,
  publisher: "group",
  imprint: "publisher",
};

/** "Imprint of Penguin Books" / "Part of Penguin Random House", or null */
export function parentPhrase(
  kind: string,
  parentName: string | null | undefined,
): string | null {
  if (!parentName) return null;
  return kind === "imprint"
    ? `Imprint of ${parentName}`
    : `Part of ${parentName}`;
}
