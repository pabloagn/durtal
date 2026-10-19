#!/usr/bin/env python3
"""SLN-577 noninteractive exact-main launcher; no installation or secret import.

Reads the existing owner env source in memory; the unchanged reviewed SLN-491
identity API verifies the durtal-app IAM pair. CloudFront mode alone reads the
existing signing Keychain item and verifies its public identity in memory. A failed initial
preflight exits once (launchd KeepAlive=false); only already-running server
crashes receive a bounded restart attempt. No migrations or tailnet commands:
a database that lacks one of this release's migrations refuses the start
(SLN-1320).
"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlparse

# Importing packaged modules must not mutate the attested release.
sys.dont_write_bytecode = True

from mac_release import (ACCOUNT, HASH, Refusal, checked_config, clean_environment, executable,
                         file_hash, migration_state, node_identity, owned_path, read_json, verify_release)


SIGNING_SERVICE = 'com.durtal.ebooks.cloudfront-private-key'
SIGNING_PUBLIC_IDENTITY = '''const fs=require('node:fs'),crypto=require('node:crypto');
try {
  const key=crypto.createPrivateKey(fs.readFileSync(0));
  if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength!==2048)
    process.exit(2);
  const pem=crypto.createPublicKey(key).export({type:'spki',format:'pem'});
  process.stdout.write(crypto.createHash('sha256').update(pem).digest('hex'));
} catch { process.exit(2); }'''


class BoundedLog:
    def __init__(self, directory, secrets, limit=10 * 1024 * 1024, copies=5):
        directory = owned_path(directory)
        directory.mkdir(mode=0o700, exist_ok=True)
        if directory.stat().st_mode & 0o077:
            raise Refusal('Runtime log directory must be private')
        self.path = directory / 'server.log'
        self.limit, self.copies = limit, copies
        self.lock = threading.Lock()
        values = list(secrets.values())
        values += [line for value in values for line in value.splitlines() if len(line) >= 8]
        # Signing PEM may have arbitrarily short body lines; never emit any.
        # Keep the existing line policy for ordinary multiline secrets.
        values += [line for line in secrets.get('signing-pem', '').splitlines() if line]
        self.secrets = sorted(set(v for v in values if v), key=len, reverse=True)
        self._check_files()

    def _check_files(self):
        for path in [self.path, *[Path(str(self.path) + '.' + str(i)) for i in range(1, self.copies + 1)]]:
            if path.is_symlink() or path.exists() and (not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077):
                raise Refusal('Unsafe runtime log file')

    def write(self, line):
        if len(line.encode()) > 8192:
            line = '[oversized log line withheld]'
        for value in self.secrets:
            line = line.replace(value, '[redacted]')
        line = re.sub(r'(?:postgres(?:ql)?|https?)://[^\s"<>]+', '[URL withheld]', line)
        if re.search(r'authorization|password|private.key|signature|credential|token|BEGIN .*PRIVATE KEY', line, re.I):
            line = '[sensitive log line withheld]'
        data = (line.rstrip('\r\n') + '\n').encode()
        with self.lock:
            self._check_files()
            if self.path.exists() and self.path.stat().st_size + len(data) > self.limit:
                Path(str(self.path) + '.' + str(self.copies)).unlink(missing_ok=True)
                for i in range(self.copies - 1, 0, -1):
                    old = Path(str(self.path) + '.' + str(i))
                    if old.exists():
                        old.rename(Path(str(self.path) + '.' + str(i + 1)))
                self.path.rename(Path(str(self.path) + '.1'))
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'ab') as f:
                f.write(data)

    def consume(self, stream):
        # Hold a complete bounded line before redaction, so a secret split
        # across pipe reads is never emitted in pieces.
        pending = b''
        dropping = False
        while chunk := stream.read(4096):
            for piece in chunk.splitlines(keepends=True):
                if not dropping:
                    pending += piece
                    if len(pending) > 8192:
                        dropping, pending = True, b''
                if piece.endswith(b'\n'):
                    self.write('[oversized log line withheld]' if dropping else pending.decode('utf-8', 'replace'))
                    pending, dropping = b'', False
        if pending or dropping:
            self.write('[oversized log line withheld]' if dropping else pending.decode('utf-8', 'replace'))


def bounded_run(args, **kwargs):
    # Passed into the helper's runtime_identity API. Never expose CompletedProcess
    # stdout/stderr, and never let unavailable STS block startup indefinitely.
    kwargs['timeout'] = 15
    return subprocess.run(args, **kwargs)


def load_signing_helper(config):
    """Only the existing helper included in the attested release may be loaded."""
    path = owned_path(Path(config['release']) / 'deploy/macos-secrets.py')
    manifest = read_json(Path(config['release']) / 'release.json')
    expected = manifest.get('deploymentToolFiles', {}).get('macos-secrets.py')
    if not expected or file_hash(path) != expected:
        raise Refusal('Packaged signing helper identity changed')
    spec = importlib.util.spec_from_file_location('durtal_signing_secrets', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_signing_key(config, run=bounded_run):
    """Read one existing signing item; never provision or export a secret."""
    try:
        if config.get('account') != ACCOUNT:
            raise Refusal('Signing account differs')
        cdn = config['cdn']
        helper = load_signing_helper(config)
        store = helper.Keychain(runtime_names=(), budget=False, signing=True)
        try:
            raw = store.get(SIGNING_SERVICE, ACCOUNT + ':' + cdn['fingerprint'])
        finally:
            store.close()
        if not isinstance(raw, bytes) or not 0 < len(raw) <= 65536 or b'\x00' in raw:
            raise Refusal('Signing item unavailable or invalid')
        raw.decode('utf-8')
        # The already-pinned Node performs crypto; private bytes travel only
        # through stdin. stdout is exactly a public fingerprint, never PEM.
        result = run([config['node']['path'], '-e', SIGNING_PUBLIC_IDENTITY],
                     input=raw, capture_output=True, timeout=15, env=clean_environment())
        if result.returncode or result.stderr or result.stdout != cdn['fingerprint'].encode('ascii'):
            raise Refusal('Signing public identity differs')
        return raw
    except Exception:
        raise Refusal('CloudFront signing preflight failed; sensitive details withheld') from None


def load_environment(config, helper, run=bounded_run):
    """Only declared values from the existing owner source enter this process."""
    values = helper.runtime_environment(config['runtimeNames'], config['secretSource'], config['node']['path'], config['aws'])
    raw_signing = None
    if any(not isinstance(v, str) or '\x00' in v or len(v.encode()) > 65536 for v in values.values()):
        raise Refusal('Runtime secret value is invalid; contents withheld')
    env = clean_environment()
    env.update(values)
    env.update(config['environment'])
    if config['environment']['EBOOK_DELIVERY'] == 'cloudfront':
        raw_signing = load_signing_key(config, run=run)
        env['EBOOK_CDN_PRIVATE_KEY'] = base64.b64encode(raw_signing).decode('ascii')
    env.update(NODE_ENV='production', HOSTNAME='127.0.0.1', PORT=str(config['port']))
    # The redactor knows both PEM and encoded form. They remain process-local
    # for bounded crash restarts; rotation requires an explicit fresh launch.
    return env, {**values, **({'signing-pem': raw_signing.decode(),
                             'EBOOK_CDN_PRIVATE_KEY': env['EBOOK_CDN_PRIVATE_KEY']} if raw_signing else {})}


def load_helper(config):
    path = owned_path(config['helper']['path'])
    expected = Path(config['release']) / 'deploy/phone_secrets.py'
    if path != expected or file_hash(path) != config['helper']['sha256']:
        raise Refusal('Use the packaged, reviewed shared SLN-491 helper')
    spec = importlib.util.spec_from_file_location('durtal_macos_secrets', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


LATEST_MIGRATION = 'SELECT hash, created_at::text FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1'


def neon_fetch(endpoint, body, headers):
    request = urllib.request.Request(endpoint, data=body, headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read(65536))


def latest_migration(url, fetch=neon_fetch):
    """The ledger's newest row, read the way the app reads its database.

    The app talks to Neon over its HTTP SQL endpoint (@neondatabase/serverless),
    the one path known to work from the Mac. This is that driver's request: the
    endpoint is the host with its first label replaced by "api.", and one
    read-only batch carries the query.
    """
    host = urlparse(url).hostname or ''
    if not host.endswith('.neon.tech'):
        raise Refusal('The migration check reads the Neon database only')
    endpoint = 'https://' + re.sub(r'^[^.]+\.', 'api.', host, count=1) + '/sql'
    body = json.dumps({'queries': [{'query': LATEST_MIGRATION, 'params': []}]}).encode()
    headers = {'Neon-Connection-String': url, 'Neon-Raw-Text-Output': 'true', 'Neon-Array-Mode': 'true',
               'Neon-Batch-Read-Only': 'true', 'Content-Type': 'text/plain;charset=UTF-8'}
    rows = fetch(endpoint, body, headers)['results'][0]['rows']
    if len(rows) > 1 or rows and (len(rows[0]) != 2 or not HASH.fullmatch(rows[0][0]) or not re.fullmatch(r'\d{1,16}', rows[0][1])):
        raise Refusal('Unexpected migration ledger')
    return (rows[0][0], rows[0][1]) if rows else None


def require_migrated(manifest, url, log, read=None):
    """Refuse to start a build whose migrations the database lacks; an older build on a newer schema may start."""
    try:
        state, pending = migration_state(manifest['migrations']['entries'], (read or latest_migration)(url))
    except Exception:
        log.write('Migration ledger check failed; start refused')
        raise Refusal('Migration ledger check failed; start refused') from None
    if state == 'behind':
        log.write('The database lacks %d migration(s) of this release (%s); start refused'
                  % (len(pending), ', '.join(entry['tag'] for entry in pending)))
        raise Refusal('The database lacks migrations of this release; start refused')
    if state == 'ahead':
        log.write('The database is ahead of this release; starting, as a rollback over additive migrations')


def unused_port(port):
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            raise Refusal('Configured loopback port is already occupied') from None


def probe_health(port, manifest, fetch=None, pid=None):
    if fetch is None:
        def fetch(url):
            # Never inherit ambient HTTP proxies for a loopback readiness check.
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=3) as response:
                if response.status != 200 or (manifest.get('healthHasBuildIdentity') is not False and response.headers.get('Cache-Control') != 'no-store'):
                    raise Refusal('Health status/cache policy mismatch')
                return json.loads(response.read(8192))
    data = fetch('http://127.0.0.1:%d/api/health' % port)
    if manifest.get('healthHasBuildIdentity') is False:
        if pid is None:
            raise Refusal('Catalogue readiness requires positive owned listener PID')
        listeners = subprocess.run(['/usr/sbin/lsof', '-nP', '-a', '-p', str(pid), '-iTCP:%d' % port, '-sTCP:LISTEN', '-Fp'], capture_output=True, timeout=5)
        owned = listeners.returncode == 0 and ('p%d' % pid).encode() in listeners.stdout.splitlines()
        return owned and data.get('status') == 'ok' and data.get('service') == 'durtal'
    expected = {key: manifest[key] for key in ('commit', 'tree', 'buildId')}
    return data.get('status') == 'ok' and data.get('service') == 'durtal' and data.get('build') == expected


def launch(config, config_hash):
    config_path = owned_path(config)
    if config_path.stat().st_mode & 0o077 or file_hash(config_path) != config_hash:
        raise Refusal('Private runtime config differs from reviewed hash')
    config = checked_config(read_json(config_path))
    manifest = verify_release(config['release'])
    node = node_identity(config['node']['path'], config['node']['sha256'])
    if {k: node[k] for k in ('path', 'sha256')} != {k: manifest['node'][k] for k in ('path', 'sha256')}:
        raise Refusal('Runtime Node differs from the build toolchain')
    python = executable(config['python']['path'], config['python']['sha256'])
    if str(Path(sys.executable).resolve()) != python['path']:
        raise Refusal('Launch/import must use the same pinned Python interpreter')
    helper = load_helper(config)
    env, secret_values = load_environment(config, helper)
    log = BoundedLog(config['logDirectory'], secret_values)
    require_migrated(manifest, env['DATABASE_URL'], log)
    # No Keychain retry occurs after failed preflight. Restart uses the same
    # verified in-memory environment; explicit rotation requires a new launch.
    stop = threading.Event()
    child = None
    def stopped(_signum, _frame):
        stop.set()
        if child and child.poll() is None:
            child.terminate()
    signal.signal(signal.SIGTERM, stopped)
    signal.signal(signal.SIGINT, stopped)
    failures = []
    while not stop.is_set():
        unused_port(config['port'])
        # Verify again before each spawn: immutable source cannot change during
        # a crash restart. Caches alone are allowed to be written by Next.js.
        verify_release(config['release'])
        child = subprocess.Popen([node['path'], 'server.js'], cwd=config['release'], env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        reader = threading.Thread(target=log.consume, args=(child.stdout,), daemon=True)
        reader.start()
        deadline, ready = time.monotonic() + 60, False
        while time.monotonic() < deadline and child.poll() is None and not stop.is_set():
            try:
                ready = probe_health(config['port'], manifest, pid=child.pid)
            except Exception:
                ready = False
            if ready:
                break
            stop.wait(1)
        if not ready and not stop.is_set():
            child.terminate()
            log.write('Startup readiness failed; no automatic promotion')
        while child.poll() is None and ready and not stop.wait(1):
            pass
        if child.poll() is None:
            try:
                child.wait(timeout=20)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        reader.join(timeout=5)
        child.stdout.close()
        if stop.is_set():
            return
        now = time.monotonic()
        failures = [at for at in failures if now - at < 300]
        failures.append(now)
        if not ready or len(failures) >= 3:
            log.write('Service stopped; explicit operator recovery required')
            return
        log.write('Server exited; bounded restart in 30 seconds')
        stop.wait(30)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--config-sha256', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    launch(args.config, args.config_sha256)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Helper, STS, crypto and Node provider responses cannot escape here.
        print('Runtime preflight/launch failed; sensitive details withheld; no automatic retry', file=sys.stderr)
        raise SystemExit(1)
