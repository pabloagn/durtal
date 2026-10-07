import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authors, catalogueIdentifiers, publishingHouses } from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";

/*
 * Who a provider's person or company is here (SLN-377, SLN-376): the record
 * that holds the provider's id, else the one record whose name or alias is
 * exactly that name. Two records of one name match neither; a title alone
 * never matches.
 */
export async function matchIdentity(provider: string, kind: "organization" | "person", externalId: string, name: string) {
  const column = kind === "organization" ? catalogueIdentifiers.organizationId : catalogueIdentifiers.personId;
  const [byId] = await db
    .select({ id: column })
    .from(catalogueIdentifiers)
    .where(and(eq(catalogueIdentifiers.provider, provider), eq(catalogueIdentifiers.entityKind, kind), eq(catalogueIdentifiers.externalId, externalId)))
    .limit(1);
  const table = kind === "organization" ? "publishing_houses" : "authors";
  const aliases = kind === "organization" ? sql`select publisher_id from publisher_aliases where lower(name) = lower(${name})` : sql`select person_id from person_aliases where lower(name) = lower(${name})`;
  const ids = byId?.id
    ? [byId.id]
    : resultRows<{ id: string }>(
        await db.execute(sql`select id from ${sql.identifier(table)} where lower(name) = lower(${name}) or id in (${aliases}) limit 2`),
      ).map((r) => r.id);
  if (ids.length !== 1) return null;
  const [row] =
    kind === "organization"
      ? await db.select({ id: publishingHouses.id, name: publishingHouses.name }).from(publishingHouses).where(eq(publishingHouses.id, ids[0]))
      : await db.select({ id: authors.id, name: authors.name }).from(authors).where(eq(authors.id, ids[0]));
  return row ?? null;
}
