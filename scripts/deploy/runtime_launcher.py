#!/usr/bin/env python3
"""SLN-577 noninteractive exact-main launcher; no installation or secret import.

Reads the existing owner env source in memory; the unchanged reviewed SLN-491
identity API verifies only the durtal-app IAM pair, without using Keychain. A failed initial
preflight exits once (launchd KeepAlive=false); only already-running server
crashes receive a bounded restart attempt. No migrations or tailnet commands.
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

# Importing packaged modules must not mutate the attested release.
sys.dont_write_bytecode = True

from mac_release import (ACCOUNT, Refusal, checked_config, clean_environment, executable,
                         file_hash, node_identity, owned_path, read_json, verify_release)


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


def load_environment(config, helper, run=bounded_run):
    """Only declared values from the existing owner source enter this process."""
    values = helper.runtime_environment(config['runtimeNames'], config['secretSource'], config['node']['path'], config['aws'])
    raw_signing = None
    if any(not isinstance(v, str) or '\x00' in v or len(v.encode()) > 65536 for v in values.values()):
        raise Refusal('Runtime secret value is invalid; contents withheld')
    env = clean_environment()
    env.update(values)
    env.update(config['environment'])
    env.update(NODE_ENV='production', HOSTNAME='127.0.0.1', PORT=str(config['port']))
    return env, {**values, **({'signing-pem': raw_signing.decode()} if raw_signing else {})}


def load_helper(config):
    path = owned_path(config['helper']['path'])
    expected = Path(config['release']) / 'deploy/phone_secrets.py'
    if path != expected or file_hash(path) != config['helper']['sha256']:
        raise Refusal('Use the packaged, reviewed shared SLN-491 helper')
    spec = importlib.util.spec_from_file_location('durtal_macos_secrets', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
