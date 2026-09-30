"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  works,
  editions,
  workAuthors,
  editionContributors,
  workCredits,
  creditRoles,
} from "@/lib/db/schema";
import { creditListSchema, type CreditInput } from "@/lib/validations/people";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";
import type { CreditLevel } from "@/lib/catalogue/credits";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { assertSql, resultRows } from "@/lib/harmonization/store";

function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.authors);
}
export async function getCreditRoles(
  kind: WorkKind,
  level: CreditLevel = "work",
) {
  z.enum(WORK_KINDS).parse(kind);
  z.enum(["work", "edition"]).parse(level);
  return db
    .select()
    .from(creditRoles)
    .where(and(eq(creditRoles.kind, kind), eq(creditRoles.level, level)))
    .orderBy(asc(creditRoles.label), asc(creditRoles.id));
}

export async function getWorkCredits(workId: string) {
  z.uuid().parse(workId);
  const work = await db.query.works.findFirst({
    where: eq(works.id, workId),
    columns: { kind: true },
  });
  if (!work) return [];
  if (work.kind !== "book")
    return db.query.workCredits.findMany({
      where: eq(workCredits.workId, workId),
      orderBy: [asc(workCredits.sortOrder), asc(workCredits.id)],
      with: {
        person: { columns: { id: true, name: true, slug: true } },
        role: true,
      },
    });
  const roles = await getCreditRoles("book");
  const credits = await db.query.workAuthors.findMany({
    where: eq(workAuthors.workId, workId),
    orderBy: [asc(workAuthors.sortOrder), asc(workAuthors.id)],
    with: { author: { columns: { id: true, name: true, slug: true } } },
  });
  return credits.map((credit) => ({
    ...credit,
    personId: credit.authorId,
    person: credit.author,
    roleId: roles.find((role) => role.legacyRole === credit.role)!.id,
    role: roles.find((role) => role.legacyRole === credit.role)!,
    characters: [] as string[],
    notes: null,
  }));
}

export async function getEditionCredits(editionId: string) {
  z.uuid().parse(editionId);
  const roles = await getCreditRoles("book", "edition");
  const credits = await db.query.editionContributors.findMany({
    where: eq(editionContributors.editionId, editionId),
    orderBy: [asc(editionContributors.sortOrder), asc(editionContributors.id)],
    with: { author: { columns: { id: true, name: true, slug: true } } },
  });
  return credits.map((credit) => ({
    ...credit,
    personId: credit.authorId,
    person: credit.author,
    roleId: roles.find((role) => role.legacyRole === credit.role)!.id,
    role: roles.find((role) => role.legacyRole === credit.role)!,
  }));
}

async function validatedCredits(
  kind: WorkKind,
  level: CreditLevel,
  input: CreditInput[],
) {
  const credits = creditListSchema.parse(input);
  const roles = await getCreditRoles(kind, level);
  for (const credit of credits) {
    if (!roles.some((role) => role.id === credit.roleId))
      throw new Error(
        "Contribution role does not apply to this domain and level",
      );
    if (kind === "book" && (!credit.personId || credit.notes !== null))
      throw new Error(
        "Book credits require a known person; use the book's notes for attribution commentary",
      );
  }
  if (
    kind === "book" &&
    new Set(credits.map((credit) => `${credit.personId}:${credit.roleId}`))
      .size !== credits.length
  )
    throw new Error("A book contribution can list each person and role once");
  return { credits, roles };
}

function requireOwnedCreditIds(
  credits: { id?: string }[],
  existing: { id: string }[],
) {
  const ids = new Set(existing.map((credit) => credit.id));
  if (credits.some((credit) => credit.id && !ids.has(credit.id)))
    throw new Error("A credit ID belongs to a different record or was removed");
}

// Compare the physical rows again after locking their owner. This detects a
// concurrent replacement or merge between our read and the atomic write.
function creditFingerprint(
  table: "work_authors" | "work_credits" | "edition_contributors",
  ownerId: string,
) {
  const column = table === "edition_contributors" ? "edition_id" : "work_id";
  return sql`(select md5(coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb)::text) from ${sql.identifier(table)} c where ${sql.identifier(column)} = ${ownerId}::uuid)`;
}
async function readFingerprint(
  expression: ReturnType<typeof creditFingerprint>,
) {
  return resultRows<{ fingerprint: string }>(
    await db.execute(sql`select ${expression} as fingerprint`),
  )[0].fingerprint;
}

