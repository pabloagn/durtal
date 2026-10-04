import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { catalogueDateText } from "@/lib/catalogue/dates";
import { formatRuntime } from "@/lib/catalogue/film-labels";
import { formulationName } from "@/lib/catalogue/perfume-labels";
import { ownerText, type ArtOwnership } from "@/lib/catalogue/painting-labels";
import { loadFilmCards } from "@/lib/catalogue/film-store";
import { loadPaintingCards } from "@/lib/catalogue/painting-store";
import { loadPerfumeCards } from "@/lib/catalogue/perfume-store";
import { uuids } from "@/lib/catalogue/work-store";
import { stripHtmlToText } from "@/lib/utils/sanitize";

/** The collections other than books that export as one row per record. */
export const COLLECTION_EXPORTS = {
  perfumes: "perfume",
  films: "film",
  paintings: "painting",
} as const;
export type CollectionExport = keyof typeof COLLECTION_EXPORTS;

const CHUNK = 500;

/** The records of a kind with these ids, or every one (null), by title */
async function exportIds(kind: string, ids: string[] | null) {
  const rows = resultRows<{ id: string }>(
    await db.execute(sql`select id from works where kind=${kind}::work_kind_enum
      ${ids ? sql`and id in (${uuids(ids)})` : sql``}
      order by lower(title), id`),
  );
  return rows.map((row) => row.id);
}

async function inChunks<T>(ids: string[], load: (ids: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await load(ids.slice(i, i + CHUNK))));
  return out;
}

/** Each work's personal notes and description, as plain text */
async function workTexts(ids: string[]) {
  if (!ids.length) return new Map<string, { notes: string; description: string }>();
  const rows = resultRows<{ id: string; notes: string | null; description: string | null }>(
    await db.execute(sql`select id, notes, description from works where id in (${uuids(ids)})`),
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        notes: r.notes ? stripHtmlToText(r.notes) : "",
        description: r.description ? stripHtmlToText(r.description) : "",
      },
    ]),
  );
}

/** Each work's classification names, by family slug */
async function workTerms(ids: string[]) {
  const terms = new Map<string, Map<string, string[]>>();
  if (!ids.length) return terms;
  const rows = resultRows<{ workId: string; family: string; name: string }>(
    await db.execute(sql`select t.work_id as "workId", f.slug as family, i.name
      from custom_taxonomy_item_works t join custom_taxonomy_items i on i.id=t.item_id
      join taxonomy_families f on f.id=i.family_id
      where t.work_id in (${uuids(ids)}) order by f.slug, lower(i.name), i.id`),
  );
  for (const r of rows) {
    const byFamily = terms.get(r.workId) ?? new Map<string, string[]>();
    byFamily.set(r.family, [...(byFamily.get(r.family) ?? []), r.name]);
    terms.set(r.workId, byFamily);
  }
  return terms;
}
const list = (names: (string | null | undefined)[]) =>
  names.filter((n): n is string => !!n).join("; ");
const term = (terms: Map<string, Map<string, string[]>>, id: string, family: string) =>
  list(terms.get(id)?.get(family) ?? []);

async function perfumeRows(ids: string[]) {
  const cards = await inChunks(ids, loadPerfumeCards);
  const [texts, terms, notes] = await Promise.all([
    workTexts(ids),
    workTerms(ids),
    ids.length
      ? db.execute(sql`select n.work_id as "workId", n.position, i.name
          from perfume_notes n join custom_taxonomy_items i on i.id=n.item_id
          where n.work_id in (${uuids(ids)}) order by n.position, n.sort_order, i.id`)
      : Promise.resolve(null),
  ]);
  const noteRows = notes ? resultRows<{ workId: string; position: string; name: string }>(notes) : [];
  const notesAt = (id: string, position: string) =>
    list(noteRows.filter((n) => n.workId === id && n.position === position).map((n) => n.name));
  return cards.map((p) => ({
    title: p.title,
    houses: list(p.organizations.filter((o) => o.role !== "manufacturer").map((o) => o.name)),
    manufacturers: list(p.organizations.filter((o) => o.role === "manufacturer").map((o) => o.name)),
    perfumers: list(p.perfumers.map((x) => x.name)),
    released: catalogueDateText(p.releaseDate) ?? "",
    concentrations: list([...new Set(p.formulations.map((f) => formulationName(f)))]),
    families: term(terms, p.id, "perfume-families"),
    accords: term(terms, p.id, "perfume-accords"),
    top_notes: notesAt(p.id, "top"),
    heart_notes: notesAt(p.id, "heart"),
    base_notes: notesAt(p.id, "base"),
    other_notes: notesAt(p.id, "unspecified"),
    bottles: p.holdings.bottles,
    samples: p.holdings.samples,
    decants: p.holdings.decants,
    rating: p.rating ?? "",
    favourite: p.isFavourite ? "yes" : "no",
    notes: texts.get(p.id)?.notes ?? "",
    description: texts.get(p.id)?.description ?? "",
  }));
}

