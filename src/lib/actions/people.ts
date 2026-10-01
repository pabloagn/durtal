"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, or, sql, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  authors,
  personAliases,
  personDomains,
  activityEvents,
} from "@/lib/db/schema";
import { personDomainCondition } from "@/lib/catalogue/person-boundary";
import { WORK_KINDS } from "@/lib/catalogue/kinds";
import {
  createPersonSchema,
  updatePersonSchema,
  type CreatePersonInput,
  type UpdatePersonInput,
} from "@/lib/validations/people";
import { authorSearchCondition, authorSearchRank } from "./utils/author-search";
import { textSearchCondition } from "./utils/text-search";
import { generateAuthorSlug, makeUnique } from "@/lib/utils/slugify";
import { defaultSortName } from "@/lib/utils/author-names";
import { computeZodiacSign } from "@/lib/utils/zodiac";
import { assertSql } from "@/lib/harmonization/store";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { authorObjects, deleteUnusedObjects } from "@/lib/s3/cleanup";

function changed() {
  invalidate(
    CACHE_TAGS.authors,
    CACHE_TAGS.works,
    CACHE_TAGS.editions,
    CACHE_TAGS.activity,
    CACHE_TAGS.media,
  );
}
// Compute from the row after its sparse update, using the existing zodiac
// function's transitions, so simultaneous date edits cannot leave a stale sign.
const zodiacCases = Array.from({ length: 12 }, (_, index) => {
  const month = index + 1;
  const first = computeZodiacSign(month, 1);
  const boundary = Array.from({ length: 31 }, (_, day) => day + 1).find(
    (day) => computeZodiacSign(month, day) !== first,
  )!;
  return sql`when birth_month = ${month} then case when birth_day < ${boundary} then ${first} else ${computeZodiacSign(month, boundary)} end`;
});
const zodiacFromRow = sql`case when birth_day between 1 and 31 then case ${sql.join(zodiacCases, sql` `)} else null end else null end`;
const searchSchema = z.object({
  query: z.string().trim().max(200).default(""),
  domain: z.enum(WORK_KINDS).optional(),
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().min(0).default(0),
});

/** Shared identity search. A domain filters associations, never a person's gender. */
export async function getPeople(input: z.input<typeof searchSchema> = {}) {
  const options = searchSchema.parse(input);
  const aliasMatch = options.query
    ? textSearchCondition(sql`pa.search_text`, options.query)
    : undefined;
  const where = and(
    options.domain ? personDomainCondition(options.domain) : undefined,
    options.query
      ? or(
          authorSearchCondition(options.query),
          sql`exists (select 1 from person_aliases pa where pa.person_id = ${authors.id} and ${aliasMatch})`,
        )
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db.query.authors.findMany({
      where,
      limit: options.limit,
      offset: options.offset,
      orderBy: [
        ...(options.query ? [desc(authorSearchRank(options.query))] : []),
        asc(authors.name),
        asc(authors.id),
      ],
      columns: {
        id: true,
        slug: true,
        name: true,
        birthYear: true,
        deathYear: true,
        photoS3Key: true,
      },
      with: {
        domains: { columns: { kind: true } },
        aliases: { columns: { name: true } },
      },
    }),
    db.select({ count: count() }).from(authors).where(where),
  ]);
  return { rows, total: total.count };
}

export async function getPerson(idOrSlug: string) {
  z.string().min(1).max(500).parse(idOrSlug);
  return db.query.authors.findFirst({
    where: z.uuid().safeParse(idOrSlug).success
      ? eq(authors.id, idOrSlug)
      : eq(authors.slug, idOrSlug),
    with: {
      country: true,
      birthPlace: true,
      deathPlace: true,
      media: true,
      domains: true,
      aliases: true,
    },
  });
}

