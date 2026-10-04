import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";
import type { ActivityMetadata } from "./types";

/**
 * What a work's history compares before and after an edit: its title, its
 * credits (person or credited name, by role), its organizations (by role)
 * and its classification (custom taxonomy items and art movements).
 */
export interface WorkSnapshot {
  title: string;
  credits: Map<string, { name: string; role: string }>;
  organizations: Map<string, { name: string; role: string }>;
  classification: Map<string, { name: string; family: string }>;
}

const ORGANIZATION_ROLES: Record<string, string> = {
  perfume_house: "Perfume house",
  brand: "Brand",
  manufacturer: "Manufacturer",
  production_company: "Production company",
};

/** One read of everything `recordWorkChanges` compares; null when the work is gone */
export async function workSnapshot(id: string): Promise<WorkSnapshot | null> {
  const [row] = resultRows<{
    title: string;
    credits: { key: string; name: string; role: string }[];
    organizations: { key: string; name: string; role: string }[];
    classification: { key: string; name: string; family: string }[];
  }>(
    await db.execute(sql`select w.title,
      coalesce((select jsonb_agg(jsonb_build_object(
          'key', c.role_id || ':' || coalesce(c.person_id::text, c.credited_as, c.attribution::text),
          'name', coalesce(c.credited_as, a.name, initcap(c.attribution::text)),
          'role', r.label))
        from work_credits c join credit_roles r on r.id = c.role_id left join authors a on a.id = c.person_id
        where c.work_id = w.id), '[]') as credits,
      coalesce((select jsonb_agg(jsonb_build_object('key', o.role || ':' || o.organization_id, 'name', p.name, 'role', o.role))
        from (select organization_id, role from perfume_organizations where work_id = w.id
          union all select organization_id, role from film_organizations where work_id = w.id) o
        join publishing_houses p on p.id = o.organization_id), '[]') as organizations,
      coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name, 'family', t.family)) from (
          select i.id::text as key, i.name, f.name as family from custom_taxonomy_item_works l
            join custom_taxonomy_items i on i.id = l.item_id join taxonomy_families f on f.id = i.family_id
            where l.work_id = w.id
          union all select m.id::text, m.name, 'Art movements' from work_art_movements l
            join art_movements m on m.id = l.art_movement_id where l.work_id = w.id
        ) t), '[]') as classification
      from works w where w.id = ${id}::uuid`),
  );
  if (!row) return null;
  return {
    title: row.title,
    credits: new Map(row.credits.map(({ key, ...rest }) => [key, rest])),
    organizations: new Map(
      row.organizations.map(({ key, role, name }) => [key, { name, role: ORGANIZATION_ROLES[role] ?? role }]),
    ),
    classification: new Map(row.classification.map(({ key, ...rest }) => [key, rest])),
  };
}

/**
 * Records history entries for a work, awaited but never failing the edit
 * that made them: a failure is logged and the edit stands.
 */
export async function recordWorkEvents(
  workId: string,
  events: { eventKey: string; metadata: ActivityMetadata }[],
) {
  if (!events.length) return;
  try {
    await db.insert(activityEvents).values(
      events.map((e) => ({ entityType: "work", entityId: workId, eventKey: e.eventKey, metadata: e.metadata })),
    );
  } catch (err) {
    console.error("[activity] Failed to record work events:", events.map((e) => e.eventKey), err);
  }
}

/**
 * The history of one edit, as readable differences: a new title, each credit
 * and organization added or removed with its role, each classification item
 * added or removed with its family. Nothing is recorded for an edit that
 * changed none of these.
 */
export async function recordWorkChanges(workId: string, before: WorkSnapshot | null, after: WorkSnapshot | null) {
  if (!before || !after) return;
  const events: { eventKey: string; metadata: ActivityMetadata }[] = [];
  if (before.title !== after.title)
    events.push({ eventKey: "work.title_changed", metadata: { oldValue: before.title, newValue: after.title } });
  const diff = <T extends { name: string }>(
    a: Map<string, T>,
    b: Map<string, T>,
    added: string,
    removed: string,
    extra: (item: T) => Record<string, unknown>,
  ) => {
    for (const [key, item] of b)
      if (!a.has(key)) events.push({ eventKey: added, metadata: { targetName: item.name, extra: extra(item) } });
    for (const [key, item] of a)
      if (!b.has(key)) events.push({ eventKey: removed, metadata: { targetName: item.name, extra: extra(item) } });
  };
  diff(before.credits, after.credits, "work.credit_added", "work.credit_removed", (c) => ({ role: c.role }));
  diff(
    before.organizations,
    after.organizations,
    "work.organization_added",
    "work.organization_removed",
    (o) => ({ role: o.role }),
  );
  diff(
    before.classification,
    after.classification,
    "work.classification_added",
    "work.classification_removed",
    (t) => ({ family: t.family }),
  );
  await recordWorkEvents(workId, events);
}
