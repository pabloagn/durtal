import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod/v4";

// The edit dialogs' lists (SLN-510): only the groups asked for, each as { id, name }

const { databaseAccess, loaded, getter } = vi.hoisted(() => {
  const loaded: string[] = [];
  return {
    databaseAccess: vi.fn(),
    loaded,
    // A cached list getter: its rows carry more than the dialogs need
    getter: (name: string) => async () => {
      loaded.push(name);
      return [{ id: `${name}-1`, name: `${name} one`, slug: "extra" }];
    },
  };
});
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        orderBy: async () => {
          databaseAccess();
          return [{ id: "s1", title: "The Dark Tower" }];
        },
      }),
    }),
  },
}));
vi.mock("@/lib/actions/taxonomy", () => ({
  getWorkTypes: getter("workTypes"),
  getGenres: getter("genres"),
  getTags: getter("tags"),
  getSubjects: getter("subjects"),
  getCategories: getter("categories"),
  getThemes: getter("themes"),
  getLiteraryMovements: getter("literaryMovements"),
  getArtTypes: getter("artTypes"),
  getArtMovements: getter("artMovements"),
  getKeywords: getter("keywords"),
  getAttributes: getter("attributes"),
}));
vi.mock("@/lib/actions/recommenders", () => ({ getRecommenders: getter("recommenders") }));

import { getEditOptions } from "@/lib/actions/edit-options";
import type { EditOptionGroup } from "@/lib/catalogue/edit-options";

describe("getEditOptions", () => {
  it("loads only the groups asked for, each item as { id, name }", async () => {
    loaded.length = 0;
    const lists = await getEditOptions(["genres", "series", "genres"]);
    expect(Object.keys(lists).sort()).toEqual(["genres", "series"]);
    expect(lists.genres).toEqual([{ id: "genres-1", name: "genres one" }]);
    // A series' title is its name
    expect(lists.series).toEqual([{ id: "s1", name: "The Dark Tower" }]);
    expect(loaded).toEqual(["genres"]);
  });

  it.each([[[]], [["genres", "passwords"]], [["series", 7]]])("refuses %j before reading anything", async (groups) => {
    loaded.length = 0;
    databaseAccess.mockClear();
    await expect(getEditOptions(groups as EditOptionGroup[])).rejects.toBeInstanceOf(ZodError);
    expect(loaded).toEqual([]);
    expect(databaseAccess).not.toHaveBeenCalled();
  });
});
