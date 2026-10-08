/*
 * The app's Neon HTTP driver, bridged to the disposable local database of a
 * preview (scripts/qa/preview-local.py). Loaded with `--import` by the
 * preview's server and by `pnpm ebooks:ingest --preview PORT`; it refuses
 * any host but this machine and any database but durtal_preview, so it can
 * never reach the live database.
 */
import postgres from "postgres";
const connection = new URL(process.env.DATABASE_URL || "http://invalid");
if (!["localhost", "127.0.0.1"].includes(connection.hostname) || connection.pathname !== "/durtal_preview")
  throw new Error("The preview bridge only serves the disposable local durtal_preview database");
const client = postgres(connection.toString(), { host: "127.0.0.1", max: 5, onnotice: () => {}, idle_timeout: 5 });
// Neon sends parameters as PostgreSQL text; keep booleans as text too.
client.options.serializers[16] = (v) => (typeof v === "boolean" ? (v ? "t" : "f") : String(v));
// JSON arrives already encoded as text; encoding it again would store a JSON
// string instead of the object (jsonb_typeof 'string').
client.options.serializers[114] = client.options.serializers[3802] = (v) => (typeof v === "string" ? v : JSON.stringify(v));
// Dates and timestamps stay PostgreSQL text both ways, as with Neon. As JS
// Dates they would keep milliseconds only: a microsecond keyset cursor
// ("2026-09-25 12:19:29.217531+00") would lose its last digits and skip rows.
for (const type of [1082, 1114, 1184]) {
  client.options.serializers[type] = (v) => (v instanceof Date ? v.toISOString() : String(v));
  client.options.parsers[type] = (v) => v;
}
// Each value back in PostgreSQL's text form, as Neon sends it: JSON columns as
// JSON (a JSON string too), arrays as {...} literals, dates as text.
const element = (value) =>
  value === null ? "NULL" : Array.isArray(value) ? `{${value.map(element).join(",")}}`
  : `"${String(value instanceof Date ? value.toISOString() : value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const encode = (value, type) =>
  value === null ? null
  : type === 114 || type === 3802 ? JSON.stringify(value)
  : Array.isArray(value) ? element(value)
  : value instanceof Date ? value.toISOString()
  : typeof value === "object" ? JSON.stringify(value)
  : typeof value === "boolean" ? (value ? "t" : "f") : String(value);
// With DURTAL_PREVIEW_SQL_LOG, one JSON line per query: its time, rows and text
import { appendFileSync } from "node:fs";
const sqlLog = process.env.DURTAL_PREVIEW_SQL_LOG;
const upstream = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const endpoint = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1"].includes(endpoint.hostname) || endpoint.pathname !== "/sql") return upstream(input, options);
  const body = JSON.parse(String(options.body));
  try {
    const results = await client.begin(async (tx) => {
      const output = [];
      for (const query of body.queries || [body]) {
        const started = performance.now();
        const rows = await tx.unsafe(query.query, query.params).values();
        // The log never breaks a query: a write that fails is skipped
        if (sqlLog) try { appendFileSync(sqlLog, JSON.stringify({ at: Date.now(), ms: +(performance.now() - started).toFixed(2), rows: rows.count, sql: query.query, params: query.params }) + "\n"); } catch {}
        output.push({
          command: rows.command, rowCount: rows.count,
          fields: (rows.columns ?? []).map((c) => ({ name: c.name, dataTypeID: c.type })),
          rows: rows.map((row) => row.map((value, i) => encode(value, rows.columns?.[i]?.type))),
        });
      }
      return output;
    });
    return Response.json(body.queries ? { results } : results[0]);
  } catch (e) {
    return Response.json({ message: e.message, code: e.code, detail: e.detail }, { status: 400 });
  }
};
