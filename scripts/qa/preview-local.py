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
(DURTAL_PREVIEW_S3_DIR), so uploads, imports and e-books work, and a delete
removes its files as on S3. It is never set anywhere else. E-book files sit
under DIR/<e-book bucket>/<key>, and the app serves them by byte range itself
(EBOOK_DELIVERY=app, always).

With --seed-reader (needs --s3-dir), the e-book fixtures of
src/__tests__/fixtures/ebooks/ are stored in DIR under their real keys and
catalogued (eBooks sub-issue 3): the EPUB 3 and the text PDF linked to copies
of seeded books in the "eBooks" location, the MOBI standalone, the FB2
pending, and every other fixture standalone (the DRM one pending, with its
DRM). Their ids are fixed (READER_EBOOKS below), so the reader's checks can
open /reader/<id>. With --reader-large DIR as well, the large fixtures that
`node scripts/qa/make-ebook-fixtures.mjs --large DIR` writes (a 5 MB EPUB, a
50 MB illustrated EPUB, a 300 MB scanned PDF, a 2,000-page EPUB and a 2 MB
chapter) are stored and catalogued the same way, for scripts/qa/reader-perf.mjs.

With --api-token, the app gets a random DURTAL_API_TOKEN for this run only,
printed once at start, so the phone's /api/readings routes can be checked
with curl. It is never the live token. Without it the variable stays unset
and those routes answer 503.

    python3 scripts/qa/preview-local.py [--port 3410] [--from-dump FILE] [--start] [--seed-large N] [--log-sql FILE] [--s3-dir DIR [--seed-reader [--reader-large DIR]]] [--api-token]