async function filmRows(ids: string[]) {
  const cards = await inChunks(ids, loadFilmCards);
  const [texts, terms, credits, languages] = await Promise.all([
    workTexts(ids),
    workTerms(ids),
    ids.length
      ? db.execute(sql`select c.work_id as "workId", c.role_id as role, coalesce(c.credited_as, a.name) as name
          from work_credits c left join authors a on a.id=c.person_id
          where c.work_id in (${uuids(ids)}) and c.role_id in ('film.screenwriter','film.cast')
          order by c.sort_order, c.id`)
      : Promise.resolve(null),
    ids.length
      ? db.execute(sql`select x.work_id as "workId", l.name from film_languages x join languages l on l.id=x.language_id
          where x.work_id in (${uuids(ids)}) order by x.sort_order, l.id`)
      : Promise.resolve(null),
  ]);
  const creditRows = credits ? resultRows<{ workId: string; role: string; name: string | null }>(credits) : [];
  const languageRows = languages ? resultRows<{ workId: string; name: string }>(languages) : [];
  const credited = (id: string, role: string) =>
    list(creditRows.filter((c) => c.workId === id && c.role === role).map((c) => c.name));
  return cards.map((f) => ({
    title: f.title,
    original_title: f.originalTitle ?? "",
    directors: list(f.directors.map((d) => d.name)),
    writers: credited(f.id, "film.screenwriter"),
    cast: credited(f.id, "film.cast"),
    released: catalogueDateText(f.releaseDate) ?? "",
    runtime: formatRuntime(f.runtimeSeconds) ?? "",
    countries: list(f.countries.map((c) => c.name)),
    languages: list(languageRows.filter((l) => l.workId === f.id).map((l) => l.name)),
    genres: term(terms, f.id, "film-genres"),
    physical_copies: f.holdings.physical,
    digital_copies: f.holdings.digital,
    rating: f.rating ?? "",
    favourite: f.isFavourite ? "yes" : "no",
    notes: texts.get(f.id)?.notes ?? "",
    description: texts.get(f.id)?.description ?? "",
  }));
}

async function paintingRows(ids: string[]) {
  const cards = await inChunks(ids, loadPaintingCards);
  const [texts, terms, movements] = await Promise.all([
    workTexts(ids),
    workTerms(ids),
    ids.length
      ? db.execute(sql`select wm.work_id as "workId", m.name from work_art_movements wm
          join art_movements m on m.id=wm.art_movement_id
          where wm.work_id in (${uuids(ids)}) order by lower(m.name), m.id`)
      : Promise.resolve(null),
  ]);
  const movementRows = movements ? resultRows<{ workId: string; name: string }>(movements) : [];
  return cards.map((p) => {
    const o = p.primaryObject;
    return {
      title: p.title,
      painters: list(p.painters.map((x) => x.name)),
      painted: catalogueDateText(p.creationDate) ?? "",
      movements: list(movementRows.filter((m) => m.workId === p.id).map((m) => m.name)),
      genres: term(terms, p.id, "painting-genres"),
      techniques: term(terms, p.id, "painting-techniques"),
      media: term(terms, p.id, "painting-media"),
      supports: term(terms, p.id, "painting-supports"),
      original: o ? (o.kind === "version" ? `Version${o.label ? `: ${o.label}` : ""}` : (o.label ?? "Original")) : "",
      original_owner: o
        ? ownerText({ ownership: o.ownership as ArtOwnership, ownerName: o.owner, ownerLabel: o.owner })
        : "",
      height_cm: o?.heightCm ?? "",
      width_cm: o?.widthCm ?? "",
      objects_owned: p.personalCount,
      rating: p.rating ?? "",
      favourite: p.isFavourite ? "yes" : "no",
      notes: texts.get(p.id)?.notes ?? "",
      description: texts.get(p.id)?.description ?? "",
    };
  });
}

/**
 * The rows of a collection export: these records, or every one (null), one
 * row each in title order. Records of another kind are left out.
 */
export async function collectionExportRows(
  entity: "perfumes",
  ids: string[] | null,
): Promise<Awaited<ReturnType<typeof perfumeRows>>>;
export async function collectionExportRows(
  entity: "films",
  ids: string[] | null,
): Promise<Awaited<ReturnType<typeof filmRows>>>;
export async function collectionExportRows(
  entity: "paintings",
  ids: string[] | null,
): Promise<Awaited<ReturnType<typeof paintingRows>>>;
export async function collectionExportRows(
  entity: CollectionExport,
  ids: string[] | null,
): Promise<Record<string, string | number>[]>;
export async function collectionExportRows(entity: CollectionExport, ids: string[] | null) {
  const found = await exportIds(COLLECTION_EXPORTS[entity], ids);
  if (entity === "perfumes") return perfumeRows(found);
  if (entity === "films") return filmRows(found);
  return paintingRows(found);
}
