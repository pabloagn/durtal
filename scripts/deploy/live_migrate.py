#!/usr/bin/env python3
"""SLN-1318: back up, rehearse and apply the live database's pending migrations.

The general replacement for the one-off SLN-646 adapter. Each step is a
command and leaves a private receipt in a new folder under --receipts:

  backup    A pg_dump 16 custom-format dump of the live database, through
            Docker libpq with TLS and channel binding. An empty or unreadable
            dump is refused.
  rehearse  Restores that dump into a throwaway local postgres:16 container,
            applies the pending migrations there and reads the ledger back.
            No live connection.
  migrate   Applies the journal entries the live ledger lacks, in order and in
            one transaction. It runs only with a backup under an hour old whose
            rehearsal passed against exactly the ledger live still has.
  status    Reads the live ledger and names the pending migrations.

Pending follows Drizzle's own rule (mac_release.migration_state). No step
retries, and database output never reaches the terminal: psql's messages go
to a redacted private log beside the receipt. Dumps and receipts never live
under /tmp or /private/tmp, which macOS empties.
"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
from urllib.parse import parse_qsl, unquote, urlparse

sys.dont_write_bytecode = True

from mac_release import (HASH, REQUIRED_NAMES, Refusal, canonical, checked_config, digest, durable, executable, file_hash,
                         migration_state, migrations, owned_path, private_json, read_json, verify_preparation,
                         verify_release)

IMAGE = 'postgres:16'
LEDGER = '"drizzle"."__drizzle_migrations"'
BREAKPOINT = '--> statement-breakpoint'
FRESH_SECONDS = 3600
LIBPQ_OPTIONS = {'sslmode': 'PGSSLMODE', 'channel_binding': 'PGCHANNELBINDING', 'options': 'PGOPTIONS',
                 'connect_timeout': 'PGCONNECT_TIMEOUT', 'application_name': 'PGAPPNAME'}
TRANSACTION_CONTROL = re.compile(r'(?:COMMIT|ROLLBACK|ABORT|END|SAVEPOINT|RELEASE|START\s+TRANSACTION|SET\s+TRANSACTION|PREPARE\s+TRANSACTION)\b'
                                 r'|BEGIN\s*(?:;|$|(?:TRANSACTION|WORK|ISOLATION)\b)', re.I)
PSQL = ['psql', '-X', '-q', '-A', '-t', '--set', 'ON_ERROR_STOP=1']
LEDGER_READ = f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT coalesce(json_agg(json_build_array(hash, created_at::text) ORDER BY id), '[]')::text FROM {LEDGER};
ROLLBACK;
"""
ROW_COUNTS = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT coalesce(json_object_agg(table_name, rows ORDER BY table_name), '{}')::text FROM (
  SELECT table_name, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', table_name), false, true, '')))[1]::text::bigint AS rows
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') counted;
ROLLBACK;
"""


def run_folder(receipts, step):
    """A new private folder for one step's receipt, dump and log."""
    receipts = durable(receipts)
    if not receipts.is_dir() or receipts.stat().st_mode & 0o077:
        raise Refusal('The receipts folder must exist and be private to its owner')
    folder = receipts / f"{step}-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{secrets.token_hex(3)}"
    folder.mkdir(mode=0o700)
    return folder


def docker_path(path=None):
    found = path or shutil.which('docker') or '/usr/local/bin/docker'
    return executable(found)['path']


def docker_environment(docker):
    # Docker Desktop needs its own context; nothing else from the owner's shell
    env = {'PATH': f'{Path(docker).parent}:/usr/bin:/bin:/opt/homebrew/bin', 'HOME': str(Path.home()), 'LANG': 'en_US.UTF-8'}
    env.update({key: os.environ[key] for key in ('DOCKER_HOST', 'DOCKER_CONFIG') if key in os.environ})
    return env


def libpq_environment(url):
    """The live URL as libpq variables, refusing anything weaker than TLS with channel binding."""
    uri = urlparse(url)
    if uri.scheme not in ('postgres', 'postgresql') or not uri.hostname or not uri.username or uri.fragment or not uri.path.startswith('/'):
        raise Refusal('The database URL is not a PostgreSQL URL; contents withheld')
    pairs = parse_qsl(uri.query, keep_blank_values=True)
    options = dict(pairs)
    if len(options) != len(pairs) or set(options) - set(LIBPQ_OPTIONS):
        raise Refusal('Unsupported connection parameters; no TLS or connection setting is dropped')
    if options.get('sslmode') not in ('require', 'verify-ca', 'verify-full'):
        raise Refusal('An encrypted connection (sslmode) is required')
    if options.get('channel_binding') != 'require':
        raise Refusal('Channel binding is required')
    env = {'PGHOST': uri.hostname, 'PGPORT': str(uri.port or 5432), 'PGDATABASE': unquote(uri.path[1:]),
           'PGUSER': unquote(uri.username), 'PGPASSWORD': unquote(uri.password or ''), 'PGCONNECT_TIMEOUT': '10'}
    env.update({LIBPQ_OPTIONS[key]: value for key, value in options.items()})
    env['PGAPPNAME'] = 'durtal-live-migrate'
    return env


class Transport:
    """psql and pg_dump in a postgres:16 container; their output never reaches the terminal."""

    def __init__(self, docker, log=None):
        self.docker, self.env, self.log = docker, docker_environment(docker), log

    def _record(self, stderr):
        if self.log and stderr:
            for line in stderr.decode('utf-8', 'replace').splitlines():
                self.log.write(line)

    def psql(self, script, timeout=180):
        result, cleanup = self._run(self.command(PSQL), script.encode(), subprocess.PIPE, timeout)
        cleanup()
        if result.returncode:
            raise Refusal('psql failed; details are in the private log')
        return result.stdout.decode()

    def dump(self, output, timeout=1800):
        result, cleanup = self._run(self.command(['pg_dump', '--format=custom']), None, output, timeout)
        cleanup()
        if result.returncode:
            raise Refusal('pg_dump failed; details are in the private log')

    def _run(self, argv, data, stdout, timeout):
        result = subprocess.run(argv, input=data, stdout=stdout, stderr=subprocess.PIPE, env=self.env, timeout=timeout)
        self._record(result.stderr)
        return result, lambda: None


class LiveTransport(Transport):
    """Each call is one `docker run --rm` client over libpq TLS, removed and checked after."""

    def __init__(self, docker, pgenv, log=None):
        super().__init__(docker, log)
        self.env.update(pgenv)

    def command(self, tool):
        self.name = 'durtal-live-migrate-' + secrets.token_hex(6)
        argv = [self.docker, 'run', '--rm', '--pull', 'never', '--name', self.name, '-i']
        for key in sorted(k for k in self.env if k.startswith('PG')):
            argv += ['--env', key]
        return argv + [IMAGE, *tool]

    def _run(self, argv, data, stdout, timeout):
        name = self.name
        def cleanup():
            subprocess.run([self.docker, 'rm', '--force', name], env=self.env, capture_output=True, timeout=10)
            gone = subprocess.run([self.docker, 'container', 'inspect', name], env=self.env, capture_output=True, timeout=10)
            if gone.returncode == 0:
                raise Refusal('The database client container did not settle')
        try:
            result, _ = super()._run(argv, data, stdout, timeout)
        except BaseException:
            cleanup()
            raise
        return result, cleanup


class ContainerTransport(Transport):
    """psql and pg_dump inside a local container's own database."""

    def __init__(self, docker, container, user, database, log=None):
        super().__init__(docker, log)
        self.container, self.user, self.database = container, user, database

    def command(self, tool):
        return [self.docker, 'exec', '-i', self.container, *tool, '-U', self.user, '-d', self.database]


class Scratch:
    """A throwaway local postgres:16 for a rehearsal: no published port, removed on exit."""
    USER = DATABASE = 'durtal_rehearsal'

    def __init__(self, docker, log=None, publish=False):
        self.docker, self.log, self.publish = docker, log, publish
        self.name = 'durtal-rehearsal-' + secrets.token_hex(6)
        self.password = secrets.token_hex(16)
        self.removed = False

    def _docker(self, *args, data=None, stdin=None, timeout=120):
        env = {**docker_environment(self.docker), 'POSTGRES_PASSWORD': self.password}
        result = subprocess.run([self.docker, *args], input=data, stdin=stdin, capture_output=True, env=env, timeout=timeout)
        if self.log and result.stderr:
            for line in result.stderr.decode('utf-8', 'replace').splitlines():
                self.log.write(line)
        return result

    def __enter__(self):
        publish = ['--publish', '127.0.0.1::5432'] if self.publish else []
        started = self._docker('run', '--detach', '--pull', 'never', '--name', self.name, *publish,
                               '--env', f'POSTGRES_USER={self.USER}', '--env', f'POSTGRES_DB={self.DATABASE}',
                               '--env', 'POSTGRES_PASSWORD', IMAGE)
        if started.returncode:
            raise Refusal('The rehearsal database did not start (is postgres:16 pulled and Docker running?)')
        try:
            # The image's bootstrap server takes only sockets: wait for TCP
            for _ in range(120):
                if self._docker('exec', self.name, 'pg_isready', '-h', '127.0.0.1', '-U', self.USER, timeout=10).returncode == 0:
                    break
                time.sleep(0.5)
            else:
                raise Refusal('The rehearsal database did not become ready')
        except BaseException:
            self.__exit__()
            raise
        return self

    def __exit__(self, *_):
        self._docker('rm', '--force', self.name, timeout=30)
        self.removed = self._docker('container', 'inspect', self.name, timeout=10).returncode != 0

    def url(self, database=None):
        port = self._docker('port', self.name, '5432/tcp').stdout.decode().strip().rsplit(':', 1)[-1]
        return f'postgresql://{self.USER}:{self.password}@127.0.0.1:{port}/{database or self.DATABASE}'

    def transport(self, database=None):
        return ContainerTransport(self.docker, self.name, self.USER, database or self.DATABASE, self.log)

    def restore(self, dump):
        with Path(dump).open('rb') as stream:
            result = self._docker('exec', '-i', self.name, 'pg_restore', '--no-owner', '--no-privileges', '--exit-on-error',
                                  '-U', self.USER, '-d', self.DATABASE, stdin=stream, timeout=1800)
        if result.returncode:
            raise Refusal('The dump did not restore into postgres:16; make it with this tool (pg_dump 16)')


def journal(source):
    """The build's migrations in journal order, each with its SQL statements."""
    folder = Path(source) / 'src/lib/db/migrations'
    entries = []
    for entry in migrations(source)['entries']:
        data = (folder / (entry['tag'] + '.sql')).read_bytes()
        if digest(data) != entry['sha256']:
            raise Refusal('A migration file changed while it was read')
        sql = data.decode('utf-8')
        # psql would run a backslash line as its own command, not as SQL
        if any(line.lstrip().startswith('\\') for line in sql.splitlines()) or '$durtal_ledger$' in sql:
            raise Refusal('A migration contains a psql metacommand or the ledger check tag')
        statements = sql.split(BREAKPOINT)
        # Its own transaction control would commit part of the batch
        if any(TRANSACTION_CONTROL.match(re.sub(r'^(\s*--[^\n]*\n)*\s*', '', statement)) for statement in statements):
            raise Refusal('A migration controls its own transaction')
        entries.append({**entry, 'statements': statements})
    return entries


def latest(rows):
    return max(rows, key=lambda row: int(row[1])) if rows else None


def ledger_check(count, last):
    if last is not None and not HASH.fullmatch(last):
        raise Refusal('Unexpected ledger hash')
    expected = f"IS DISTINCT FROM '{last}'" if last else 'IS NOT NULL'
    return (f"DO $durtal_ledger$ BEGIN IF (SELECT count(*) FROM {LEDGER}) <> {int(count)} "
            f"OR (SELECT hash FROM {LEDGER} ORDER BY id DESC LIMIT 1) {expected} "
            f"THEN RAISE EXCEPTION 'The migration ledger changed'; END IF; END $durtal_ledger$;")


def apply_script(rows, pending):
    """One transaction: the ledger as it was read, each migration then its ledger row, as Drizzle writes them."""
    lines = ['BEGIN;', "SET LOCAL lock_timeout = '10s';", "SET LOCAL statement_timeout = '120s';",
             "SET LOCAL idle_in_transaction_session_timeout = '30s';",
             f'LOCK TABLE {LEDGER} IN ACCESS EXCLUSIVE MODE;', ledger_check(len(rows), rows[-1][0] if rows else None)]
    for entry in pending:
        if not HASH.fullmatch(entry['sha256']) or not isinstance(entry['when'], int):
            raise Refusal('Unexpected journal entry')
        lines += [statement + '\n;' for statement in entry['statements']]
        lines.append(f"INSERT INTO {LEDGER} (\"hash\", \"created_at\") VALUES ('{entry['sha256']}', {entry['when']});")
    lines += [ledger_check(len(rows) + len(pending), pending[-1]['sha256'] if pending else (rows[-1][0] if rows else None)), 'COMMIT;']
    return '\n'.join(lines) + '\n'


def read_ledger(transport):
    out = [line for line in transport.psql(LEDGER_READ, timeout=60).splitlines() if line.strip()]
    rows = json.loads(out[0]) if len(out) == 1 else None
    if (not isinstance(rows, list) or any(not isinstance(row, list) or len(row) != 2 or not isinstance(row[0], str)
                                          or not HASH.fullmatch(row[0]) or not re.fullmatch(r'\d{1,16}', str(row[1])) for row in rows)):
        raise Refusal('Unexpected migration ledger')
    return rows


def row_counts(transport):
    out = [line for line in transport.psql(ROW_COUNTS, timeout=300).splitlines() if line.strip()]
    return json.loads(out[0]) if len(out) == 1 else {}


def appended(rows, pending):
    return rows + [[entry['sha256'], str(entry['when'])] for entry in pending]


def prepared_source(preparation):
    """The pinned source a release was built from (mac_release prepare/build)."""
    directory = owned_path(preparation)
    state, source, _ = verify_preparation(directory, production=(directory / 'build.json').exists())
    return state['commit'], source


def connect(config_path, config_hash, folder, docker):
    """The live database as the release would reach it: the packaged reviewed helper reads the owner's source."""
    import runtime_launcher
    config_path = owned_path(config_path)
    if config_path.stat().st_mode & 0o077 or file_hash(config_path) != config_hash:
        raise Refusal('Private runtime config differs from reviewed hash')
    config = checked_config(read_json(config_path))
    manifest = verify_release(config['release'])
    helper = runtime_launcher.load_helper(config)
    values = helper.runtime_environment(sorted(REQUIRED_NAMES), config['secretSource'], config['node']['path'], config['aws'])
    url = values['DATABASE_URL']
    pgenv = libpq_environment(url)
    log = runtime_launcher.BoundedLog(folder / 'log', {'DATABASE_URL': url, 'PGPASSWORD': pgenv['PGPASSWORD']})
    return {'binding': digest(url.encode()), 'transport': LiveTransport(docker, pgenv, log), 'release': manifest}


def backup(config_path, config_hash, receipts, docker=None, connect=connect):
    docker = docker_path(docker)
    folder = run_folder(receipts, 'backup')
    live = connect(config_path, config_hash, folder, docker)
    rows = read_ledger(live['transport'])
    dump = folder / 'live.dump'
    fd = os.open(dump, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        live['transport'].dump(output)
    identity = dump_identity(dump)
    receipt = {'status': 'BACKUP_PASS', 'capturedEpochSeconds': time.time(), 'databaseBindingSha256': live['binding'],
               'tool': IMAGE + ' pg_dump --format=custom', 'dump': identity, 'ledger': rows}
    private_json(folder / 'backup.json', receipt)
    return {'status': receipt['status'], 'receipt': str(folder / 'backup.json'), 'bytes': identity['bytes']}


def dump_identity(path):
    path = durable(path)
    if path.is_symlink() or not path.is_file():
        raise Refusal('The dump must be a regular file')
    with path.open('rb') as stream:
        magic = stream.read(5)
    if path.stat().st_size == 0 or magic != b'PGDMP':
        raise Refusal('The dump is empty or not a pg_dump custom-format file')
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': file_hash(path)}


def checked_backup(path):
    backup = read_json(durable(path))
    if backup.get('status') != 'BACKUP_PASS':
        raise Refusal('A passed backup receipt is required')
    if dump_identity(backup['dump']['path']) != backup['dump']:
        raise Refusal('The dump changed since its backup receipt')
    return backup


def rehearse(preparation, backup_receipt, receipts, docker=None, source=prepared_source):
    docker = docker_path(docker)
    commit, root = source(preparation)
    entries = journal(root)
    backup = checked_backup(backup_receipt)
    folder = run_folder(receipts, 'rehearsal')
    import runtime_launcher
    log = runtime_launcher.BoundedLog(folder / 'log', {})
    with Scratch(docker, log) as scratch:
        scratch.restore(backup['dump']['path'])
        transport = scratch.transport()
        rows = read_ledger(transport)
        if rows != backup['ledger']:
            raise Refusal('The restored ledger differs from the one read at backup')
        if not rows:
            raise Refusal('Refusing a database with an empty migration ledger')
        state, pending = migration_state(entries, latest(rows))
        if state == 'ahead':
            raise Refusal('The database is ahead of this build')
        before = row_counts(transport)
        if pending:
            transport.psql(apply_script(rows, pending), timeout=1800)
        after_rows = read_ledger(transport)
        if after_rows != appended(rows, pending):
            raise Refusal('The rehearsed ledger is not the expected one')
        after = row_counts(transport)
    receipt = {'status': 'REHEARSAL_PASS', 'commit': commit, 'journalSha256': migrations(root)['sha256'],
               'backup': {'path': str(Path(backup_receipt)), 'sha256': file_hash(backup_receipt)},
               'ledgerBefore': rows, 'applied': [entry['tag'] for entry in pending],
               'rowCountChanges': {name: [before.get(name), after.get(name)] for name in sorted(set(before) | set(after))
                                   if before.get(name) != after.get(name)},
               'scratchRemoved': scratch.removed, 'liveConnections': 0}
    if not scratch.removed:
        raise Refusal('The rehearsal container was not removed')
    private_json(folder / 'rehearsal.json', receipt)
    return {'status': receipt['status'], 'receipt': str(folder / 'rehearsal.json'), 'applied': receipt['applied'],
            'rowCountChanges': receipt['rowCountChanges']}


def migrate(config_path, config_hash, preparation, rehearsal_receipt, receipts, docker=None, connect=connect, source=prepared_source):
    docker = docker_path(docker)
    commit, root = source(preparation)
    entries = journal(root)
    rehearsal = read_json(durable(rehearsal_receipt))
    if rehearsal.get('status') != 'REHEARSAL_PASS' or rehearsal.get('commit') != commit or rehearsal.get('journalSha256') != migrations(root)['sha256']:
        raise Refusal("A passed rehearsal of this build's migrations is required")
    if file_hash(rehearsal['backup']['path']) != rehearsal['backup']['sha256']:
        raise Refusal('The backup receipt changed since the rehearsal')
    backup = checked_backup(rehearsal['backup']['path'])
    if not 0 <= time.time() - backup['capturedEpochSeconds'] <= FRESH_SECONDS:
        raise Refusal('The backup is more than an hour old; back up and rehearse again')
    folder = run_folder(receipts, 'migration')
    live = connect(config_path, config_hash, folder, docker)
    if live['release']['commit'] != commit or live['release']['migrations'] != migrations(root):
        raise Refusal("The runtime config's release is not the build being migrated")
    if live['binding'] != backup['databaseBindingSha256']:
        raise Refusal('The backup is of another database')
    rows = read_ledger(live['transport'])
    if rows != rehearsal['ledgerBefore']:
        raise Refusal('The live ledger changed since the backup; back up and rehearse again')
    state, pending = migration_state(entries, latest(rows))
    if state == 'ahead' or [entry['tag'] for entry in pending] != rehearsal['applied']:
        raise Refusal('The pending migrations differ from the rehearsed ones')
    record = {'status': 'NOTHING_PENDING' if not pending else 'MIGRATION_STARTED', 'databaseBindingSha256': live['binding'],
              'commit': commit, 'rehearsal': {'path': str(Path(rehearsal_receipt)), 'sha256': file_hash(rehearsal_receipt)},
              'pending': [entry['tag'] for entry in pending], 'automaticRetry': False}
    receipt = folder / 'migration.json'
    def save():
        receipt.unlink(missing_ok=True)
        private_json(receipt, record)
    save()
    if pending:
        expected = appended(rows, pending)
        try:
            live['transport'].psql(apply_script(rows, pending), timeout=1800)
        except Exception:
            # One read-only look settles what the transaction did; never a retry
            try:
                seen = read_ledger(live['transport'])
            except Exception:
                seen = None
            record['status'] = ('ROLLED_BACK' if seen == rows else 'COMMITTED_ACK_LOST' if seen == expected
                                else 'OUTCOME_UNKNOWN_PRESERVE_STATE')
            save()
            if record['status'] != 'COMMITTED_ACK_LOST':
                raise Refusal(f"Migration failed: {record['status']}; details are in the private log; do not retry before reading it") from None
        else:
            if read_ledger(live['transport']) != expected:
                record['status'] = 'OUTCOME_UNKNOWN_PRESERVE_STATE'
                save()
                raise Refusal('The ledger after the migration is not the expected one; preserve state')
            record['status'] = 'MIGRATED'
            save()
        rows = expected
    # The evidence transition-plan requires
    evidence = {'version': 1, 'migrationSha256': digest(canonical(rows)), 'evidenceSha256': file_hash(receipt)}
    private_json(folder / 'live-migrations.json', evidence)
    return {'status': record['status'], 'receipt': str(receipt), 'applied': record['pending'],
            'liveMigrations': str(folder / 'live-migrations.json')}


def status(config_path, config_hash, receipts, docker=None, connect=connect):
    docker = docker_path(docker)
    folder = run_folder(receipts, 'status')
    live = connect(config_path, config_hash, folder, docker)
    rows = read_ledger(live['transport'])
    state, pending = migration_state(live['release']['migrations']['entries'], latest(rows))
    return {'state': state, 'ledgerRows': len(rows), 'pending': [entry['tag'] for entry in pending]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = parser.add_subparsers(dest='mode', required=True)
    for mode in ('backup', 'migrate', 'status'):
        p = subs.add_parser(mode)
        p.add_argument('--config', required=True); p.add_argument('--config-sha256', required=True)
        p.add_argument('--receipts', required=True); p.add_argument('--docker')
        if mode == 'migrate':
            p.add_argument('--preparation', required=True); p.add_argument('--rehearsal', required=True)
    p = subs.add_parser('rehearse')
    p.add_argument('--preparation', required=True); p.add_argument('--backup', required=True)
    p.add_argument('--receipts', required=True); p.add_argument('--docker')
    args = parser.parse_args()
    os.umask(0o077)
    if args.mode == 'backup': result = backup(args.config, args.config_sha256, args.receipts, args.docker)
    elif args.mode == 'rehearse': result = rehearse(args.preparation, args.backup, args.receipts, args.docker)
    elif args.mode == 'migrate': result = migrate(args.config, args.config_sha256, args.preparation, args.rehearsal, args.receipts, args.docker)
    else: result = status(args.config, args.config_sha256, args.receipts, args.docker)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, Refusal) else 'Live migration step failed; details withheld; preserve state, do not retry',
              file=sys.stderr)
        raise SystemExit(1)