"""

import argparse
import hashlib
import json
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

# The app's Neon HTTP driver, bridged to the disposable database. One file,
# loaded with --import by this preview and by `pnpm ebooks:ingest --preview`.
BRIDGE = ROOT / "scripts/qa/neon-local-bridge.mjs"
# Where a running preview leaves its database URL and S3 folder for
# `pnpm ebooks:ingest --preview PORT`; removed when the preview stops
STATE = Path(tempfile.gettempdir())

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
insert into locations(name,type) values ('Study','physical');
-- Migration 0075 already made the digital "eBooks" location on an empty database
insert into locations(name,type) select 'eBooks','digital' where not exists (select 1 from locations where name='eBooks' and type='digital');
insert into venues(name,slug,type) values ('Shakespeare and Company','shakespeare-and-company','bookshop');
-- A publisher of the French editions: /organizations/* has a page to open (page-weight.json)
insert into publishing_houses(name,slug,kind) values ('Gallimard','gallimard','publisher');
insert into edition_publishers(edition_id,publisher_id)
 select e.id,h.id from editions e join publishing_houses h on h.slug='gallimard' where e.language='fr';
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


# The reader's fixtures in the preview (eBooks sub-issue 3): id, file, format,
# match state, the seeded work a linked one is a copy of, DRM
READER_EBOOKS = [
    ("00000000-0000-4000-a000-000000000001", "epub3.epub", "epub", "linked", "against-nature-by-joris-karl-huysmans", None),
    ("00000000-0000-4000-a000-000000000002", "text.pdf", "pdf", "linked", "the-magic-mountain-by-thomas-mann", None),
    ("00000000-0000-4000-a000-000000000003", "mobi.mobi", "mobi", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000004", "fb2.fb2", "fb2", "pending", None, None),
    ("00000000-0000-4000-a000-000000000005", "epub2.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000006", "azw3.azw3", "azw3", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000007", "cbz.cbz", "cbz", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000008", "rtl.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000009", "vertical-ja.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000010", "obfuscated-font.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000011", "scripted.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000012", "corrupt.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000013", "drm.epub", "epub", "pending", None, "adobe-adept"),
]
# The large ones, from --reader-large DIR, all standalone
READER_LARGE = [
    ("00000000-0000-4000-a000-000000000014", "typical-5mb.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000015", "illustrated-50mb.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000016", "scanned-300mb.pdf", "pdf", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000017", "long-2000-pages.epub", "epub", "standalone", None, None),
    ("00000000-0000-4000-a000-000000000018", "single-2mb-chapter.epub", "epub", "standalone", None, None),
]
# Each fixture's title and language, as make-ebook-fixtures.mjs writes them
READER_TITLES = {
    "epub3.epub": ("The Distant Orchard", "en"), "text.pdf": ("The Sudden Winter", "en"),
    "mobi.mobi": ("The Grey Bridge", "en"), "fb2.fb2": ("The Quiet Clerk", "en"),
    "epub2.epub": ("The Narrow House", "en"), "azw3.azw3": ("The Pale Tower", "en"),
    "cbz.cbz": ("The Six Panels", "en"), "rtl.epub": ("كتاب الليل", "ar"), "vertical-ja.epub": ("夜の川", "ja"),
    "obfuscated-font.epub": ("The Hidden Letter", "en"), "scripted.epub": ("The Open Window", "en"),
    "corrupt.epub": ("The Broken Seal", "en"), "drm.epub": ("The Locked Room", "en"),
    "typical-5mb.epub": ("The Ordinary Year", "en"), "illustrated-50mb.epub": ("The Painted Field", "en"),
    "scanned-300mb.pdf": ("The Scanned Ledger", "en"), "long-2000-pages.epub": ("The Long Road", "en"),
    "single-2mb-chapter.epub": ("The One Room", "en"),
}
READER_TYPES = {
    "epub": "application/epub+zip", "pdf": "application/pdf", "mobi": "application/x-mobipocket-ebook",
    "azw3": "application/vnd.amazon.mobi8-ebook", "fb2": "application/x-fictionbook+xml",
    "cbz": "application/vnd.comicbook+zip",
}


def reader_seed(s3_dir, large_dir=None):
    """The fixtures under their keys in DIR (bucket durtal-ebooks, no prefix), and the SQL that catalogues them."""
    fixtures = ROOT / "src/__tests__/fixtures/ebooks"
    sql = []
    def text(value):
        return "null" if value is None else "'" + str(value).replace("'", "''") + "'"
    sources = [(fixtures, row) for row in READER_EBOOKS]
    if large_dir:
        missing = [row[1] for row in READER_LARGE if not (large_dir / row[1]).is_file()]
        if missing:
            raise RuntimeError(f"--reader-large: {', '.join(missing)} not in {large_dir} "
                               "(node scripts/qa/make-ebook-fixtures.mjs --large DIR writes them)")
        sources += [(large_dir, row) for row in READER_LARGE]
    for folder, (ebook_id, name, fmt, state, work, drm) in sources:
        source = folder / name
        digest = hashlib.sha256()
        with source.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                digest.update(chunk)
        sha = digest.hexdigest()
        size = source.stat().st_size
        key = f"files/{sha[:2]}/{sha}.{fmt}"
        target = s3_dir.resolve() / "durtal-ebooks" / key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        file_id = ebook_id[:-12] + "f" + ebook_id[-11:]
        title, language = READER_TITLES[name]
        copy = "null"
        if work:
            sql.append(f"""insert into instances(id, edition_id, location_id, format)
  select '{file_id[:-12]}c{file_id[-11:]}', e.id, l.id, '{fmt}' from editions e join works w on w.id = e.work_id
  join locations l on l.name = 'eBooks' and l.type = 'digital' where w.slug = {text(work)} limit 1;""")
            copy = f"'{file_id[:-12]}c{file_id[-11:]}'"
        sql.append(f"""insert into ebooks(id, title, authors, language, match_state, instance_id, import_source, import_ref)
  values ('{ebook_id}', {text(title)}, '{{"Durtal Fixtures"}}', '{language}', '{state}', {copy}, 'folder', {text('fixtures/' + name)});
