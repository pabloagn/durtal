"use server";

import { asc } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { series } from "@/lib/db/schema";
import { getRecommenders } from "@/lib/actions/recommenders";
import {
  getArtMovements,
  getArtTypes,
  getAttributes,
  getCategories,
  getGenres,
  getKeywords,
  getLiteraryMovements,
  getSubjects,
  getTags,
  getThemes,
  getWorkTypes,
} from "@/lib/actions/taxonomy";
import { EDIT_OPTION_GROUPS, type EditOption, type EditOptionGroup } from "@/lib/catalogue/edit-options";

/*
 * The book page's edit dialogs load their choices when they open (SLN-510),
 * not with the page: every list came with every book page, about 180 KB,
 * whether a dialog opened or not. Like every server action, this runs behind
 * the host's Authelia session (docs/11), and Next checks that the call comes
 * from the app's own origin.
 */

const LOADERS: Record<EditOptionGroup, () => Promise<{ id: string; name?: string; title?: string }[]>> = {
  series: () => db.select({ id: series.id, title: series.title }).from(series).orderBy(asc(series.title), asc(series.id)),
  workTypes: getWorkTypes,
  recommenders: getRecommenders,
  genres: getGenres,
  tags: getTags,
  subjects: getSubjects,
  categories: getCategories,
  themes: getThemes,
  literaryMovements: getLiteraryMovements,
  artTypes: getArtTypes,
  artMovements: getArtMovements,
  keywords: getKeywords,
  attributes: getAttributes,
};

const groupsSchema = z.array(z.enum(EDIT_OPTION_GROUPS)).min(1).max(EDIT_OPTION_GROUPS.length);

/** The choices of these lists, each as `{ id, name }` in the order the dialogs show them */
export async function getEditOptions(groups: EditOptionGroup[]): Promise<Partial<Record<EditOptionGroup, EditOption[]>>> {
  const wanted = [...new Set(groupsSchema.parse(groups))];
  const lists = await Promise.all(wanted.map((g) => LOADERS[g]()));
  return Object.fromEntries(wanted.map((g, i) => [g, lists[i].map((x) => ({ id: x.id, name: x.name ?? x.title ?? "" }))]));
}
