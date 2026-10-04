"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, count, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  publishingHouses as identities,
  publisherAliases as aliases,
  organizationRoles,
  organizationVenues,
} from "@/lib/db/schema";
import {
  ORGANIZATION_ROLES,
  NON_PUBLISHING_ROLES,
  type OrganizationRole,
} from "@/lib/catalogue/organizations";
import {
  organizationSchema,
  type OrganizationInput,
} from "@/lib/validations/organizations";
import { textSearchCondition, textSearchRank } from "./utils/text-search";
import { slugify } from "@/lib/utils/slugify";
import { assertSql } from "@/lib/harmonization/store";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { deleteUnusedObjects, ownedMediaObjects } from "@/lib/s3/cleanup";

function changed() {
  invalidate(
    CACHE_TAGS.works,
    CACHE_TAGS.editions,
    CACHE_TAGS.orders,
    CACHE_TAGS.venues,
  );
}
const searchSchema = z.object({
  query: z.string().trim().max(200).default(""),
  role: z.enum(ORGANIZATION_ROLES).optional(),
  /** Only organizations with at least one of these roles (a picker's kinds) */
  roles: z.array(z.enum(ORGANIZATION_ROLES)).min(1).max(ORGANIZATION_ROLES.length).optional(),
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).default(0),
});
export async function getOrganizations(
  input: z.input<typeof searchSchema> = {},
) {
  const options = searchSchema.parse(input);
  // Publisher and imprint are the book profile's kind; the others are roles
  const hasRole = (role: OrganizationRole) =>
    role === "publisher" || role === "imprint"
      ? eq(identities.kind, role)
      : sql`exists (select 1 from organization_roles r where r.organization_id=${identities.id} and r.role=${role})`;
  const where = and(
    options.role ? hasRole(options.role) : undefined,
    options.roles ? or(...options.roles.map(hasRole)) : undefined,
    options.query
      ? or(
          textSearchCondition(sql`${identities.searchText}`, options.query),
          sql`exists (select 1 from publisher_aliases a where a.publisher_id=${identities.id} and ${textSearchCondition(sql`a.search_text`, options.query)})`,
        )
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db.query.publishingHouses.findMany({
      where,
      limit: options.limit,
      offset: options.offset,
      columns: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        country: true,
        countryId: true,
      },
      with: { roles: true, aliases: { columns: { name: true } } },
      orderBy: [
        ...(options.query
          ? [
              desc(
                textSearchRank(
                  sql`${identities.searchText}`,
                  sql`${identities.name}`,
                  options.query,
                ),
              ),
            ]
          : []),
        asc(identities.name),
        asc(identities.id),
      ],
    }),
    db.select({ count: count() }).from(identities).where(where),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row,
      roles: [
        ...(row.kind ? [row.kind] : []),
        ...row.roles.map((r) => r.role),
      ] as OrganizationRole[],
    })),
    total: total.count,
  };
}

export async function getOrganization(idOrSlug: string) {
  z.string().min(1).max(500).parse(idOrSlug);
  const row = await db.query.publishingHouses.findFirst({
    where: z.uuid().safeParse(idOrSlug).success
      ? eq(identities.id, idOrSlug)
      : eq(identities.slug, idOrSlug),
    with: {
      roles: true,
      aliases: true,
      countryRef: true,
      venues: { with: { venue: true } },
    },
  });
  return row
    ? {
        ...row,
        roles: [
          ...(row.kind ? [row.kind] : []),
          ...row.roles.map((r) => r.role),
        ] as OrganizationRole[],
      }
    : undefined;
}

