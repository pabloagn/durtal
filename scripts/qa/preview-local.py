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

    python3 scripts/qa/preview-local.py [--port 3410] [--from-dump FILE]
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

BRIDGE = """
import postgres from %(postgres)s;
const connection = new URL(process.env.DATABASE_URL || "http://invalid");
if (!["localhost", "127.0.0.1"].includes(connection.hostname) || connection.pathname !== "/%(database)s")
  throw new Error("The preview bridge only serves the disposable local %(database)s database");
const client = postgres(connection.toString(), { host: "127.0.0.1", max: 5, onnotice: () => {}, idle_timeout: 5 });
// Neon sends parameters as PostgreSQL text; keep booleans as text too.
client.options.serializers[16] = (v) => (typeof v === "boolean" ? (v ? "t" : "f") : String(v));
const encode = (value) =>
  value === null ? null : value instanceof Date ? value.toISOString()
  : typeof value === "object" ? JSON.stringify(value)
  : typeof value === "boolean" ? (value ? "t" : "f") : String(value);
const upstream = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const endpoint = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1"].includes(endpoint.hostname) || endpoint.pathname !== "/sql") return upstream(input, options);
  const body = JSON.parse(String(options.body));
  try {
    const results = await client.begin(async (tx) => {
      const output = [];
      for (const query of body.queries || [body]) {
        const rows = await tx.unsafe(query.query, query.params).values();
        output.push({
          command: rows.command, rowCount: rows.count,
          fields: (rows.columns ?? []).map((c) => ({ name: c.name, dataTypeID: c.type })),
          rows: rows.map((row) => row.map(encode)),
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
        bridge = workdir / "neon-bridge.mjs"
        bridge.write_text(BRIDGE % {
            "postgres": repr(str(ROOT / "node_modules/postgres/src/index.js")),
            "database": DATABASE,
        })
        env["NODE_OPTIONS"] = f"--import {bridge}"
        # The dev data cache (unstable_cache) survives restarts: without this, a
        # preview could show records cached by an earlier run on another database.
        shutil.rmtree(ROOT / ".next/dev/cache/fetch-cache", ignore_errors=True)
        server = subprocess.Popen(
            ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", str(args.port)],
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
