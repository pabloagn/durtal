#!/usr/bin/env python3
"""Run the app against a disposable local PostgreSQL for browser QA.

Starts postgres:16 in Docker on a loopback port, applies every migration,
loads a small synthetic catalogue and starts `next dev`. The app's Neon HTTP
driver is bridged to that database by a preload that refuses any other host
or database. No environment file, live database or S3 credential is used.
Ctrl-C stops the server and removes the container.

With --from-dump, a `pg_dump --format=custom` backup replaces the synthetic
catalogue: this is the rehearsal of a live migration. Before the pending
migrations run, every table is copied to the `rehearsal_before` schema; after
them, each copied row is compared column by column with the migrated table and
the differences are printed. The copy stays for inspection with psql. The
backup must come from pg_dump 16, which the container's pg_restore can read:

    docker run --rm -e PGURL postgres:16 sh -c 'pg_dump --format=custom "$PGURL"' > FILE

With --start, the production build in `.next` is served instead of `next dev`
(run `pnpm build` first), as the Docker image serves it: the standalone
`server.js` with its static files. This checks a release or recovery build
against the same disposable database.

With --seed-large N, scripts/qa/seed-large.sql adds N perfumes, films and
paintings with many credits, formulations and location records, for timing
checks. With --log-sql FILE, the bridge appends each query the app sends, with
its time in ms, its row count and its parameters, to FILE as one JSON line.
After --from-dump the log holds real catalogue data: keep it out of the
repository (.gitignore ignores *.jsonl).

The preview has no S3: placeholder keys make every S3 call fail. With
--s3-dir DIR, the app keeps its S3 objects as files under DIR for this run
(DURTAL_PREVIEW_S3_DIR), so uploads, imports and e-books work. It is never
set anywhere else.

    python3 scripts/qa/preview-local.py [--port 3410] [--from-dump FILE] [--start] [--seed-large N] [--log-sql FILE] [--s3-dir DIR]
"""

import argparse
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DATABASE = "durtal_preview"

# Raw: the JavaScript below keeps its backslashes
BRIDGE = r"""
import postgres from %(postgres)s;
const connection = new URL(process.env.DATABASE_URL || "http://invalid");
if (!["localhost", "127.0.0.1"].includes(connection.hostname) || connection.pathname !== "/%(database)s")
  throw new Error("The preview bridge only serves the disposable local %(database)s database");
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
"""

MIGRATE = """
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
const client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: "src/lib/db/migrations" });
await client.end();
"""

SEED = """
insert into authors(name,slug) values ('Joris-Karl Huysmans','joris-karl-huysmans'),('Thomas Mann','thomas-mann'),('Marguerite Yourcenar','marguerite-yourcenar');
insert into works(title,slug,original_language,original_year) values
 ('Against Nature','against-nature-by-joris-karl-huysmans','fr',1884),
 ('The Cathedral','the-cathedral-by-joris-karl-huysmans','fr',1898),
 ('The Magic Mountain','the-magic-mountain-by-thomas-mann','de',1924),
 ('Doctor Faustus','doctor-faustus-by-thomas-mann','de',1947),
 ('Memoirs of Hadrian','memoirs-of-hadrian-by-marguerite-yourcenar','fr',1951),
 ('The Abyss','the-abyss-by-marguerite-yourcenar','fr',1968);
insert into work_authors(work_id,author_id,role,sort_order)
 select w.id,a.id,'author',0 from works w join authors a on w.slug like '%-by-' || a.slug;
insert into editions(work_id,title,language) select id,title,original_language from works;
insert into locations(name,type) values ('Study','physical'),('Calibre','digital');
insert into venues(name,slug,type) values ('Shakespeare and Company','shakespeare-and-company','bookshop');
"""

SNAPSHOT = """
-- A backup of an earlier rehearsal already holds a copy: this one replaces it
drop schema if exists rehearsal_before cascade;
create schema rehearsal_before;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create table rehearsal_before.%I as table public.%I', t, t);
  end loop;
end $$;
"""