/** Complete editor payload; omitted scalar fields retain their prior values. */
export async function saveOrganization(input: OrganizationInput, id?: string) {
  const {
    roles,
    aliases: names,
    parentId,
    ...fields
  } = organizationSchema.parse(input);
  const organizationId = id ? z.uuid().parse(id) : randomUUID();
  const kind = roles.includes("publisher")
    ? "publisher"
    : roles.includes("imprint")
      ? "imprint"
      : null;
  const extraRoles = [...new Set(roles)].filter(
    (role): role is (typeof NON_PUBLISHING_ROLES)[number] =>
      role !== "publisher" && role !== "imprint",
  );
  // UUID suffixes make same-name identities independent even under concurrent
  // creation. Existing publisher and organization URLs never change on edit.
  const slug = `${slugify(fields.name) || "organization"}-${organizationId}`;
  await atomic((d) => [
    ...(id
      ? [
          d.execute(
            sql`select id from publishing_houses where id=${organizationId}::uuid for update`,
          ),
          d.execute(
            assertSql(
              sql`exists (select 1 from publishing_houses where id=${organizationId}::uuid)`,
              "Organization not found",
            ),
          ),
          d
            .update(identities)
            .set({ ...fields, kind, parentId: parentId ?? null })
            .where(eq(identities.id, organizationId)),
        ]
      : [
          d.insert(identities).values({
            ...fields,
            id: organizationId,
            slug,
            kind,
            parentId: parentId ?? null,
          }),
        ]),
    d
      .delete(organizationRoles)
      .where(eq(organizationRoles.organizationId, organizationId)),
    ...(extraRoles.length
      ? [
          d
            .insert(organizationRoles)
            .values(extraRoles.map((role) => ({ organizationId, role }))),
        ]
      : []),
    d.delete(aliases).where(eq(aliases.publisherId, organizationId)),
    ...(names.length
      ? [
          d.insert(aliases).values(
            [...new Set(names)].map((name) => ({
              publisherId: organizationId,
              name,
            })),
          ),
        ]
      : []),
  ]);
  changed();
  return getOrganization(organizationId);
}

/** FK restrictions protect editions, targets, children and affiliated venues. */
export async function deleteOrganization(id: string) {
  z.uuid().parse(id);
  // Read the file keys first: the cascade removes the media rows that name them.
  const stored = await ownedMediaObjects("organization", id);
  await atomic((d) => [
    d.execute(
      sql`select id from publishing_houses where id=${id}::uuid for update`,
    ),
    d.execute(
      assertSql(
        sql`exists (select 1 from publishing_houses where id=${id}::uuid)`,
        "Organization not found",
      ),
    ),
    d.delete(identities).where(eq(identities.id, id)),
  ]);
  changed();
  const cleanupPending = await deleteUnusedObjects(stored, `organization ${id}`);
  return { id, cleanupPending };
}

export async function linkOrganizationVenue(input: {
  organizationId: string;
  venueId: string;
  role?: "operator" | "owner";
}) {
  const parsed = z
    .object({
      organizationId: z.uuid(),
      venueId: z.uuid(),
      role: z.enum(["operator", "owner"]).default("operator"),
    })
    .parse(input);
  await db.insert(organizationVenues).values(parsed).onConflictDoNothing();
  changed();
  return parsed;
}
export async function unlinkOrganizationVenue(input: {
  organizationId: string;
  venueId: string;
  role: "operator" | "owner";
}) {
  const parsed = z
    .object({
      organizationId: z.uuid(),
      venueId: z.uuid(),
      role: z.enum(["operator", "owner"]),
    })
    .parse(input);
  await db
    .delete(organizationVenues)
    .where(
      and(
        eq(organizationVenues.organizationId, parsed.organizationId),
        eq(organizationVenues.venueId, parsed.venueId),
        eq(organizationVenues.role, parsed.role),
      ),
    );
  changed();
  return parsed;
}
export async function getOrganizationMergePreview(
  sourceId: string,
  targetId: string,
) {
  z.uuid().parse(sourceId);
  z.uuid().parse(targetId);
  // Existing audited publisher merges own this same physical identity and its
  // FK registry, including the new roles and venue affiliations.
  return previewMerge("publishers", sourceId, targetId);
}
export async function mergeOrganizations(input: unknown) {
  const parsed = z
    .object({
      sourceId: z.uuid(),
      targetId: z.uuid(),
      fingerprint: z.string().min(1),
      choices: z.record(z.string(), z.enum(["source", "target"])),
    })
    .parse(input);
  const result = await executeMerge({ ...parsed, entity: "publishers" });
  changed();
  return result;
}
