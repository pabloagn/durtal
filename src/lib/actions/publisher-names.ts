"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  publisherAliases,
  publisherIsbnPrefixes,
  ignoredPublisherNames,
} from "@/lib/db/schema";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { parsePagination } from "@/lib/utils/pagination";
import { cleanPublisherName, isbnPrefixLabel } from "@/lib/publishers/names";
import {
  applyAutomaticDecisions,
  listAutomaticDecisions,
  loadNameInbox as loadInbox,
  resultRows,
  undoAutomaticDecision,
  type PublisherNameRow,
} from "@/lib/publishers/resolution";
import { savePublisher } from "@/lib/actions/publishers";

/**
 * Publisher names inbox (tasks 0171, 0172): the actions behind
 * /publishers/review. The logic lives in `src/lib/publishers/resolution.ts`.
 */

export type {
  PublisherNameRow,
  PublisherSuggestion,
  AutomaticPlan,
} from "@/lib/publishers/resolution";

function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.orders);
}

const inboxSchema = z.object({
  page: z.number().int().optional(),
  perPage: z.number().int().optional(),
  house: z.uuid().optional(),
});

/** One page of names, most editions first; `house` keeps names suggested for that house */
export async function getPublisherNameInbox(options: z.input<typeof inboxSchema> = {}) {
  const o = inboxSchema.parse(options);
  const paging = parsePagination(
    { page: String(o.page ?? 1), perPage: String(o.perPage ?? 24) },
    { defaultPerPage: 24 },
  );
  const { rows, ignored } = await loadInbox();
  const shown = o.house
    ? rows.filter((r) => r.suggestions.some((s) => s.publisher.id === o.house))
    : rows;
  const safe = rows.filter((r) => r.automatic.action !== "hold");
  const joins = (r: PublisherNameRow) =>
    r.automatic.action === "create" && !!r.automatic.sameAs;
  return {
    rows: shown.slice(paging.offset, paging.offset + paging.perPage),
    total: shown.length,
    editions: shown.reduce((n, r) => n + r.editions.length, 0),
    ignored: ignored.map((i) => ({ key: i.nameKey, name: i.name })),
    safe: {
      // A name that joins a new house ("MacLehose Press") counts as a link
      aliases: safe.filter((r) => r.automatic.action === "alias" || joins(r)).length,
      creates: safe.filter((r) => r.automatic.action === "create" && !joins(r)).length,
      editions: safe.reduce((n, r) => n + r.editions.length, 0),
    },
    decisions: (await listAutomaticDecisions(50)).map(({ decision: d, house }) => ({
      id: d.id,
      name: d.name,
      action: d.action as "alias" | "create",
      reason: d.reason,
      editionCount: d.editionCount,
      createdAt: d.createdAt.toISOString(),
      undone: !!d.undoneAt,
      house,
    })),
  };
}

/** How many editions without a house the inbox suggests for this house */
export async function getPublisherSuggestionSummary(publisherId: string) {
  const id = z.uuid().parse(publisherId);
  const { rows } = await loadInbox();
  const mine = rows.filter((r) => r.suggestions.some((s) => s.publisher.id === id));
  return {
    names: mine.length,
    editions: mine.reduce((n, r) => n + r.editions.length, 0),
  };
}

const resolveSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(300),
      action: z.enum(["link", "create", "ignore"]),
      publisherId: z.uuid().optional(),
      /** Save the ISBN prefixes of the name's editions as rules for the house */
      usePrefixes: z.boolean().default(false),
    }),
  )
  .min(1)
  .max(200);

/**
 * Apply inbox decisions, each for every edition that carries the name:
 * - link: the name becomes an alias of the house. An ambiguous name, or a
 *   suggestion found only by ISBN, instead confirms each of its editions, so
 *   a distributor's name never becomes a house's name.
 * - create: a new house with the cleaned name; the source spelling stays its
 *   alias.
 * - ignore: the name is not a publisher; its editions use ISBN rules.
 * With `usePrefixes`, the editions' ISBN prefixes become rules for the house,
 * unless another house already has books with that prefix. Aliases, rules and
 * ignored names are each one statement, so the automatic matching runs once
 * per kind.
 */
