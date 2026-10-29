import { PERSON_CREDITS } from "@/lib/catalogue/person-boundary";
import { bookCondition } from "@/lib/catalogue/book-boundary";
import { getAcquisitionTargetsForExport } from "@/lib/actions/publishers";
import { db } from "@/lib/db";
import { getWorkDigitalAvailability, type WorkDigitalAvailability } from "@/lib/ebooks/work-availability";
import { ebookExportFormats, workEbookDTO } from "@/lib/ebooks/catalogue-dto";
import { formatLabel, formatRank } from "@/lib/ebooks/formats";
import { works, workAuthors, authors } from "@/lib/db/schema";
import { inArray, asc, and, sql } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import { uuids } from "@/lib/catalogue/work-store";
import { compareTitles, compareWorks } from "@/lib/utils/title-order";
import { stripHtmlToText } from "@/lib/utils/sanitize";
import { formatRating } from "@/lib/utils/rating";
import { catalogueDateSchema } from "@/lib/catalogue/dates";
import { nativeProjection } from "./schema";

/** The books with these ids, or every book (null), in title order */
export async function fetchWorksForExport(ids: string[] | null, native = false) {
  const results = await db.query.works.findMany({
    where: ids ? and(bookCondition, inArray(works.id, ids)) : bookCondition,
    with: {
      workAuthors: {
        with: { author: true },
        orderBy: asc(workAuthors.sortOrder),
      },
      editions: {
        with: {
          publisherLinks: { with: { publisher: true } },
          instances: {
            columns: { id: true },
          },
        },
      },
    },
  });

  // The lookup takes at most 500 works a call: a whole-catalogue export asks in batches
  const found = results.map((w) => w.id);
  const targets: Awaited<ReturnType<typeof getAcquisitionTargetsForExport>> = [];
  const digital = new Map<string, WorkDigitalAvailability>();
  for (let i = 0; i < found.length; i += 500) {
    targets.push(...(await getAcquisitionTargetsForExport(found.slice(i, i + 500))));
    for (const [id, value] of await getWorkDigitalAvailability(found.slice(i, i + 500), { includePositions: false })) digital.set(id, value);
  }
  const targetTimes = new Map<string, string>();
  if (native && found.length) {
    const times = resultRows<{ id: string; micros: string }>(await db.execute(sql`
      select id::text, (extract(epoch from created_at) * 1000000)::bigint::text as micros
      from acquisition_targets where work_id in (${uuids(found)})`));
    for (const row of times) targetTimes.set(row.id, row.micros);
  }
  return [...results].sort(compareWorks).map((w) => {
    const rating = formatRating(w.rating);
    const authorNames = w.workAuthors.map((wa) => wa.author.name).join("; ");
    const primaryEdition = w.editions[0];
    const totalInstances = w.editions.reduce(
      (sum, e) => sum + e.instances.length,
      0,
    );

    const legacy = {
      title: w.title,
      ebook_formats: ebookExportFormats((digital.get(w.id)?.ebooks ?? []).map(workEbookDTO)),
      authors: authorNames,
      original_language: w.originalLanguage,
      original_year: w.originalYear,
      catalogue_status: w.catalogueStatus,
      acquisition_priority: w.acquisitionPriority,
      rating: rating ? Number(rating) : null,
      is_anthology: w.isAnthology,
      isbn_13: primaryEdition?.isbn13 ?? null,
      isbn_10: primaryEdition?.isbn10 ?? null,
      publisher: primaryEdition?.publisher ?? null,
      // Nested lists: JSON and Parquet keep them as data, CSV and TSV write them as JSON text
      acquisition_targets: targets
        .filter((t) => t.target.workId === w.id)
        .map((t) => ({
          ...t.target,
          state: t.state,
          fulfilled_instance_id: t.instanceId,
        })),
      edition_publishers: w.editions.map((e) => ({
        edition_id: e.id,
        isbn_13: e.isbn13,
        publishers: e.publisherLinks.map((l) => ({
          id: l.publisher.id,
          name: l.publisher.name,
          kind: l.publisher.kind,
          parent_id: l.publisher.parentId,
        })),
      })),
      imprint: primaryEdition?.imprint ?? null,
      publication_year: primaryEdition?.publicationYear ?? null,
      edition_language: primaryEdition?.language ?? null,
      binding: primaryEdition?.binding ?? null,
      page_count: primaryEdition?.pageCount ?? null,
      edition_count: w.editions.length,
      instance_count: totalInstances,
      notes: w.notes,
    };
    if (!native) return legacy;
    const formats = (digital.get(w.id)?.ebooks ?? []).map(workEbookDTO).filter((e) => e.readable).flatMap((e) => e.formats);
    return nativeProjection("works", legacy, {
      authors: [...w.workAuthors].sort((a, b) => a.sortOrder - b.sortOrder || a.authorId.localeCompare(b.authorId) || a.id.localeCompare(b.id)).map((wa) => wa.author.name),
      ebook_formats: [...new Set(formats)].sort((a, b) => formatRank(a) - formatRank(b)).map(formatLabel),
      edition_publishers: [...legacy.edition_publishers].sort((a, b) => a.edition_id.localeCompare(b.edition_id)).map((edition) => ({
        ...edition, publishers: [...edition.publishers].sort((a, b) => a.id.localeCompare(b.id)),
      })),
      acquisition_targets: targets.filter((t) => t.target.workId === w.id).sort((a, b) => a.target.id.localeCompare(b.target.id)).map(({ target: t, state, instanceId }) => ({
        id: t.id, workId: t.workId, editionId: t.editionId, publisherId: t.publisherId,
        perfumeVariantId: t.perfumeVariantId, perfumeContainer: t.perfumeContainer, perfumeCapacityValue: t.perfumeCapacityValue,
        perfumeVolumeUnit: t.perfumeVolumeUnit, filmVersionId: t.filmVersionId, filmReleaseId: t.filmReleaseId,
        filmMedium: t.filmMedium, filmFormatLabel: t.filmFormatLabel, artObjectId: t.artObjectId,
        artReproducesObjectId: t.artReproducesObjectId, isCancelled: t.isCancelled, createdAt: targetTimes.get(t.id),
        state, fulfilled_instance_id: instanceId,
      })),
    });
  });
}

