#!/usr/bin/env python3
"""The live-migration adapter (SLN-1318): pure gates, then real throwaway postgres:16 databases.

Nothing here reads a secret or reaches a live database. The database tests
start their own local container and skip when Docker, the postgres:16 image
or the repository's node_modules are missing.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/deploy'))
import live_migrate as live
import mac_release as release

COMMIT = 'a' * 40
BINDING = 'b' * 64
DRIZZLE_MIGRATE = """
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
const client = postgres(process.env.URL, { max: 1, prepare: false, onnotice: () => {} });
try { await migrate(drizzle(client), { migrationsFolder: process.env.FOLDER }); } finally { await client.end({ timeout: 5 }); }
"""


def write_source(root, migrations):
    """A source tree whose journal holds exactly these (tag, when, sql) migrations."""
    folder = Path(root) / 'src/lib/db/migrations'
    (folder / 'meta').mkdir(parents=True)
    for tag, _, sql in migrations:
        (folder / (tag + '.sql')).write_text(sql)
    journal = {'version': '7', 'dialect': 'postgresql', 'entries': [
        {'idx': i, 'version': '7', 'when': when, 'tag': tag, 'breakpoints': True} for i, (tag, when, _) in enumerate(migrations)]}
    (folder / 'meta/_journal.json').write_text(json.dumps(journal))
    return Path(root)


def truncated_source(root, keep):
    """The repository's own migrations, cut to the first `keep` journal entries."""
    folder = ROOT / 'src/lib/db/migrations'
    entries = json.loads((folder / 'meta/_journal.json').read_text())['entries'][:keep]
    return write_source(root, [(e['tag'], e['when'], (folder / (e['tag'] + '.sql')).read_text()) for e in entries])


class FakeTransport:
    """Answers ledger reads from a list; records every other script."""

    def __init__(self, rows, apply_fails=False, after_failure=None):
        self.rows, self.apply_fails, self.after_failure, self.scripts = rows, apply_fails, after_failure, []

    def psql(self, script, timeout=180):
        if script == live.LEDGER_READ:
            return json.dumps(self.rows) + '\n'
        if script == live.ROW_COUNTS:
            return '{}\n'
        self.scripts.append(script)
        if self.apply_fails:
            if self.after_failure is not None:
                self.rows = self.after_failure
            raise release.Refusal('psql failed; details are in the private log')
        return ''

    def dump(self, output, timeout=1800):
        output.write(b'PGDMP fixture')


class PureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.volatile = patch.object(release, 'VOLATILE', ())
        self.volatile.start()
        self.receipts = self.root / 'receipts'
        self.receipts.mkdir(mode=0o700)
        # A stand-in docker the transport never runs: the interpreter itself
        # can sit in a group-writable tool cache (as on CI's runners), which
        # the executable check rightly refuses
        self.docker = self.root / 'docker'
        self.docker.write_text('#!/bin/sh\nexit 1\n')
        self.docker.chmod(0o755)
        self.source = write_source(self.root / 'source', [
            ('0000_one', 100, 'CREATE TABLE one (id int);'),
            ('0001_two', 200, 'CREATE TABLE two (id int);\n--> statement-breakpoint\nCREATE INDEX two_id ON two (id);'),
            ('0002_three', 300, 'ALTER TABLE two ADD COLUMN name text;')])
        self.entries = live.journal(self.source)
        self.row = lambda i: [self.entries[i]['sha256'], str(self.entries[i]['when'])]

    def tearDown(self):
        self.volatile.stop()
        self.temp.cleanup()

    def test_pending_follows_drizzle_newest_row_rule(self):
        state = release.migration_state
        self.assertEqual(state(self.entries, None)[0], 'behind')
        self.assertEqual([e['tag'] for e in state(self.entries, self.row(0))[1]], ['0001_two', '0002_three'])
        self.assertEqual(state(self.entries, self.row(2)), ('current', []))
        # Older rows are not compared, as Drizzle does not compare them
        self.assertEqual(live.latest([self.row(1), self.row(0)]), self.row(1))
        self.assertEqual(state(self.entries, ['f' * 64, '999'])[0], 'ahead')
        with self.assertRaisesRegex(release.Refusal, 'not one of this build'):
            state(self.entries, ['f' * 64, '200'])
        with self.assertRaisesRegex(release.Refusal, 'not one of this build'):
            state(self.entries, [self.entries[1]['sha256'], '150'])

    def test_apply_script_is_one_transaction_checked_before_and_after(self):
        rows = [self.row(0)]
        script = live.apply_script(rows, self.entries[1:])
        lines = script.splitlines()
        self.assertEqual(lines[0], 'BEGIN;'); self.assertEqual(lines[-1], 'COMMIT;')
        self.assertIn("lock_timeout = '10s'", script); self.assertIn('IN ACCESS EXCLUSIVE MODE', script)
        self.assertIn(f"<> 1 OR (SELECT hash FROM {live.LEDGER} ORDER BY id DESC LIMIT 1) IS DISTINCT FROM '{rows[0][0]}'", script)
        self.assertIn(f"<> 3 OR (SELECT hash FROM {live.LEDGER} ORDER BY id DESC LIMIT 1) IS DISTINCT FROM '{self.entries[2]['sha256']}'", script)
        order = [script.index(text) for text in ('CREATE TABLE two', 'CREATE INDEX two_id', f"VALUES ('{self.entries[1]['sha256']}', 200)",
                                                  'ADD COLUMN name', f"VALUES ('{self.entries[2]['sha256']}', 300)")]
        self.assertEqual(order, sorted(order))
        with self.assertRaisesRegex(release.Refusal, 'ledger hash'):
            live.apply_script([["x'; DROP TABLE works; --", '1']], self.entries[1:])

    def test_journal_refuses_metacommands_and_transaction_control(self):
        for index, sql in enumerate(('\\! rm -rf /', 'CREATE TABLE a (id int);\n--> statement-breakpoint\nCOMMIT;',
                                     '-- note\nBEGIN;', 'SELECT 1;\n--> statement-breakpoint\n  ROLLBACK;')):
            source = write_source(self.root / f'bad{index}', [('0000_bad', 1, sql)])
            with self.assertRaises(release.Refusal):
                live.journal(source)
        # Function bodies keep their own BEGIN and END
        body = 'CREATE FUNCTION f() RETURNS void AS $$\nBEGIN\n  PERFORM 1;\nEND;\n$$ LANGUAGE plpgsql;'
        self.assertEqual(len(live.journal(write_source(self.root / 'body', [('0000_body', 1, body)]))), 1)
        self.assertEqual(len(live.journal(ROOT)), len(release.migrations(ROOT)['entries']))

    def test_live_connection_requires_tls_and_channel_binding(self):
        url = 'postgresql://owner:p%40ss@ep-x.eu-central-1.aws.neon.tech/durtal?sslmode=require&channel_binding=require'
        env = live.libpq_environment(url)
        self.assertEqual((env['PGPASSWORD'], env['PGSSLMODE'], env['PGCHANNELBINDING']), ('p@ss', 'require', 'require'))
        self.assertNotIn(url, env.values())
        for weaker in ('postgresql://o:p@h/d?sslmode=require', 'postgresql://o:p@h/d?channel_binding=require',
                       'postgresql://o:p@h/d?sslmode=prefer&channel_binding=require',
                       'postgresql://o:p@h/d?sslmode=require&channel_binding=require&host=/tmp', 'mysql://o:p@h/d'):
            with self.assertRaises(release.Refusal):
                live.libpq_environment(weaker)

    def test_dumps_and_receipts_stay_out_of_volatile_folders(self):
        self.volatile.stop()
        try:
            with self.assertRaisesRegex(release.Refusal, 'outside /tmp'):
                with patch.object(release, 'VOLATILE', (self.root,)):
                    live.run_folder(self.receipts, 'backup')
        finally:
            self.volatile.start()
        empty = self.root / 'empty.dump'; empty.write_bytes(b'')
        with self.assertRaisesRegex(release.Refusal, 'empty'):
            live.dump_identity(empty)
        text = self.root / 'plain.sql'; text.write_text('CREATE TABLE x ();')
        with self.assertRaisesRegex(release.Refusal, 'custom-format'):
            live.dump_identity(text)

    def fixture(self, rows, transport=None, captured=None):
        """A backup and a rehearsal receipt for `rows`, as backup and rehearse write them."""
        transport = transport or FakeTransport(rows)
        connect = lambda *_: {'binding': BINDING, 'transport': transport, 'release': {'commit': COMMIT, 'migrations': release.migrations(self.source)}}
        done = live.backup('config', 'hash', self.receipts, docker=str(self.docker), connect=connect)
        backup_path = Path(done['receipt'])
        if captured is not None:
            data = json.loads(backup_path.read_text()); data['capturedEpochSeconds'] = captured
            backup_path.unlink(); release.private_json(backup_path, data)
        state, pending = release.migration_state(self.entries, live.latest(rows))
        rehearsal = self.receipts / f'rehearsal-{len(list(self.receipts.iterdir()))}.json'
        release.private_json(rehearsal, {'status': 'REHEARSAL_PASS', 'commit': COMMIT, 'journalSha256': release.migrations(self.source)['sha256'],
                                         'backup': {'path': str(backup_path), 'sha256': release.file_hash(backup_path)},
                                         'ledgerBefore': rows, 'applied': [e['tag'] for e in pending]})
        return rehearsal, connect

    def migrate(self, rehearsal, connect):
        return live.migrate('config', 'hash', 'preparation', rehearsal, self.receipts, docker=str(self.docker),
                            connect=connect, source=lambda _: (COMMIT, self.source))

    def test_migrate_applies_exactly_the_rehearsed_pending_and_leaves_evidence(self):
        rows = [self.row(0)]
        transport = FakeTransport(rows)
        rehearsal, connect = self.fixture(rows, transport)
        original = transport.psql
        def psql(script, timeout=180):
            out = original(script, timeout)
            if script.startswith('BEGIN;\n'):
                transport.rows = live.appended(rows, self.entries[1:])
            return out
        transport.psql = psql
        result = self.migrate(rehearsal, connect)
        self.assertEqual((result['status'], result['applied']), ('MIGRATED', ['0001_two', '0002_three']))
        self.assertEqual(len(transport.scripts), 1)
        evidence = json.loads(Path(result['liveMigrations']).read_text())
        self.assertEqual(evidence['migrationSha256'], release.digest(release.canonical(transport.rows)))
        self.assertEqual(evidence['evidenceSha256'], release.file_hash(result['receipt']))
        self.assertEqual(oct(Path(result['receipt']).stat().st_mode & 0o777), '0o600')

    def test_migrate_refuses_a_stale_or_foreign_backup_or_a_moved_ledger(self):
        rows = [self.row(0)]
        rehearsal, connect = self.fixture(rows, captured=time.time() - 2 * live.FRESH_SECONDS)
        with self.assertRaisesRegex(release.Refusal, 'more than an hour old'):
            self.migrate(rehearsal, connect)
        rehearsal, connect = self.fixture(rows)
        foreign = lambda *a: {**connect(*a), 'binding': 'c' * 64}
        with self.assertRaisesRegex(release.Refusal, 'another database'):
            self.migrate(rehearsal, foreign)
        other = lambda *a: {**connect(*a), 'release': {'commit': 'd' * 40, 'migrations': release.migrations(self.source)}}
        with self.assertRaisesRegex(release.Refusal, 'not the build being migrated'):
            self.migrate(rehearsal, other)
        moved = FakeTransport([self.row(0), self.row(1)])
        with self.assertRaisesRegex(release.Refusal, 'ledger changed since the backup'):
            self.migrate(rehearsal, lambda *a: {**connect(*a), 'transport': moved})
        self.assertEqual(moved.scripts, [])
        dump = json.loads(Path(json.loads(rehearsal.read_text())['backup']['path']).read_text())['dump']['path']
        Path(dump).chmod(0o600); Path(dump).write_bytes(b'PGDMP changed')
        with self.assertRaisesRegex(release.Refusal, 'dump changed'):
            self.migrate(rehearsal, connect)

    def test_a_failed_apply_reads_the_ledger_once_and_never_retries(self):
        rows = [self.row(0)]
        failing = FakeTransport(rows, apply_fails=True)
        rehearsal, connect = self.fixture(rows, failing)
        with self.assertRaisesRegex(release.Refusal, 'ROLLED_BACK'):
            self.migrate(rehearsal, connect)
        self.assertEqual(len(failing.scripts), 1)
        receipt = sorted(self.receipts.glob('migration-*/migration.json'))[-1]
        self.assertEqual(json.loads(receipt.read_text())['status'], 'ROLLED_BACK')
        acknowledged = FakeTransport(rows, apply_fails=True, after_failure=live.appended(rows, self.entries[1:]))
        rehearsal, connect = self.fixture(rows, acknowledged)
        self.assertEqual(self.migrate(rehearsal, connect)['status'], 'COMMITTED_ACK_LOST')

    def test_nothing_pending_writes_no_sql(self):
        rows = [self.row(0), self.row(1), self.row(2)]
        transport = FakeTransport(rows)
        rehearsal, connect = self.fixture(rows, transport)
        self.assertEqual(self.migrate(rehearsal, connect)['status'], 'NOTHING_PENDING')
        self.assertEqual(transport.scripts, [])


