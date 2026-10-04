/**
 * Book marks: personal labels on a work, each stored in its own boolean
 * column. This is their one vocabulary: every badge, toggle, filter, menu,
 * activity line and book-page row takes its words from here. A new mark is
 * one entry here plus its column, badge and action.
 */
export interface WorkMark {
  key: "rare" | "poison" | "favourite";
  /** The work field that holds the mark */
  field: "isRare" | "isPoison" | "isFavourite";
  /** Name on badges, filters and menus: "Rare" */
  label: string;
  /** One marked book: "a Rarity" */
  noun: string;
  /** Marked books: "Other Rarities" */
  plural: string;
  /** Toggle and menu actions */
  markAction: string;
  unmarkAction: string;
  /** What the mark means, for tooltips */
  hint: string;
}

export const WORK_MARKS = [
  {
    key: "rare",
    field: "isRare",
    label: "Rare",
    noun: "Rarity",
    plural: "Rarities",
    markAction: "Mark as rare",
    unmarkAction: "Unmark rare",
    hint: "Hard to find: worth hunting",
  },
  {
    // Stored as `works.is_poison`; shown as "Anathema"
    key: "poison",
    field: "isPoison",
    label: "Anathema",
    noun: "Anathema",
    plural: "Anathemas",
    markAction: "Mark as anathema",
    unmarkAction: "Unmark anathema",
    hint: "Explicit or transgressive: dangerous to recommend",
  },
  {
    // The same star as every other favourite (`FavouriteToggle`)
    key: "favourite",
    field: "isFavourite",
    label: "Favourite",
    noun: "Favourite",
    plural: "Favourites",
    markAction: "Mark as favourite",
    unmarkAction: "Remove favourite",
    hint: "One of your favourites",
  },
] as const satisfies readonly WorkMark[];

export type WorkMarkKey = (typeof WORK_MARKS)[number]["key"];

/** Each mark by key: `MARKS.poison.label` */
export const MARKS = Object.fromEntries(
  WORK_MARKS.map((mark) => [mark.key, mark]),
) as { [K in WorkMarkKey]: Extract<(typeof WORK_MARKS)[number], { key: K }> };

/** Name of the group in filters and menus. */
export const MARKS_LABEL = "Marks";

/** Title of the book-page row of other books with a mark: "Other Rarities". */
export function otherMarkedTitle(mark: WorkMark) {
  return `Other ${mark.plural}`;
}

/** The marks a work has, in registry order. */
export function marksOf(work: { [F in WorkMark["field"]]?: boolean | null }) {
  return WORK_MARKS.filter((mark) => work[mark.field]);
}

/** Known mark keys from a comma-separated URL value, each once. */
export function parseMarks(value: string | null | undefined): WorkMarkKey[] {
  const known = new Set<string>(WORK_MARKS.map((m) => m.key));
  return [
    ...new Set(
      (value ?? "").split(",").filter((v): v is WorkMarkKey => known.has(v)),
    ),
  ];
}
