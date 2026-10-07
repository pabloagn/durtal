/**
 * The length plan's report, page sections (SLN-466). It reads through the
 * database handle it is given and writes nothing. The report names books and
 * ISBNs, so it goes to tmp/ and is never committed.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { editions, instances, locations, works } from "@/lib/db/schema";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
import { MAX_PAGES, MIN_PAGES, PAGE_TOLERANCE } from "@/lib/books/enrichment";
import { PLACEHOLDER_SOURCE } from "@/lib/match/identify";
import { getWorkPages, pageRangeCondition } from "./pages";

/** SLN-471's replay test: 400 to 600 pages, with a copy available in Amsterdam */
const REPLAY = { slug: "kaputt-by-curzio-malaparte", location: "Amsterdam", min: 400, max: 600 };
/** Owned works with pages on 2026-10-04 */
const BASELINE = "145 of 153";

export async function lengthReport(database: PgDatabase<PgQueryResultHKT>): Promise<string> {
  const owned = await database
    .select({ id: works.id, title: works.title })
    .from(works)
    .where(and(eq(works.kind, "book"), ownedBookCondition(works.id)))
    .orderBy(asc(works.title), asc(works.id));
  const pages = await getWorkPages(database, owned.map((w) => w.id));
  const withoutPages = owned.filter((w) => pages.get(w.id)!.min === null);

  // The owned editions and copy locations of the works without pages
  const copies = withoutPages.length
    ? await database
        .select({
          workId: editions.workId,
          editionId: editions.id,
          isbn: sql<string | null>`coalesce(${editions.isbn13}, ${editions.isbn10})`,
          metadataSource: editions.metadataSource,
          location: locations.name,
        })
        .from(instances)
        .innerJoin(editions, eq(editions.id, instances.editionId))
        .innerJoin(locations, eq(locations.id, instances.locationId))
        .where(and(inArray(editions.workId, withoutPages.map((w) => w.id)), ne(instances.status, "deaccessioned")))
        .orderBy(asc(editions.id), asc(locations.name))
    : [];
  const withoutLines = withoutPages.map((work) => {
    const own = copies.filter((c) => c.workId === work.id);
    const ownedEditions = [...new Map(own.map((c) => [c.editionId, c])).values()].map(
      (c) => `${c.isbn ?? "no ISBN"}${c.metadataSource === PLACEHOLDER_SOURCE ? " (placeholder: /library/identify first)" : ""}`,
    );
    return `- ${work.title}: editions ${ownedEditions.join(", ")}; copies in ${own.map((c) => c.location).join(", ")}`;
  });

  // Every edition whose count the page rule leaves out
  const implausible = await database
    .select({
      title: works.title,
      isbn: sql<string | null>`coalesce(${editions.isbn13}, ${editions.isbn10})`,
      pageCount: editions.pageCount,
      owned: sql<boolean>`exists (select 1 from instances i where i.edition_id = ${editions.id} and i.status <> 'deaccessioned')`,
    })
    .from(editions)
    .innerJoin(works, eq(works.id, editions.workId))
    .where(sql`${editions.pageCount} not between ${MIN_PAGES} and ${MAX_PAGES}`)
    .orderBy(asc(works.title), asc(editions.id));

  // The tolerance check of SLN-414's agree(): |x - y| <= max(x, y) * PAGE_TOLERANCE
  const ranges = owned.flatMap((work) => {
    const { min, max } = pages.get(work.id)!;
    return min !== null && max !== null && max - min > max * PAGE_TOLERANCE ? [`- ${work.title}: ${min} to ${max}`] : [];
  });

  return [
    "# Length plan: pages",
    "",
    "Read-only: nothing was written.",
    "",
    "## Owned works",
    "",
    `${owned.length} owned works: ${owned.length - withoutPages.length} with pages, ${withoutPages.length} without (baseline 2026-10-04: ${BASELINE}).`,
    "",
    `### Without pages (${withoutPages.length})`,
    "",
    ...withoutLines,
    "",
    `## Page counts outside ${MIN_PAGES} to ${MAX_PAGES} (${implausible.length})`,
    "",
    ...implausible.map((e) => `- ${e.title}, ${e.isbn ?? "no ISBN"}: ${e.pageCount} pages${e.owned ? " (owned edition)" : ""}`),
    "",
    `## Owned editions whose counts differ by more than ${PAGE_TOLERANCE * 100}% (${ranges.length})`,
    "",
    ...ranges,
    "",
    "## Replay check",
    "",
    await replayCheck(database),
    "",
  ].join("\n");
}

/** Kaputt's pages at the Amsterdam location, and whether 400 to 600 pages there matches it */
async function replayCheck(database: PgDatabase<PgQueryResultHKT>): Promise<string> {
  const [work] = await database.select({ id: works.id, title: works.title }).from(works).where(eq(works.slug, REPLAY.slug));
  const [location] = await database
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.name, REPLAY.location))
    .orderBy(asc(locations.id));
  if (!work || !location) return `- ${!work ? `No work ${REPLAY.slug}` : `No location ${REPLAY.location}`}.`;
  const atLocation = (await getWorkPages(database, [work.id], { locationId: location.id })).get(work.id);
  const [match] = await database
    .select({ id: works.id })
    .from(works)
    .where(and(eq(works.id, work.id), pageRangeCondition({ min: REPLAY.min, max: REPLAY.max, locationId: location.id })));
  const found =
    atLocation?.min == null
      ? "no pages"
      : atLocation.min === atLocation.max
        ? `${atLocation.min} pages`
        : `${atLocation.min} to ${atLocation.max} pages`;
  const missing = !atLocation
    ? `no available copy in ${REPLAY.location}`
    : atLocation.min === null
      ? `no usable count on the edition of the ${REPLAY.location} copy`
      : `its pages are outside ${REPLAY.min} to ${REPLAY.max}`;
  return [
    `- ${work.title} (${work.id}) in ${REPLAY.location}: ${found}.`,
    `- ${REPLAY.min} to ${REPLAY.max} pages, available in ${REPLAY.location}: ${match ? "matches" : `does not match: ${missing}`}.`,
  ].join("\n");
}
