// Root executes with the existing reviewed Python PG-env hand-off, never a URL argv.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const digest = (b) => createHash('sha256').update(b).digest('hex');
let session, timer, result = { status: 'FAILED_READONLY_CLIENT_DIAGNOSTIC', databaseWrites: 0 };
try {
  const [specPath, specSha] = process.argv.slice(2);
  const bytes = readFileSync(specPath); assert.equal(digest(bytes), specSha);
  const spec = JSON.parse(bytes);
  for (const pin of [spec.adapter, spec.docker]) { const b = readFileSync(pin.path); assert.equal(b.length, pin.bytes); assert.equal(digest(b), pin.sha256); }
  const allowed = ['PATH','HOME','LANG','DOCKER_HOST','DOCKER_CONFIG','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSSLMODE','PGCHANNELBINDING','PGOPTIONS','PGCONNECT_TIMEOUT','PGAPPNAME'];
  const env = Object.fromEntries(allowed.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  assert.equal(env.PGSSLMODE, 'require'); assert.equal(env.PGCHANNELBINDING, 'require');
  const { PsqlSession } = await import(pathToFileURL(spec.adapter.path).href);
  session = new PsqlSession(spec.docker.path, env); timer = setTimeout(() => session.abort(), 20000);
  await session.run("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout = '10s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '15s'");
  const tls = await session.run('\\conninfo', false, true); assert.equal(tls.length, 1);
  const state = await session.rows("SELECT current_setting('transaction_read_only') AS read_only, (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS ledger_rows");
  assert.equal(state.length, 1); assert.equal(state[0].read_only, 'on'); assert.equal(state[0].ledger_rows, 81);
  const backend = await session.rows('SELECT ssl, version, cipher, bits FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
  await session.run('ROLLBACK'); session.child.stdin.end(); assert.equal(await session.done, 0);
  result = { status: 'PASS_READONLY_CLIENT_TLS_DIAGNOSTIC', databaseWrites: 0, clientTls: tls[0], requiredSslmode: 'require', requiredChannelBinding: 'require', backendTls: backend, readOnly: 'on', ledgerRows: 81 };
} catch { process.exitCode = 1; }
finally {
  clearTimeout(timer);
  if (session) { try { await session.cleanup(); result.ownedContainerRemoved = true; } catch { result.status = 'FAIL_READONLY_CLIENT_CLEANUP'; process.exitCode = 1; } }
  // The caller receives only whitelisted TLS/probe data; no raw conninfo/provider text.
  console.log(JSON.stringify(result));
}