/** Ordered replacement is atomic. Repeated film roles and characters keep IDs. */
export async function replaceWorkCredits(workId: string, input: CreditInput[]) {
  z.uuid().parse(workId);
  creditListSchema.parse(input);
  const work = await db.query.works.findFirst({
    where: eq(works.id, workId),
    columns: { kind: true },
  });
  if (!work) throw new Error("Work not found");
  const { credits, roles } = await validatedCredits(work.kind, "work", input);
  const fingerprint = creditFingerprint(
    work.kind === "book" ? "work_authors" : "work_credits",
    workId,
  );
  const expected = await readFingerprint(fingerprint);
  const existing = await getWorkCredits(workId);
  requireOwnedCreditIds(credits, existing);
  const guard = assertSql(
    sql`exists (select 1 from works where id = ${workId}::uuid) and ${fingerprint} = ${expected}`,
    "Credits changed while saving; reload before trying again",
  );
  if (work.kind === "book") {
    const values = credits.map((credit, sortOrder) => ({
      id:
        credit.id ??
        existing.find(
          (old) =>
            old.personId === credit.personId && old.roleId === credit.roleId,
        )?.id ??
        randomUUID(),
      workId,
      authorId: credit.personId!,
      role: roles.find((role) => role.id === credit.roleId)!.legacyRole!,
      creditedAs: credit.creditedAs,
      attribution: credit.attribution,
      sortOrder,
    }));
    await atomic((d) => [
      d.execute(
        sql`select id from works where id = ${workId}::uuid for update`,
      ),
      d.execute(guard),
      d.delete(workAuthors).where(eq(workAuthors.workId, workId)),
      ...(values.length ? [d.insert(workAuthors).values(values)] : []),
    ]);
  } else {
    await atomic((d) => [
      d.execute(
        sql`select id from works where id = ${workId}::uuid for update`,
      ),
      d.execute(guard),
      d.delete(workCredits).where(eq(workCredits.workId, workId)),
      ...(credits.length
        ? [
            d.insert(workCredits).values(
              credits.map((credit, sortOrder) => {
                const previous = existing.find((old) => old.id === credit.id);
                return {
                  ...credit,
                  id: credit.id ?? randomUUID(),
                  workId,
                  sortOrder,
                  createdAt:
                    previous && "createdAt" in previous
                      ? previous.createdAt
                      : undefined,
                };
              }),
            ),
          ]
        : []),
    ]);
  }
  changed();
  return getWorkCredits(workId);
}

export async function replaceEditionCredits(
  editionId: string,
  input: CreditInput[],
) {
  z.uuid().parse(editionId);
  const { credits, roles } = await validatedCredits("book", "edition", input);
  const edition = await db.query.editions.findFirst({
    where: eq(editions.id, editionId),
    columns: { id: true },
  });
  if (!edition) throw new Error("Edition not found");
  const fingerprint = creditFingerprint("edition_contributors", editionId);
  const expected = await readFingerprint(fingerprint);
  const existing = await getEditionCredits(editionId);
  requireOwnedCreditIds(credits, existing);
  const values = credits.map((credit, sortOrder) => ({
    id:
      credit.id ??
      existing.find(
        (old) =>
          old.personId === credit.personId && old.roleId === credit.roleId,
      )?.id ??
      randomUUID(),
    editionId,
    authorId: credit.personId!,
    role: roles.find((role) => role.id === credit.roleId)!.legacyRole!,
    creditedAs: credit.creditedAs,
    attribution: credit.attribution,
    sortOrder,
  }));
  await atomic((d) => [
    d.execute(
      sql`select id from editions where id = ${editionId}::uuid for update`,
    ),
    d.execute(
      assertSql(
        sql`exists (select 1 from editions where id = ${editionId}::uuid) and ${fingerprint} = ${expected}`,
        "Credits changed while saving; reload before trying again",
      ),
    ),
    d
      .delete(editionContributors)
      .where(eq(editionContributors.editionId, editionId)),
    ...(values.length ? [d.insert(editionContributors).values(values)] : []),
  ]);
  changed();
  return getEditionCredits(editionId);
}

export interface PersonCredit {
  id: string;
  workId: string;
  title: string;
  slug: string | null;
  kind: WorkKind;
  editionId: string | null;
  roleId: string;
  role: string;
  creditedAs: string | null;
  attribution: string;
  characters: string[];
  sortOrder: number;
}
/** Page the union, so one medium cannot displace another after pagination. */
export async function getPersonCredits(
  personId: string,
  options: { limit?: number; offset?: number } = {},
) {
  z.uuid().parse(personId);
  const { limit, offset } = z
    .object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    })
    .parse(options);
  return resultRows<PersonCredit>(
    await db.execute(sql`
    select * from (
      select c.id, w.id as "workId", w.title, w.slug, w.kind, null::uuid as "editionId", r.id as "roleId", r.label as role,
        c.credited_as as "creditedAs", c.attribution, c.characters, c.sort_order as "sortOrder"
      from work_credits c join works w on w.id=c.work_id join credit_roles r on r.id=c.role_id where c.person_id=${personId}::uuid
      union all
      select c.id,w.id,w.title,w.slug,w.kind,null::uuid,r.id,r.label,c.credited_as,c.attribution,'{}'::text[],c.sort_order
      from work_authors c join works w on w.id=c.work_id join credit_roles r on r.kind='book' and r.level='work' and r.legacy_role=c.role where c.author_id=${personId}::uuid
      union all
      select c.id,w.id,w.title,w.slug,w.kind,e.id,r.id,r.label,c.credited_as,c.attribution,'{}'::text[],c.sort_order
      from edition_contributors c join editions e on e.id=c.edition_id join works w on w.id=e.work_id join credit_roles r on r.kind='book' and r.level='edition' and r.legacy_role=c.role where c.author_id=${personId}::uuid
    ) credits order by lower(title), "workId", "editionId" nulls first, "sortOrder", id limit ${limit} offset ${offset}
  `),
  );
}
