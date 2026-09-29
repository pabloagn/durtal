import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { slugify } from "@/lib/utils/slugify";
import { seriesPositionSchema } from "@/lib/validations/series";

/** Exact title matching, ignoring case and repeated whitespace; never fuzzy matching. */
export function seriesTitleKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Build alongside the work write inside atomic(): creation and membership commit together. */
export function workSeriesPlan(input: {
  seriesId?: string | null;
  seriesName?: string | null;
  seriesPosition?: string | null;
}) {
  const values: {
    seriesId?: string | SQL | null;
    seriesName?: null;
    seriesPosition?: string | null;
  } = {};
  const statements: SQL[] = [];
  if (input.seriesPosition !== undefined)
    values.seriesPosition = seriesPositionSchema.parse(input.seriesPosition);
  if (input.seriesId) {
    values.seriesId = z.uuid().parse(input.seriesId);
    values.seriesName = null;
  } else if (input.seriesName?.trim()) {
    const title = z
      .string()
      .trim()
      .min(1)
      .max(300)
      .parse(input.seriesName)
      .replace(/\s+/g, " ");
    const key = seriesTitleKey(title);
    const match = sql`lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) = ${key}`;
    statements.push(
      sql`select pg_advisory_xact_lock(hashtextextended(${`durtal-series:${key}`},0))`,
    );
    statements.push(
      sql`insert into series(title,slug) select ${title},${`${slugify(title) || "series"}-${randomUUID()}`} where not exists(select 1 from series where ${match})`,
    );
    // Multiple identical existing names are ambiguous: fail rather than attach to an arbitrary one.
    values.seriesId = sql`(select id from series where ${match})`;
    values.seriesName = null;
  } else if (input.seriesId !== undefined || input.seriesName !== undefined) {
    values.seriesId = null;
    values.seriesName = null;
    values.seriesPosition = null;
  }
  return {
    values,
    queries: (d: typeof db) =>
      statements.map((statement) => d.execute(statement)),
  };
}

export function resultRows<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}
