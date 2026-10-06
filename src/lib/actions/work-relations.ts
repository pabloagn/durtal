"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { withReadableErrors } from "@/lib/db/errors";
import { sourceRecords, workRelations, works } from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { getEnabledWorkKinds, WORK_DOMAINS } from "@/lib/catalogue/domains";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";
import {
  WORK_RELATION_PAIRS,
  WORK_RELATION_TYPES,
  relationAllowed,
  relationNeedsSource,
  type WorkRelationType,
} from "@/lib/catalogue/work-relations";
import { sourceUrlSchema } from "@/lib/catalogue/provenance";
import { textSearchCondition } from "./utils/text-search";
import { citeSource, deleteCitedSource } from "./catalogue-provenance";

/** The address of a work's page, whatever its collection */
function workHref(kind: WorkKind, slug: string | null, id: string) {
  return `${WORK_DOMAINS[kind].basePath}/${slug ?? id}`;
}

/** Who a work is by: a book's authors, else its directors, perfumers or painters */
const creators = (work: SQL) => sql`coalesce(
  (select string_agg(a.name, ', ' order by wa.sort_order, wa.id) from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = ${work}),
  (select string_agg(coalesce(a.name, c.credited_as), ', ' order by c.sort_order, c.id) from work_credits c left join authors a on a.id = c.person_id
    where c.work_id = ${work} and c.role_id in ('film.director', 'perfume.perfumer', 'painting.painter') and coalesce(a.name, c.credited_as) is not null)
)`;

export interface WorkRelationView {
  id: string;
  type: WorkRelationType;
  /** Outgoing: this work is the adaptation, remake, flanker or the inspired one */
  direction: "outgoing" | "incoming";
  notes: string | null;
  other: {
    id: string;
    kind: WorkKind;
    title: string;
    href: string;
    creators: string | null;
  };
  source: { id: string; label: string; url: string | null } | null;
}

/**
 * Every link of a work, both ways, with the work at the other end and the
 * cited source. Only links someone recorded: similarity never adds one.
 */
export async function getWorkRelations(workId: string): Promise<WorkRelationView[]> {
  z.uuid().parse(workId);
  const rows = resultRows<{
    id: string;
    type: WorkRelationType;
    direction: "outgoing" | "incoming";
    notes: string | null;
    otherId: string;
    otherKind: WorkKind;
    otherTitle: string;
    otherSlug: string | null;
    creators: string | null;
    sourceId: string | null;
    sourceLabel: string | null;
    sourceUrl: string | null;
  }>(
    await db.execute(sql`select r.id, r.type, r.notes,
        case when r.from_work_id = ${workId}::uuid then 'outgoing' else 'incoming' end as direction,
        o.id as "otherId", o.kind as "otherKind", o.title as "otherTitle", o.slug as "otherSlug",
        ${creators(sql`o.id`)} as creators,
        s.id as "sourceId", coalesce(s.attribution, s.provider) as "sourceLabel", s.url as "sourceUrl"
      from work_relations r
      join works o on o.id = case when r.from_work_id = ${workId}::uuid then r.to_work_id else r.from_work_id end
      left join source_records s on s.id = r.source_record_id
      where r.from_work_id = ${workId}::uuid or r.to_work_id = ${workId}::uuid
      order by r.type, direction desc, lower(o.title), o.id`),
  );
  const enabled = new Set(getEnabledWorkKinds());
  return rows
    .filter((row) => enabled.has(row.otherKind))
    .map((row) => ({
      id: row.id,
      type: row.type,
      direction: row.direction,
      notes: row.notes,
      other: {
        id: row.otherId,
        kind: row.otherKind,
        title: row.otherTitle,
        href: workHref(row.otherKind, row.otherSlug, row.otherId),
        creators: row.creators,
      },
      source: row.sourceId
        ? { id: row.sourceId, label: row.sourceLabel ?? "Source", url: row.sourceUrl }
        : null,
    }));
}

/** Works to link to, by title, in the open collections of `kinds` */
export async function searchWorksForRelation(input: {
  query: string;
  kinds: WorkKind[];
  excludeId: string;
}) {
  const { query, kinds, excludeId } = z
    .object({
      query: z.string().trim().max(200),
      kinds: z.array(z.enum(WORK_KINDS)).min(1).max(4),
      excludeId: z.uuid(),
    })
    .parse(input);
  const open = kinds.filter((kind) => getEnabledWorkKinds().includes(kind));
  if (!open.length) return [];
  const match = query ? textSearchCondition(sql`search_normalize(w.title)`, query) : undefined;
  const rows = resultRows<{ id: string; kind: WorkKind; title: string; creators: string | null }>(
    await db.execute(sql`select w.id, w.kind, w.title, ${creators(sql`w.id`)} as creators
      from works w
      where w.kind in (${sql.join(
        open.map((kind) => sql`${kind}`),
        sql`, `,
      )}) and w.id <> ${excludeId}::uuid ${match ? sql`and ${match}` : sql``}
      order by lower(w.title), w.id limit 8`),
  );
  return rows;
}