# Rows of each copied table that are missing from (removed) or new in (added)
# the migrated table, compared on the copied columns only: new columns and new
# tables are additive. A dropped table or column is reported, not compared.
RECONCILE = """
create temp table reconciliation(tbl text, removed bigint, added bigint, note text);
do $$ declare t text; cols text; gone text; removed bigint; added bigint; begin
  for t in select tablename from pg_tables where schemaname = 'rehearsal_before' order by 1 loop
    if to_regclass(format('public.%I', t)) is null then
      insert into reconciliation values (t, null, null, 'table dropped'); continue;
    end if;
    select string_agg(b.column_name, ', ') into gone
      from information_schema.columns b where b.table_schema = 'rehearsal_before' and b.table_name = t
      and not exists (select from information_schema.columns a where a.table_schema = 'public'
        and a.table_name = t and a.column_name = b.column_name);
    if gone is not null then
      insert into reconciliation values (t, null, null, 'columns dropped: ' || gone); continue;
    end if;
    select string_agg(format('%I::text', column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'rehearsal_before' and table_name = t;
    execute format('select count(*) from (select %s from rehearsal_before.%I except all select %s from public.%I) d', cols, t, cols, t) into removed;
    execute format('select count(*) from (select %s from public.%I except all select %s from rehearsal_before.%I) d', cols, t, cols, t) into added;
    insert into reconciliation values (t, removed, added, null);
  end loop;
end $$;
select 'tables ' || count(*) || ', rows ' || (select sum((xpath('/row/c/text()', query_to_xml(
  format('select count(*) as c from rehearsal_before.%I', tablename), false, true, '')))[1]::text::bigint)
  from pg_tables where schemaname = 'rehearsal_before') || ', tables with differences '
  || count(*) filter (where removed <> 0 or added <> 0 or note is not null) from reconciliation;
select tbl || ': ' || coalesce(note, removed || ' removed, ' || added || ' added')
  from reconciliation where removed <> 0 or added <> 0 or note is not null order by tbl;
select 'new table ' || tablename || ': ' || (xpath('/row/c/text()', query_to_xml(
  format('select count(*) as c from public.%I', tablename), false, true, '')))[1]::text || ' rows'
  from pg_tables p where schemaname = 'public'
  and not exists (select from pg_tables b where b.schemaname = 'rehearsal_before' and b.tablename = p.tablename)
  order by tablename;
"""


