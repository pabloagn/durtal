import { asc, eq, inArray } from "drizzle-orm";
import { db as appDb } from "@/lib/db";
import { atomicOn } from "@/lib/db/atomic";
import type { Db } from "@/lib/catalogue/work-store";
import { evidenceOutlets } from "@/lib/db/schema";
import { planOutletSeed, seedProblems, type Outlet } from "./outlets";

/** The registry's rows, every status, by key */
export async function loadOutlets(database: Db = appDb): Promise<Outlet[]> {
  const rows = await database.select().from(evidenceOutlets).orderBy(asc(evidenceOutlets.key));
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    domains: r.domains,
    kind: r.kind,
    language: r.language,
    weight: r.weight,
    syndicationGroup: r.syndicationGroup,
    fetchPolicy: r.fetchPolicy,
    termsUrl: r.termsUrl,
    termsCheckedOn: r.termsCheckedOn,
    termsNote: r.termsNote,
    status: r.status,
  }));
}

/**
 * Write a seed version: add and change its outlets, retire the ones that left
 * it, in one transaction. To undo a seed version, apply the previous one.
 */
export async function applyOutletSeed(database: Db, seed: readonly Outlet[], version: number) {
  const problems = seedProblems(seed);
  if (problems.length) throw new Error(`The outlet seed has problems: ${problems.join("; ")}`);
  const plan = planOutletSeed(await loadOutlets(database), seed);
  const values = (o: Outlet) => ({ ...o, seedVersion: version });
  // Retired first: a domain moving to another outlet is free before the outlet that takes it is written
  await atomicOn(database, (d) => [
    ...(plan.retired.length
      ? [d.update(evidenceOutlets).set({ status: "retired", seedVersion: version }).where(inArray(evidenceOutlets.key, plan.retired.map((o) => o.key)))]
      : []),
    ...plan.changed.map(({ after }) => d.update(evidenceOutlets).set(values(after)).where(eq(evidenceOutlets.key, after.key))),
    ...(plan.added.length ? [d.insert(evidenceOutlets).values(plan.added.map(values))] : []),
  ]);
  return plan;
}