insert into ebook_files(id, ebook_id, sha256, s3_key, format, size_bytes, content_type, original_filename, status, drm)
  values ('{file_id}', '{ebook_id}', '{sha}', '{key}', '{fmt}', {size}, '{READER_TYPES[fmt]}', {text(name)}, 'stored', {text(drm)});
update ebooks set preferred_file_id = '{file_id}' where id = '{ebook_id}' and {text(drm)} is null;""")
    # SLN-493: a PDF of the first EPUB's e-book, with its own immutable bytes.
    # A trailing PDF comment preserves the text fixture while giving it a unique checksum/key.
    alternate = (fixtures / "text.pdf").read_bytes() + b"\n% Durtal reader sync alternate format\n"
    sha = hashlib.sha256(alternate).hexdigest()
    key = f"files/{sha[:2]}/{sha}.pdf"
    target = s3_dir.resolve() / "durtal-ebooks" / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(alternate)
    sql.append(f"""insert into ebook_files(id, ebook_id, sha256, s3_key, format, size_bytes, content_type, original_filename, status)
  values ('00000000-0000-4000-a000-e00000000001', '{READER_EBOOKS[0][0]}', '{sha}', '{key}', 'pdf',
    {len(alternate)}, 'application/pdf', 'reader-sync.pdf', 'stored');""")
    return "\n".join(sql)


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
    parser.add_argument("--seed-reader", action="store_true",
                        help="store and catalogue the e-book fixtures (needs --s3-dir)")
    parser.add_argument("--reader-large", type=Path, metavar="DIR",
                        help="with --seed-reader, also the large fixtures make-ebook-fixtures.mjs --large wrote to DIR")
    parser.add_argument("--api-token", action="store_true",
                        help="give the app a random API token for this run, printed once")
    args = parser.parse_args()
    if args.seed_reader and not args.s3_dir:
        parser.error("--seed-reader needs --s3-dir: the e-books are stored there")
    if args.reader_large and not args.seed_reader:
        parser.error("--reader-large goes with --seed-reader")
    run("docker", "image", "inspect", "postgres:16")  # Never implicitly pull.
    container = f"durtal-preview-{secrets.token_hex(4)}"
    password = secrets.token_hex(16)
    server = None
    state = STATE / f"durtal-preview-{args.port}.json"

    def cleanup():
        if server and server.poll() is None:
            os.killpg(server.pid, signal.SIGTERM)
        state.unlink(missing_ok=True)
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
        # E-book files are always sent by the app's own Range route: a preview never needs AWS
        env.update(EBOOK_DELIVERY="app")
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
        if args.seed_reader:
            psql(reader_seed(args.s3_dir, args.reader_large))
            count = len(READER_EBOOKS) + (len(READER_LARGE) if args.reader_large else 0)
            print(f"Reader fixtures: {count} e-books, /reader/{READER_EBOOKS[0][0]} and on", flush=True)
        if args.log_sql:
            args.log_sql.resolve().parent.mkdir(parents=True, exist_ok=True)
            env["DURTAL_PREVIEW_SQL_LOG"] = str(args.log_sql.resolve())
        if args.s3_dir:
            args.s3_dir.resolve().mkdir(parents=True, exist_ok=True)
            env["DURTAL_PREVIEW_S3_DIR"] = str(args.s3_dir.resolve())
        if args.api_token:
            env["DURTAL_API_TOKEN"] = secrets.token_urlsafe(32)
            print(f"API token for this preview only: {env['DURTAL_API_TOKEN']}", flush=True)
        else:
            env.pop("DURTAL_API_TOKEN", None)
        env["NODE_OPTIONS"] = f"--import {BRIDGE.as_uri()}"
        # Readable by this user only: the URL holds the container's password
        fd = os.open(state, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump({"databaseUrl": url, "s3Dir": env.get("DURTAL_PREVIEW_S3_DIR")}, out)
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
            # pdf.js's worker, cmaps and fonts in public/vendor/pdfjs (pnpm dev does this too)
            run("node", "scripts/vendor-pdfjs.mjs", cwd=ROOT)
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