def run(*args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=3410)
    parser.add_argument("--from-dump", type=Path, metavar="FILE",
                        help="rehearse the pending migrations on this pg_dump backup")
    parser.add_argument("--start", action="store_true",
                        help="serve the production build in .next (next start) instead of next dev")
    parser.add_argument("--seed-large", type=int, metavar="N",
                        help="add N perfumes, N films and N paintings (scripts/qa/seed-large.sql)")
    parser.add_argument("--log-sql", type=Path, metavar="FILE",
                        help="append every query the app sends, with its time, to FILE (JSON lines)")
    parser.add_argument("--s3-dir", type=Path, metavar="DIR",
                        help="keep S3 objects as files under DIR instead of S3")
    args = parser.parse_args()
    run("docker", "image", "inspect", "postgres:16")  # Never implicitly pull.
    container = f"durtal-preview-{secrets.token_hex(4)}"
    password = secrets.token_hex(16)
    server = None
    workdir = Path(tempfile.mkdtemp(prefix="durtal-preview-"))

    def cleanup():
        if server and server.poll() is None:
            os.killpg(server.pid, signal.SIGTERM)
        subprocess.run(["docker", "rm", "-f", container], capture_output=True)
        print(f"Removed {container}.", flush=True)

    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    try:
        run("docker", "run", "--detach", "--pull", "never", "--name", container,
            "--publish", "127.0.0.1::5432", "--env", "POSTGRES_USER=durtal_preview",
            "--env", f"POSTGRES_DB={DATABASE}",
            "--env", "POSTGRES_PASSWORD", "postgres:16",
            env={**os.environ, "POSTGRES_PASSWORD": password})
        for _ in range(60):
            ready = subprocess.run(["docker", "exec", container, "pg_isready", "-h", "127.0.0.1",
                                    "-U", "durtal_preview"], capture_output=True)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("PostgreSQL did not start")
        port = run("docker", "port", container, "5432/tcp").removeprefix("127.0.0.1:")
        url = f"postgresql://durtal_preview:{password}@localhost:{port}/{DATABASE}"
        # Minimal environment: no inherited database URL, token or cloud key.
        env = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "TERM") if key in os.environ}
        env.update(DATABASE_URL=url, NEXT_TELEMETRY_DISABLED="1")
        # src/lib/env.ts stops the server without AWS keys. These placeholders
        # pass that check and are no credential: an S3 call is refused.
        env.update(AWS_ACCESS_KEY_ID="preview-no-s3", AWS_SECRET_ACCESS_KEY="preview-no-s3")
        def psql(sql):
            return run("docker", "exec", "-i", container, "psql", "-q", "-X", "-A", "-t",
                       "-v", "ON_ERROR_STOP=1", "-U", "durtal_preview", "-d", DATABASE, input=sql)

        if args.from_dump:
            with args.from_dump.open("rb") as dump:
                try:
                    run("docker", "exec", "-i", container, "pg_restore", "--no-owner", "--no-privileges",
                        "--exit-on-error", "-U", "durtal_preview", "-d", DATABASE, stdin=dump)
                except RuntimeError as error:
                    if "unsupported version" in str(error):
                        raise RuntimeError(
                            f"{error}\nMake the backup with pg_dump 16: docker run --rm -e PGURL "
                            "postgres:16 sh -c 'pg_dump --format=custom \"$PGURL\"' > FILE") from None
                    raise
            psql(SNAPSHOT)
            run("node", "--input-type=module", "-e", MIGRATE, cwd=ROOT, env=env)
            print(psql(RECONCILE), flush=True)
        else:
            run("node", "--input-type=module", "-e", MIGRATE, cwd=ROOT, env=env)
            psql(SEED)
        if args.seed_large:
            seed = (Path(__file__).parent / "seed-large.sql").read_text()
            print(psql(f"\\set n {args.seed_large}\n{seed}"), flush=True)
        if args.log_sql:
            args.log_sql.resolve().parent.mkdir(parents=True, exist_ok=True)
            env["DURTAL_PREVIEW_SQL_LOG"] = str(args.log_sql.resolve())
        if args.s3_dir:
            args.s3_dir.resolve().mkdir(parents=True, exist_ok=True)
            env["DURTAL_PREVIEW_S3_DIR"] = str(args.s3_dir.resolve())
        bridge = workdir / "neon-bridge.mjs"
        bridge.write_text(BRIDGE % {
            "postgres": repr(str(ROOT / "node_modules/postgres/src/index.js")),
            "database": DATABASE,
        })
        env["NODE_OPTIONS"] = f"--import {bridge}"
        # The data cache (unstable_cache) survives restarts: without this, a
        # preview could show records cached by an earlier run on another database.
        shutil.rmtree(ROOT / ".next/dev/cache/fetch-cache", ignore_errors=True)
        shutil.rmtree(ROOT / ".next/cache/fetch-cache", ignore_errors=True)
        if args.start:
            standalone = ROOT / ".next/standalone"
            if not (standalone / "server.js").exists():
                raise RuntimeError("No standalone build in .next: run pnpm build first")
            # As the Dockerfile lays it out: static files and public beside server.js
            shutil.copytree(ROOT / ".next/static", standalone / ".next/static", dirs_exist_ok=True)
            shutil.copytree(ROOT / "public", standalone / "public", dirs_exist_ok=True)
            shutil.rmtree(standalone / ".next/cache/fetch-cache", ignore_errors=True)
            env.update(PORT=str(args.port), HOSTNAME="127.0.0.1")
            server = subprocess.Popen(
                ["node", "server.js"], cwd=standalone, env=env, start_new_session=True)
        else:
            server = subprocess.Popen(
                ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1",
                 "--port", str(args.port)],
                cwd=ROOT, env=env, start_new_session=True)
        address = f"http://127.0.0.1:{args.port}"
        for _ in range(240):
            try:
                urllib.request.urlopen(f"{address}/taxonomy", timeout=5)
                break
            except Exception:
                time.sleep(1)
        print(f"Preview ready: {address} (database {container}, port {port})", flush=True)
        return server.wait()
    finally:
        cleanup()


if __name__ == "__main__":
    sys.exit(main())