/** The sources a link from this work may cite: those of the work itself */
export async function getWorkSourceChoices(workId: string) {
  z.uuid().parse(workId);
  const work = await db.query.works.findFirst({
    where: eq(works.id, workId),
    columns: { kind: true },
  });
  if (!work) return [];
  // The 100 newest observations, the user's own citations first: evidence
  // pages of the book enrichment (SLN-468) never push them out of the list
  const observations = await db
    .select({ id: sourceRecords.id, provider: sourceRecords.provider, attribution: sourceRecords.attribution })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.entityKind, work.kind), eq(sourceRecords.workId, workId)))
    .orderBy(
      desc(sql`(${sourceRecords.payload} ->> 'entry') is not distinct from 'manual'`),
      desc(sourceRecords.retrievedAt),
      desc(sourceRecords.id),
    )
    .limit(100);
  return observations.map((o) => ({
    id: o.id,
    label: o.attribution ?? o.provider,
  }));
}

const relationSchema = z.strictObject({
  type: z.enum(WORK_RELATION_TYPES),
  /** The adaptation, remake, flanker or inspired work */
  fromWorkId: z.uuid(),
  /** The work it adapts, remakes, flanks or draws on */
  toWorkId: z.uuid(),
  /** A source of the first work */
  sourceRecordId: z.uuid().nullable().default(null),
  /** Or a new source of the first work, recorded with the link */
  newSource: z
    .strictObject({
      attribution: z.string().trim().min(1).max(1000),
      url: sourceUrlSchema.nullable().default(null),
      retrievedOn: z.iso.date(),
    })
    .nullable()
    .default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
});
export type WorkRelationInput = z.input<typeof relationSchema>;

const TYPE_NAMES: Record<WorkRelationType, string> = {
  adaptation: "An adaptation",
  remake: "A remake",
  flanker: "A flanker",
  inspiration: "An inspiration",
};
const KIND_NAMES: Record<WorkKind, string> = {
  book: "a book",
  film: "a film",
  perfume: "a perfume",
  painting: "a painting",
};

/**
 * Records that one work adapts, remakes, flanks or draws on another. The
 * kinds must fit the type; an inspiration cites a source of the first work.
 * A new source is recorded first and removed again if the link is refused.
 */
export async function createWorkRelation(input: WorkRelationInput) {
  const v = relationSchema.parse(input);
  if (v.fromWorkId === v.toWorkId) throw new Error("A work cannot be linked to itself");
  if (v.sourceRecordId && v.newSource) throw new Error("Cite one source");
  const ends = await db
    .select({ id: works.id, kind: works.kind, title: works.title })
    .from(works)
    .where(sql`${works.id} in (${v.fromWorkId}::uuid, ${v.toWorkId}::uuid)`);
  const from = ends.find((w) => w.id === v.fromWorkId);
  const to = ends.find((w) => w.id === v.toWorkId);
  if (!from || !to) throw new Error("Work not found");
  if (!relationAllowed(v.type, from.kind, to.kind)) {
    const pairs = WORK_RELATION_PAIRS[v.type] ?? [];
    throw new Error(
      `${TYPE_NAMES[v.type]} joins ${pairs.map(([f, t]) => `${KIND_NAMES[f]} to ${KIND_NAMES[t]}`).join(" or ")}`,
    );
  }
  if (relationNeedsSource(v.type) && !v.sourceRecordId && !v.newSource)
    throw new Error("An inspiration needs a source: say where it is stated");
  if (v.sourceRecordId) {
    const [source] = await db
      .select({ workId: sourceRecords.workId })
      .from(sourceRecords)
      .where(eq(sourceRecords.id, v.sourceRecordId));
    if (source?.workId !== from.id)
      throw new Error(`Cite a source of ${from.title}`);
  }
  const cited = v.newSource
    ? await citeSource({
        owner: { kind: from.kind, id: from.id },
        attribution: v.newSource.attribution,
        url: v.newSource.url,
        retrievedOn: v.newSource.retrievedOn,
      })
    : null;
  const id = randomUUID();
  try {
    await withReadableErrors(
      () =>
        db.insert(workRelations).values({
          id,
          type: v.type,
          fromWorkId: from.id,
          fromKind: from.kind,
          toWorkId: to.id,
          toKind: to.kind,
          sourceRecordId: cited?.id ?? v.sourceRecordId,
          notes: v.notes || null,
        }),
      { unique: "These two works are already linked this way" },
    );
  } catch (error) {
    // The new source was recorded for this link only
    if (cited) await deleteCitedSource(cited.id).catch(() => undefined);
    throw error;
  }
  invalidate(CACHE_TAGS.works);
  return { id };
}

/** Removes a link; its cited source stays with the work */
export async function deleteWorkRelation(id: string) {
  z.uuid().parse(id);
  const [row] = await db
    .delete(workRelations)
    .where(eq(workRelations.id, id))
    .returning({ id: workRelations.id });
  if (!row) throw new Error("Link not found");
  invalidate(CACHE_TAGS.works);
  return row;
}