/** Where a person's roles stand in the roles column: books first, a book's author first */
const ROLE_ORDER = sql`case cr.kind when 'book' then 0 when 'film' then 1 when 'perfume' then 2 when 'painting' then 3 else 4 end,
  cr.level <> 'work', cr.legacy_role is distinct from 'author', cr.label`;

/** Each person's roles across the collections, as their labels ("Author; Translator; Director") */
async function personRoles(ids: string[] | null) {
  const rows = resultRows<{ personId: string; label: string }>(
    await db.execute(sql`select c.person_id as "personId", cr.label
      from ${PERSON_CREDITS} c join credit_roles cr on cr.id = c.role_id
      ${ids ? sql`where c.person_id in (${uuids(ids)})` : sql``}
      group by c.person_id, cr.kind, cr.level, cr.legacy_role, cr.label
      order by c.person_id, ${ROLE_ORDER}`),
  );
  const roles = new Map<string, string[]>();
  for (const { personId, label } of rows) {
    const held = roles.get(personId) ?? [];
    // A film's editor and a book's editor are one "Editor"
    if (!held.includes(label)) held.push(label);
    roles.set(personId, held);
  }
  return roles;
}

/** The people with these ids, or every person (null), by sort name */
export async function fetchAuthorsForExport(ids: string[] | null, native = false) {
  const [results, roles] = await Promise.all([
    db.query.authors.findMany({
      where: ids ? inArray(authors.id, ids) : undefined,
      with: {
        country: true,
        workAuthors: {
          columns: { workId: true },
          with: { work: { columns: { kind: true } } },
        },
      },
    }),
    personRoles(ids),
  ]);
  const sortKey = (a: (typeof results)[number]) => a.sortName || a.name;

  return [...results]
    .sort((a, b) => compareTitles(sortKey(a), sortKey(b)) || a.id.localeCompare(b.id))
    .map((a) => {
      const legacy = {
      name: a.name,
      sort_name: a.sortName,
      first_name: a.firstName,
      last_name: a.lastName,
      real_name: a.realName,
      roles: (roles.get(a.id) ?? []).join("; "),
      nationality: a.country?.name ?? null,
      gender: a.gender,
      birth_year: a.birthYear,
      birth_month: a.birthMonth,
      birth_day: a.birthDay,
      death_year: a.deathYear,
      death_month: a.deathMonth,
      death_day: a.deathDay,
      bio: a.bio ? stripHtmlToText(a.bio) : null,
      website: a.website,
      // Multiple credits on one book still count as one book; other kinds do not.
      works_count: new Set(a.workAuthors.filter((credit) => credit.work.kind === "book").map((credit) => credit.workId)).size,
      };
      // Older people rows can contain incomplete component combinations accepted by their original schema.
      // Keep those raw values; only offer a structured date when the existing validator accepts it.
      const lifeDate = (year: number | null, month: number | null, day: number | null, approximate: boolean) => {
        if (year === null) return null;
        const parsed = catalogueDateSchema.safeParse({
          precision: day !== null ? "day" : month !== null ? "month" : "year", start: { year, month, day }, end: null, approximate, label: null,
        });
        return parsed.success ? parsed.data : null;
      };
      return native ? nativeProjection("authors", legacy, {
        roles: roles.get(a.id) ?? [],
        birth_date: lifeDate(a.birthYear, a.birthMonth, a.birthDay, a.birthYearIsApproximate),
        death_date: lifeDate(a.deathYear, a.deathMonth, a.deathDay, a.deathYearIsApproximate),
        birth_year_gregorian: a.birthYearGregorian, death_year_gregorian: a.deathYearGregorian,
        birth_year_is_approximate: a.birthYearIsApproximate, death_year_is_approximate: a.deathYearIsApproximate,
      }) : legacy;
    });
}