export async function createPerson(input: CreatePersonInput) {
  const { domains, aliases, ...fields } = createPersonSchema.parse(input);
  const id = randomUUID();
  const base = generateAuthorSlug(fields.name) || id;
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await db
      .select({ slug: authors.slug })
      .from(authors)
      .where(sql`${authors.slug} like ${`${base}%`}`);
    const slug =
      attempt === 4
        ? `${base}-${id}`
        : makeUnique(
            base,
            taken.flatMap((row) => (row.slug ? [row.slug] : [])),
          );
    try {
      await atomic((d) => [
        d.insert(authors).values({
          ...fields,
          id,
          slug,
          sortName: fields.sortName ?? defaultSortName(fields.name),
          zodiacSign: computeZodiacSign(
            fields.birthMonth ?? 0,
            fields.birthDay ?? 0,
          ),
        }),
        // Legacy inserts default to book membership. Shared creation supplies its
        // explicit domains in this same transaction, so no transient row is visible.
        d.delete(personDomains).where(eq(personDomains.personId, id)),
        d
          .insert(personDomains)
          .values(
            [...new Set(domains)].map((kind) => ({ personId: id, kind })),
          ),
        ...(aliases.length
          ? [
              d
                .insert(personAliases)
                .values(
                  [...new Set(aliases)].map((name) => ({ personId: id, name })),
                ),
            ]
          : []),
        d.insert(activityEvents).values({
          entityType: "author",
          entityId: id,
          eventKey: "author.created",
          metadata: { newValue: fields.name },
        }),
      ]);
      changed();
      return { id, slug };
    } catch (error) {
      // Another creator with the same name may have claimed the candidate.
      // Retry only this unique constraint; the whole failed batch rolled back.
      let cause: unknown = error;
      let slugConflict = false;
      for (
        let depth = 0;
        depth < 5 && cause && typeof cause === "object";
        depth++
      ) {
        const detail = cause as {
          code?: string;
          constraint?: string;
          constraint_name?: string;
          cause?: unknown;
        };
        if (
          detail.code === "23505" &&
          (detail.constraint ?? detail.constraint_name) ===
            "authors_slug_unique"
        )
          slugConflict = true;
        cause = detail.cause;
      }
      if (!slugConflict || attempt === 4) throw error;
    }
  }
  throw new Error("Could not allocate a person URL");
}

export async function updatePerson(id: string, input: UpdatePersonInput) {
  z.uuid().parse(id);
  const { aliases, ...fields } = updatePersonSchema.parse(input);
  await atomic((d) => [
    d.execute(sql`select id from authors where id = ${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`exists (select 1 from authors where id = ${id}::uuid)`,
        "Person not found",
      ),
    ),
    d
      .update(authors)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(authors.id, id)),
    ...(fields.birthMonth !== undefined || fields.birthDay !== undefined
      ? [
          d.execute(
            sql`update authors set zodiac_sign = ${zodiacFromRow} where id = ${id}::uuid`,
          ),
        ]
      : []),
    ...(aliases !== undefined
      ? [
          d.delete(personAliases).where(eq(personAliases.personId, id)),
          ...(aliases.length
            ? [
                d.insert(personAliases).values(
                  [...new Set(aliases)].map((name) => ({
                    personId: id,
                    name,
                  })),
                ),
              ]
            : []),
        ]
      : []),
  ]);
  changed();
  return { id };
}

/** Shared deletion requires explicit removal of credits first. */
export async function deletePerson(id: string) {
  z.uuid().parse(id);
  await atomic((d) => [
    d.execute(sql`select id from authors where id = ${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`exists (select 1 from authors where id = ${id}::uuid)`,
        "Person not found",
      ),
    ),
    d.execute(
      assertSql(
        sql`not exists (select 1 from work_credits where person_id = ${id}::uuid) and not exists (select 1 from perfume_variant_perfumers where person_id = ${id}::uuid) and not exists (select 1 from work_authors where author_id = ${id}::uuid) and not exists (select 1 from edition_contributors where author_id = ${id}::uuid)`,
        "Remove this person's credits before deleting the identity",
      ),
    ),
    ...["comments", "activity_events", "gallery_layouts"].map((table) =>
      d.execute(
        sql`delete from ${sql.identifier(table)} where entity_type = 'author' and entity_id = ${id}::uuid`,
      ),
    ),
    d.delete(authors).where(eq(authors.id, id)),
  ]);
  changed();
  return { id };
}

export async function getPersonMergePreview(
  sourceId: string,
  targetId: string,
) {
  z.uuid().parse(sourceId);
  z.uuid().parse(targetId);
  return previewMerge("authors", sourceId, targetId);
}
export async function mergePeople(input: unknown) {
  const parsed = z
    .object({
      sourceId: z.uuid(),
      targetId: z.uuid(),
      fingerprint: z.string().min(1),
      choices: z.record(z.string(), z.enum(["source", "target"])),
    })
    .parse(input);
  // Moved media rows keep their keys; only files nothing references any more
  // (such as a discarded photo) are removed. Comment files move with comments.
  const stored = await authorObjects(parsed.sourceId, { withComments: false });
  const result = await executeMerge({ ...parsed, entity: "authors" });
  changed();
  const cleanupPending = await deleteUnusedObjects(
    stored,
    `author ${parsed.sourceId} merged into ${parsed.targetId}`,
  );
  return { ...result, cleanupPending };
}
