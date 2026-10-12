// SLN-646 private Root adapter. No connection or migration on import.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function readPin(pin) {
  const bytes = readFileSync(pin.path);
  assert.equal(bytes.length, pin.bytes);
  assert.equal(sha(bytes), pin.sha256);
  return bytes;
}
const withheld = () => new Error('Private migration transport failed; details withheld; preserve state, do not retry');

// One Docker/libpq connection for BEGIN, preliminary API calls, callback and COMMIT.
export class PsqlSession {
  constructor(docker, env) {
    assert.equal(env.PGCHANNELBINDING, 'require');
    assert.ok(['require', 'verify-ca', 'verify-full'].includes(env.PGSSLMODE));
    this.docker = docker; this.env = env;
    this.name = `durtal-sln646-migrate-${randomBytes(8).toString('hex')}`;
    const argv = ['run', '--rm', '--pull', 'never', '--name', this.name, '-i'];
    for (const key of Object.keys(env).filter((key) => key.startsWith('PG')).sort()) argv.push('--env', key);
    argv.push('postgres:16', 'psql', '-X', '-q', '-A', '-t', '--set', 'ON_ERROR_STOP=1');
    this.child = spawn(docker, argv, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.buffer = ''; this.active = null; this.closed = false; this.failed = false;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.abort();
      let at;
      while ((at = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, at).replace(/\r$/, '');
        this.buffer = this.buffer.slice(at + 1);
        const active = this.active;
        if (!active) { if (line.trim()) this.abort(); continue; }
        if (line === active.marker) {
          this.active = null;
          try {
            assert.ok(!this.failed);
            if (active.clientInfo) assert.equal(active.tlsCount, 1);
            const rows = active.clientInfo ? [active.clientTls] : active.json ? JSON.parse(active.lines.join('\n')) : [];
            assert.ok(Array.isArray(rows));
            active.resolve(rows);
          } catch { this.failed = true; active.reject(withheld()); }
        } else if (active.clientInfo) {
          // Whitelist only libpq's TLS line; host/user/database lines are discarded.
          const tls = /^SSL connection \(protocol: (TLSv[0-9.]+), cipher: ([A-Za-z0-9_-]+), (?:bits: [0-9]+, )?compression: (?:on|off)\)$/.exec(line);
          if (tls) { active.tlsCount++; active.clientTls = { protocol: tls[1], cipher: tls[2] }; }
        } else if (active.json && line.trim()) {
          active.size += Buffer.byteLength(line);
          if (active.size > 4 * 1024 * 1024) this.abort(); else active.lines.push(line);
        }
      }
    });
    // Consume but never store, echo, or interpolate provider error text.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', () => this.abort());
    this.child.on('error', () => this.abort());
    this.done = new Promise((settled) => this.child.on('close', (code) => {
      this.closed = true;
      if (this.active) { this.active.reject(withheld()); this.active = null; }
      settled(code);
    }));
  }
  run(sql, json = false, clientInfo = false) {
    if (this.closed || this.failed || this.active) return Promise.reject(withheld());
    // Source SQL is pinned; psql metacommands are transport-owned only.
    if (clientInfo ? sql !== '\\conninfo' : /^\s*\\/m.test(sql)) return Promise.reject(withheld());
    return new Promise((accept, reject) => {
      const marker = `SLN646_${randomBytes(16).toString('hex')}`;
      this.active = { marker, json, clientInfo, tlsCount: 0, clientTls: null, lines: [], size: 0, resolve: accept, reject };
      this.child.stdin.write(`${sql}\n;\n\\echo ${marker}\n`, (error) => { if (error) this.abort(); });
    });
  }
  rows(sql) {
    return this.run(`SELECT COALESCE(json_agg(row_to_json(sln646_row)), '[]'::json)::text FROM (${sql.replace(/;\s*$/, '')}) AS sln646_row`, true);
  }
  abort() {
    this.failed = true;
    if (this.active) { this.active.reject(withheld()); this.active = null; }
    this.child.stdin.destroy(); this.child.kill('SIGTERM');
  }
  async cleanup() {
    if (!this.closed) this.abort();
    spawnSync(this.docker, ['rm', '--force', this.name], { env: this.env, stdio: 'ignore', timeout: 10000 });
    const probe = spawnSync(this.docker, ['ps', '-a', '--filter', `name=^${this.name}$`, '--format', '{{.Names}}'], { env: this.env, encoding: 'utf8', timeout: 10000, maxBuffer: 4096 });
    assert.equal(probe.status, 0);
    assert.equal(probe.stdout.trim(), '');
  }
}

