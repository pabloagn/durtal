import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { getPaceContext } from "@/lib/actions/reading";
import { predictionGateSchema, type PredictionGate } from "@/lib/validations/settings";
import { homeOptions } from "../at-hand";
import { readingToday } from "../day";
import { buildContext } from "./build";
import { loadBooks, toBooks } from "./load";
import { evaluatePredictions, gateDue, nextGate } from "./predict";
import type { SuggestContext } from "./types";

/*
 * getSuggestionContext (SLN-457): every book with what the engine needs, in
 * one query (authors, translators, recommenders, taxonomy, series, copies,
 * Up Next, feedback, taste evidence), plus the homes, Up Next's length, his
 * pace and two settings. Computed per request and never cached, so a copy
 * added, moved or lent shows on the next request. Only the prediction gate's
 * daily check is stored.
 */

/**
 * The book query without JIT (SLN-487). Its per-book subqueries put the
 * planner's estimate (226,000 on 695 books) over `jit_above_cost`; today the
 * compile about pays for itself, but the estimate grows with the catalogue,
 * and past `jit_optimize_above_cost` the optimized compile alone takes 200 ms
 * or more (as on /series). `set local` holds for this one transaction.
 */
async function withoutJit(query: SQL) {
  const [, rows] = await atomic((d) => [d.execute(sql`set local jit = off`), d.execute(query)]);
  return rows;
}

/** Runs the gate's daily check when it is due: one UPDATE asserting the old checkedAt, so two requests never both write it */
async function ensureGate(ctx: SuggestContext, previous: PredictionGate | null, now: Date): Promise<PredictionGate | null> {
  if (!gateDue(previous, now)) return previous;
  const next = nextGate(previous, evaluatePredictions(ctx), now);
  const rows = resultRows<{ gate: unknown }>(
    await db.execute(sql`update app_settings set reading_prediction_gate = ${JSON.stringify(next)}::jsonb
      where ${previous ? sql`reading_prediction_gate->>'checkedAt' = ${previous.checkedAt}` : sql`reading_prediction_gate is null`}
      returning reading_prediction_gate as gate`),
  );
  if (rows.length) {
    // Next ignores this during a page render, so the gate is never read from the settings cache (predictionGateOn)
    invalidate(CACHE_TAGS.settings);
    return next;
  }
  // Another request ran it first, or there is no settings row: read what is stored
  const [stored] = resultRows<{ gate: unknown }>(await db.execute(sql`select reading_prediction_gate as gate from app_settings limit 1`));
  const parsed = predictionGateSchema.safeParse(stored?.gate);
  return parsed.success ? parsed.data : previous;
}

/**
 * Whether predictions show now: the stored gate, read fresh. The settings
 * cache can hold an older gate for up to an hour, as the engine writes it
 * during a page render, when Next ignores the cache invalidation.
 */
export async function predictionGateOn(): Promise<boolean> {
  const [row] = resultRows<{ gate: unknown }>(await db.execute(sql`select reading_prediction_gate as gate from app_settings limit 1`));
  const parsed = predictionGateSchema.safeParse(row?.gate);
  return parsed.success && parsed.data.on;
}

/**
 * Everything the engine reads. `homeId` is the remembered home (the
 * durtal-reading-home cookie): one that is not a home now counts as none.
 */
export async function getSuggestionContext({ homeId: stored = null, now = new Date() }: { homeId?: string | null; now?: Date } = {}): Promise<SuggestContext> {
  const places = resultRows<{ id: string; name: string; type: string; isActive: boolean }>(
    await db.execute(sql`select id::text as id, name, type, is_active as "isActive" from locations order by name`),
  );
  const homes = homeOptions(places).map((h) => ({ id: h.id, name: h.name }));
  const homeId = homes.some((h) => h.id === stored) ? stored : null;
  const [today, settingsRows, rows, pace, queue] = await Promise.all([
    readingToday(),
    db.execute(sql`select reading_suggest_hide_anathema as "hideAnathema", reading_prediction_gate as gate from app_settings limit 1`),
    loadBooks(withoutJit, homeId),
    getPaceContext([]),
    db.execute(sql`select count(*)::int as n from reading_queue`),
  ]);
  const [settings] = resultRows<{ hideAnathema: boolean; gate: unknown }>(settingsRows);
  const parsedGate = predictionGateSchema.safeParse(settings?.gate);
  const books = toBooks(rows, homes);
  const ctx = buildContext({
    today,
    homeId,
    homes,
    books,
    queueLength: resultRows<{ n: number }>(queue)[0]?.n ?? 0,
    priors: pace.priors,
    hideAnathema: settings?.hideAnathema ?? false,
    gate: parsedGate.success ? parsedGate.data : null,
  });
  ctx.gate = await ensureGate(ctx, ctx.gate, now);
  return ctx;
}