def database_tools():
    docker, node = shutil.which('docker'), shutil.which('node')
    if not docker or not node or not (ROOT / 'node_modules/drizzle-orm').exists():
        return None
    if subprocess.run([docker, 'image', 'inspect', live.IMAGE], capture_output=True).returncode:
        return None
    return docker, node


@unittest.skipUnless(database_tools(), 'Docker, the postgres:16 image and node_modules are needed')
class DatabaseTests(unittest.TestCase):
    """Real migrations on throwaway local databases, against Drizzle's own migrator."""

    @classmethod
    def setUpClass(cls):
        cls.docker, cls.node = database_tools()
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.scratch = live.Scratch(cls.docker, publish=True).__enter__()
        admin = cls.scratch.transport()
        for name in ('reference', 'base'):
            admin.psql(f'CREATE DATABASE {name};')
        journal = json.loads((ROOT / 'src/lib/db/migrations/meta/_journal.json').read_text())['entries']
        cls.keep = len(journal) - 2
        cls.pending = [entry['tag'] for entry in journal[cls.keep:]]
        cls.drizzle(cls.scratch.url('reference'), ROOT / 'src/lib/db/migrations')
        cls.drizzle(cls.scratch.url('base'), truncated_source(cls.root / 'old', cls.keep) / 'src/lib/db/migrations')

    @classmethod
    def tearDownClass(cls):
        cls.scratch.__exit__()
        cls.temp.cleanup()

    @classmethod
    def drizzle(cls, url, folder):
        env = {'PATH': os.environ['PATH'], 'HOME': str(Path.home()), 'URL': url, 'FOLDER': str(folder)}
        subprocess.run([cls.node, '--input-type=module', '-e', DRIZZLE_MIGRATE], cwd=ROOT, env=env, check=True, capture_output=True, timeout=300)

    def setUp(self):
        self.volatile = patch.object(release, 'VOLATILE', ())
        self.volatile.start()
        self.receipts = Path(tempfile.mkdtemp(dir=self.root)); self.receipts.chmod(0o700)

    def tearDown(self):
        self.volatile.stop()

    def database(self, name):
        self.scratch.transport().psql(f'CREATE DATABASE {name} TEMPLATE base;')
        return self.scratch.transport(name)

    def schema(self, name):
        out = subprocess.run([self.docker, 'exec', self.scratch.name, 'pg_dump', '--schema-only', '-U', self.scratch.USER, '-d', name],
                             capture_output=True, check=True, timeout=120).stdout.decode()
        # pg_dump's per-run restrict key differs between two dumps of one schema
        return [line for line in out.splitlines() if not line.startswith(('\\restrict', '\\unrestrict'))]

    def connect(self, transport):
        return lambda *_: {'binding': BINDING, 'transport': transport, 'release': {'commit': COMMIT, 'migrations': release.migrations(ROOT)}}

    def test_backup_rehearse_migrate_matches_drizzle(self):
        transport = self.database('live_a')
        connect = self.connect(transport)
        backup = live.backup('config', 'hash', self.receipts, docker=self.docker, connect=connect)
        self.assertGreater(backup['bytes'], 0)
        rehearsal = live.rehearse('preparation', backup['receipt'], self.receipts, docker=self.docker, source=lambda _: (COMMIT, ROOT))
        self.assertEqual(rehearsal['applied'], self.pending)
        receipt = json.loads(Path(rehearsal['receipt']).read_text())
        self.assertTrue(receipt['scratchRemoved']); self.assertEqual(receipt['liveConnections'], 0)
        result = live.migrate('config', 'hash', 'preparation', rehearsal['receipt'], self.receipts, docker=self.docker,
                              connect=connect, source=lambda _: (COMMIT, ROOT))
        self.assertEqual((result['status'], result['applied']), ('MIGRATED', self.pending))
        reference = live.read_ledger(self.scratch.transport('reference'))
        self.assertEqual(live.read_ledger(transport), reference)
        self.assertEqual(self.schema('live_a'), self.schema('reference'))
        self.assertEqual(release.migration_state(live.journal(ROOT), live.latest(reference))[0], 'current')

    def test_a_ledger_that_moved_after_the_backup_is_refused(self):
        transport = self.database('live_b')
        connect = self.connect(transport)
        backup = live.backup('config', 'hash', self.receipts, docker=self.docker, connect=connect)
        rehearsal = live.rehearse('preparation', backup['receipt'], self.receipts, docker=self.docker, source=lambda _: (COMMIT, ROOT))
        transport.psql(f'INSERT INTO {live.LEDGER} (hash, created_at) SELECT hash, created_at FROM {live.LEDGER} ORDER BY id DESC LIMIT 1;')
        moved = live.read_ledger(transport)
        with self.assertRaisesRegex(release.Refusal, 'ledger changed'):
            live.migrate('config', 'hash', 'preparation', rehearsal['receipt'], self.receipts, docker=self.docker,
                         connect=connect, source=lambda _: (COMMIT, ROOT))
        self.assertEqual(live.read_ledger(transport), moved)

    def test_a_failing_migration_rolls_back_whole(self):
        transport = self.database('live_c')
        rows = live.read_ledger(transport)
        entries = live.journal(ROOT)
        _, pending = release.migration_state(entries, live.latest(rows))
        broken = {**pending[-1], 'statements': ['CREATE TABLE durtal_probe (id int);', 'SELECT 1 / 0;']}
        with self.assertRaises(release.Refusal):
            transport.psql(live.apply_script(rows, [*pending[:-1], broken]))
        self.assertEqual(live.read_ledger(transport), rows)
        probe = transport.psql("SELECT count(*) FROM pg_class WHERE relname = 'durtal_probe';").strip()
        self.assertEqual(probe, '0')
        # A rehearsal of a dump whose migration fails stops before any receipt
        source = truncated_source(self.root / 'broken', len(release.migrations(ROOT)['entries']))
        last = sorted((source / 'src/lib/db/migrations').glob('*.sql'))[-1]
        last.write_text(last.read_text() + '\n--> statement-breakpoint\nSELECT 1 / 0;')
        backup = live.backup('config', 'hash', self.receipts, docker=self.docker, connect=self.connect(transport))
        with self.assertRaises(release.Refusal):
            live.rehearse('preparation', backup['receipt'], self.receipts, docker=self.docker, source=lambda _: (COMMIT, source))
        self.assertEqual(list(self.receipts.glob('rehearsal-*/rehearsal.json')), [])

    def test_an_empty_dump_never_rehearses(self):
        transport = self.database('live_d')
        backup = live.backup('config', 'hash', self.receipts, docker=self.docker, connect=self.connect(transport))
        data = json.loads(Path(backup['receipt']).read_text())
        Path(data['dump']['path']).write_bytes(b'')
        with self.assertRaisesRegex(release.Refusal, 'empty'):
            live.rehearse('preparation', backup['receipt'], self.receipts, docker=self.docker, source=lambda _: (COMMIT, ROOT))


if __name__ == '__main__':
    unittest.main(verbosity=1)