async function main() {
  process.umask(0o077);
  const [specPath, specHash] = process.argv.slice(2);
  const specBytes = readFileSync(specPath); assert.equal(sha(specBytes), specHash);
  const spec = JSON.parse(specBytes);
  const contract = JSON.parse(readPin(spec.pg_proxy_transport.contract));
  assert.equal(resolve(spec.source.path), contract.sourcePath);
  assert.equal(contract.protocol, 'SLN646_PRIVATE_PUBLIC_DRIZZLE_LIBPQ_R1');
  assert.equal(spec.pg_proxy_transport.runner.path, fileURLToPath(import.meta.url));
  readPin(spec.pg_proxy_transport.runner);
  for (const pin of contract.libraryPins) readPin(pin);
  const inputs = JSON.parse(readPin(spec.base_inputs));
  const folder = join(spec.source.path, 'src/lib/db/migrations');
  function sourceCheck() {
    const journal = JSON.parse(readPin(contract.journal));
    assert.equal(journal.entries.length, 89);
    assert.equal(inputs.expectedMigrations.length, 89);
    assert.deepEqual(readdirSync(folder).filter((name) => name.endsWith('.sql')).sort(), contract.migrations.map((entry) => `${entry.tag}.sql`).sort());
    for (const [i, entry] of contract.migrations.entries()) {
      assert.equal(entry.idx, i);
      assert.deepEqual([journal.entries[i].idx, journal.entries[i].tag, journal.entries[i].when], [i, entry.tag, entry.when]);
      assert.deepEqual([inputs.expectedMigrations[i].idx, inputs.expectedMigrations[i].tag, inputs.expectedMigrations[i].when, inputs.expectedMigrations[i].sha256], [i, entry.tag, entry.when, entry.sql.sha256]);
      assert.equal(entry.sql.path, join(folder, `${entry.tag}.sql`)); readPin(entry.sql);
    }
  }
  sourceCheck();
  const require = createRequire(join(contract.dependenciesRoot, 'package.json'));
  const { drizzle } = require('drizzle-orm/pg-proxy');
  const { migrate } = require('drizzle-orm/pg-proxy/migrator');
  const { readMigrationFiles } = require('drizzle-orm/migrator');
  const loaded = readMigrationFiles({ migrationsFolder: folder });
  assert.equal(loaded.length, 89);
  const keys = ['PATH', 'HOME', 'LANG', 'DOCKER_HOST', 'DOCKER_CONFIG', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSSLMODE', 'PGCHANNELBINDING', 'PGOPTIONS', 'PGCONNECT_TIMEOUT', 'PGAPPNAME'];
  const env = Object.fromEntries(keys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  assert.ok(env.PGHOST && env.PGDATABASE && env.PGUSER && env.PGPASSWORD);
  const session = new PsqlSession(spec.docker.path, env);
  const timeout = setTimeout(() => session.abort(), 150000);
  const interrupt = () => session.abort();
  process.once('SIGTERM', interrupt); process.once('SIGINT', interrupt);
  let committed = false, cleanupSettled = false, tlsObserved = false, clientTls = null, calls = 0, queryCount = 0;
  const ledgerSql = 'SELECT id, hash, created_at::text AS created_at FROM "drizzle"."__drizzle_migrations" ORDER BY id';
  function checkLedger(rows, after) {
    assert.deepEqual(rows.slice(0, 81), inputs.observed81Rows);
    assert.equal(rows.length, after ? 88 : 81);
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
    if (after) assert.deepEqual(rows.slice(81).map((row) => [row.hash, row.created_at]), contract.migrations.slice(82).map((entry) => [entry.sql.sha256, String(entry.when)]));
  }
  try {
    await session.run("BEGIN; SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '120s'; SET LOCAL idle_in_transaction_session_timeout = '30s'");
    const tls = await session.run('\\conninfo', false, true);
    assert.equal(tls.length, 1); assert.ok(tls[0].protocol.startsWith('TLSv'));
    clientTls = tls[0]; tlsObserved = true;
    const db = drizzle(async (sql, params, method) => {
      assert.equal(method, 'execute'); assert.deepEqual(params, []);
      calls++;
      if (calls <= 2) {
        assert.ok(calls === 1 ? /^\s*CREATE SCHEMA IF NOT EXISTS "drizzle"\s*$/i.test(sql) : /^\s*CREATE TABLE IF NOT EXISTS "drizzle"\."__drizzle_migrations"\s*\(/i.test(sql));
        await session.run(sql); return { rows: [] };
      }
      assert.equal(calls, 3);
      assert.ok(/^\s*SELECT id, hash, created_at FROM "drizzle"\."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1\s*$/i.test(sql));
      await session.run('LOCK TABLE "drizzle"."__drizzle_migrations" IN ACCESS EXCLUSIVE MODE');
      const beforeRows = await session.rows(ledgerSql); checkLedger(beforeRows, false);
      const pending = loaded.filter((entry) => entry.folderMillis > Math.max(...beforeRows.map((row) => Number(row.created_at))));
      assert.deepEqual(pending.map((entry) => entry.hash), contract.migrations.slice(82).map((entry) => entry.sql.sha256));
      // db.execute returns these objects directly; array-mode rows would break created_at.
      const rows = await session.rows(sql);
      assert.equal(rows.length, 1); assert.equal(String(rows[0].created_at), beforeRows.at(-1).created_at);
      return { rows };
    }, { logger: false });
    await migrate(db, async (queriesToRun) => {
      assert.equal(calls, 3); assert.ok(Array.isArray(queriesToRun));
      assert.equal(queriesToRun.length, loaded.slice(82).reduce((n, entry) => n + entry.sql.length + 1, 0));
      assert.ok(queriesToRun.every((query) => typeof query === 'string'));
      queryCount = queriesToRun.length;
      // Includes ALL generated statements AND Drizzle's own ledger INSERTs, unchanged.
      await session.run(queriesToRun.join('\n;\n'));
    }, { migrationsFolder: folder });
    checkLedger(await session.rows(ledgerSql), true); sourceCheck();
    await session.run('COMMIT'); committed = true;
    session.child.stdin.end(); assert.equal(await session.done, 0);
  } catch {
    if (!committed && !session.closed && !session.failed && !session.active) {
      try { await session.run('ROLLBACK'); } catch { /* disconnect also rolls back */ }
    }
    throw withheld();
  } finally {
    clearTimeout(timeout); process.removeListener('SIGTERM', interrupt); process.removeListener('SIGINT', interrupt);
    try { await session.cleanup(); cleanupSettled = true; }
    finally {
      writeFileSync(join(spec.output_dir, 'libpq-transport.json'), JSON.stringify({ status: committed ? 'COMMIT_ACKNOWLEDGED_ROOT_AFTER_CAPTURE_REQUIRED' : 'FAILED_OR_UNKNOWN_PRESERVE_STATE_NO_RETRY', commitAcknowledged: committed, ownedContainerRemoved: cleanupSettled, generatedQueries: queryCount, preliminaryApiCalls: calls, all89SourcePinsChecked: true, requiredSslmode: env.PGSSLMODE, requiredChannelBinding: 'require', tlsObserved, tlsEvidence: 'libpq_client_conninfo', clientTls, automaticRetry: false }) + '\n', { mode: 0o600 });
    }
  }
  console.log('Private Drizzle/libpq migration committed; Root after-capture required.');
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Private migration failed or outcome uncertain; details withheld; preserve state, do not retry.'); process.exitCode = 1; });
}
