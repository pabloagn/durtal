/**
 * The suggestion engine on a disposable preview's data (SLN-457), read-only:
 * the predicted rating's leave-one-out evaluation (n, coverage, MAE,
 * baseline MAE, whether the gate would be on) and the top 10 Owned
 * suggestions with their reasons and scores. It never writes, not even the
 * gate: its connection is read-only.
 *
 *   pnpm exec tsx scripts/qa/suggestions-eval.ts --database-url postgresql://durtal_preview:…@localhost:PORT/durtal_preview [--home Amsterdam]
 *
 * It refuses any database but a disposable local durtal_preview one
 * (scripts/qa/preview-local.py prints its URL).
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { homeOptions } from "@/lib/reading/at-hand";
import { buildContext } from "@/lib/reading/suggest/build";
import { loadBooks, rowsOf, toBooks } from "@/lib/reading/suggest/load";
import { DEFAULT_SUGGESTION_PARAMS } from "@/lib/reading/suggest/params";
import { GATE_MIN_BOOKS, GATE_RATIO, evaluatePredictions, passesGate } from "@/lib/reading/suggest/predict";
import { suggest } from "@/lib/reading/suggest/score";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const url = arg("database-url") ?? "";
const parsed = URL.parse(url);
if (!parsed || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/durtal_preview") {
  console.error("Give --database-url of a disposable local durtal_preview database (scripts/qa/preview-local.py)");
  process.exit(2);
}

const client = postgres(url, { max: 2, onnotice: () => {}, connection: { default_transaction_read_only: "on" } });
const db = drizzle(client);
const execute = (query: Parameters<typeof db.execute>[0]) => db.execute(query);

try {
  const places = rowsOf<{ id: string; name: string; type: string; isActive: boolean }>(
    await execute(sql`select id::text as id, name, type, is_active as "isActive" from locations order by name`),
  );
  const homes = homeOptions(places).map((h) => ({ id: h.id, name: h.name }));
  const homeName = arg("home");
  const homeId = homes.find((h) => h.name === homeName)?.id ?? null;
  const started = performance.now();
  const rows = await loadBooks(execute, homeId);
  const loadMs = performance.now() - started;
  const [{ n: queueLength }] = rowsOf<{ n: number }>(await execute(sql`select count(*)::int as n from reading_queue`));
  const ctx = buildContext({
    today: new Date().toISOString().slice(0, 10),
    homeId,
    homes,
    books: toBooks(rows, homes),
    queueLength,
    priors: { byLanguageFormat: {}, byFormat: {}, overall: null } as never,
    hideAnathema: false,
    gate: null,
  });
  const e = evaluatePredictions(ctx);
  const f = (v: number | null) => (v === null ? "none" : v.toFixed(3));
  console.log(`Books: ${ctx.books.length}; with taste evidence (n): ${e.n}; book query ${loadMs.toFixed(0)} ms`);
  console.log(`Coverage ${(e.coverage * 100).toFixed(1)}%; MAE ${f(e.mae)}; baseline MAE ${f(e.baselineMae)}`);
  console.log(
    `Gate: ${passesGate(e) ? "on" : "off"} (needs ${GATE_MIN_BOOKS} rated books and MAE <= ${GATE_RATIO} x baseline${e.n < GATE_MIN_BOOKS ? `; ${e.n} rated` : ""})`,
  );
  console.log(`\nTop 10 Owned suggestions${homeId ? ` at ${homeName}` : ""}:`);
  suggest(ctx, DEFAULT_SUGGESTION_PARAMS)
    .slice(0, 10)
    .forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s.book.title} (${s.score.toFixed(2)}): ${s.reasons.join("; ") || "no reason over its threshold"}`));
} finally {
  await client.end();
}