export async function resolvePublisherNames(items: z.input<typeof resolveSchema>) {
  const parsed = resolveSchema.parse(items);
  const { rows, evidence, ruleByPrefix } = await loadInbox();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const aliases: { publisherId: string; name: string }[] = [];
  const confirmations: { editionId: string; publisherId: string }[] = [];
  const prefixes = new Map<string, string | null>();
  const ignores: { nameKey: string; name: string }[] = [];
  const touched: string[] = [];
  const created: string[] = [];

  function addPrefixes(row: PublisherNameRow, publisherId: string) {
    for (const p of row.prefixes) {
      if (ruleByPrefix.has(p.digits)) continue;
      const counts = evidence.get(p.digits);
      const other = counts && [...counts.keys()].some((id) => id !== publisherId);
      const earlier = prefixes.get(p.digits);
      // Two decisions for one prefix, or books of another house: no rule
      prefixes.set(
        p.digits,
        other || (earlier !== undefined && earlier !== publisherId) ? null : publisherId,
      );
    }
  }

  for (const item of parsed) {
    const row = byKey.get(item.key);
    if (!row) continue; // Resolved since the page loaded
    touched.push(...row.editions.map((e) => e.id));
    if (item.action === "ignore") {
      ignores.push({ nameKey: row.key, name: row.name });
      continue;
    }
    let publisherId = item.publisherId;
    if (item.action === "create") {
      const clean = cleanPublisherName(row.name);
      const house = await savePublisher({
        name: clean,
        aliases: clean === row.name ? [] : [row.name],
      });
      created.push(house.name);
      publisherId = house.id;
    }
    if (!publisherId) throw new Error("Choose a publisher");
    const suggestion = row.suggestions.find((s) => s.publisher.id === publisherId);
    const byIsbnOnly = item.action === "link" && suggestion?.via === "isbn";
    if (row.candidates > 1 || byIsbnOnly)
      confirmations.push(
        ...row.editions.map((e) => ({ editionId: e.id, publisherId: publisherId! })),
      );
    else if (item.action === "link") aliases.push({ publisherId, name: row.name });
    if (item.usePrefixes) addPrefixes(row, publisherId);
  }

  const rules = [...prefixes.entries()]
    .filter((e): e is [string, string] => e[1] !== null)
    .map(([prefix, publisherId]) => ({ prefix, publisherId }));
  await atomic((d) => [
    ...(aliases.length
      ? [d.insert(publisherAliases).values(aliases).onConflictDoNothing()]
      : []),
    ...(rules.length
      ? [d.insert(publisherIsbnPrefixes).values(rules).onConflictDoNothing()]
      : []),
    ...(ignores.length
      ? [d.insert(ignoredPublisherNames).values(ignores).onConflictDoNothing()]
      : []),
    ...confirmations.map((c) =>
      d.execute(
        sql`select set_edition_publishers(${c.editionId}::uuid, ARRAY[${c.publisherId}::uuid])`,
      ),
    ),
  ]);
  changed();

  const linked = touched.length
    ? resultRows<{ n: number }>(
        await db.execute(sql`select count(distinct edition_id)::int as n from edition_publishers
          where edition_id in (${sql.join(
            touched.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`),
      )[0].n
    : 0;
  return {
    linked,
    aliases: aliases.length,
    prefixes: rules.map((r) => isbnPrefixLabel(r.prefix)),
    ignored: ignores.length,
    created,
  };
}

/** A name marked as not a publisher matches houses again */
export async function restorePublisherName(key: string) {
  await db
    .delete(ignoredPublisherNames)
    .where(eq(ignoredPublisherNames.nameKey, z.string().min(1).max(300).parse(key)));
  changed();
}

/** Apply every safe automatic decision of the inbox (links and new houses) */
export async function applySafePublisherDecisions() {
  const result = await applyAutomaticDecisions();
  changed();
  return result;
}

/** Undo one automatic decision; the name returns to the inbox for good */
export async function undoAutomaticPublisherDecision(id: string) {
  await undoAutomaticDecision(z.uuid().parse(id));
  changed();
}
