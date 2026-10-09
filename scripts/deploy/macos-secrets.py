#!/usr/bin/env python3
"""Scoped owner login Keychain API and reviewed one-time runtime env import.

No plaintext exports, argv secrets, blanket ACLs, dotenv execution or file writes
back to owner env files. Runtime deployment/launch itself belongs to SLN509.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

EMAIL_SERVICE = 'com.durtal.aws-budget-alert-email'
KEY_SERVICE = 'com.durtal.ebooks.cloudfront-private-key'
RUNTIME_PREFIX = 'com.durtal.runtime-env.'
RUNTIME_NAMES = frozenset(('DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_BUCKET',
    'DURTAL_API_TOKEN', 'ADMIN_TOKEN', 'GOOGLE_BOOKS_API_KEY', 'GOOGLE_PLACES_API_KEY', 'ISBNDB_API_KEY', 'ISBNDN_API_KEY',
    'ENRICHMENT_CONTACT', 'ENRICHMENT_MONTHLY_CAP_USD', 'TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'ANTHROPIC_API_KEY',
    'NEXT_PUBLIC_MAPBOX_TOKEN', 'EBOOKS_BUCKET', 'EBOOKS_PREFIX', 'EBOOKS_REGION', 'EBOOK_DELIVERY',
    'EBOOK_CDN_URL', 'EBOOK_CDN_KEY_PAIR_ID'))


class SecretError(RuntimeError):
    """Sanitized failure; never includes a value/provider response."""


class Keychain:
    def __init__(self, security=None, core=None, runtime_names=(), budget=True, signing=True):
        if not set(runtime_names).issubset(RUNTIME_NAMES):
            raise SecretError('Runtime name is outside the controlled import allowlist')
        self.runtime_names, self.budget, self.signing = frozenset(runtime_names), budget, signing
        if security is None:
            if sys.platform != 'darwin':
                raise SecretError('Owner login Keychain requires macOS; no fallback store')
            security = ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
            core = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
        self.security, self.core = security, core
        ptr, uint = ctypes.c_void_p, ctypes.c_uint32
        self.security.SecKeychainFindGenericPassword.argtypes = [ptr, uint, ctypes.c_char_p, uint, ctypes.c_char_p,
                                                                ctypes.POINTER(uint), ctypes.POINTER(ptr), ptr]
        self.security.SecKeychainFindGenericPassword.restype = ctypes.c_int32
        self.security.SecKeychainAddGenericPassword.argtypes = [ptr, uint, ctypes.c_char_p, uint, ctypes.c_char_p,
                                                               uint, ptr, ptr]
        self.security.SecKeychainAddGenericPassword.restype = ctypes.c_int32
        self.security.SecKeychainItemFreeContent.argtypes = [ptr, ptr]
        self.security.SecKeychainItemFreeContent.restype = ctypes.c_int32
        self.security.SecKeychainSetUserInteractionAllowed.argtypes = [ctypes.c_ubyte]
        self.security.SecKeychainSetUserInteractionAllowed.restype = ctypes.c_int32
        self.security.SecKeychainOpen.argtypes = [ctypes.c_char_p, ctypes.POINTER(ptr)]
        self.security.SecKeychainOpen.restype = ctypes.c_int32
        if self.security.SecKeychainSetUserInteractionAllowed(False):
            raise SecretError('Cannot configure noninteractive Keychain access')
        self.reference = ptr()
        login = Path.home() / 'Library/Keychains/login.keychain-db'
        if self.security.SecKeychainOpen(os.fsencode(login), ctypes.byref(self.reference)):
            raise SecretError('Owner login Keychain is unavailable')
        if self.core:
            self.core.CFRelease.argtypes = [ptr]
            self.core.CFRelease.restype = None

    def close(self):
        if getattr(self, 'reference', None) and self.reference.value:
            if self.core:
                self.core.CFRelease(self.reference)
            self.reference = ctypes.c_void_p()

    def _scope(self, service, account):
        if self.budget and service == EMAIL_SERVICE and re.fullmatch(r'\d{12}', account):
            return
        if self.signing and service == KEY_SERVICE and re.fullmatch(r'\d{12}:[a-f0-9]{64}', account):
            return
        if service.startswith(RUNTIME_PREFIX) and service[len(RUNTIME_PREFIX):] in self.runtime_names and re.fullmatch(r'\d{12}', account):
            return
        raise SecretError('Keychain service/account is outside this helper capability scope')

    def get(self, service, account):
        self._scope(service, account)
        service, account = service.encode(), account.encode()
        length, data = ctypes.c_uint32(), ctypes.c_void_p()
        status = self.security.SecKeychainFindGenericPassword(self.reference, len(service), service, len(account), account,
                                                            ctypes.byref(length), ctypes.byref(data), None)
        if status == -25300:
            return None
        if status:
            raise SecretError('Keychain unavailable/locked/access denied (status %d)' % status)
        try:
            return ctypes.string_at(data, length.value)
        finally:
            self.security.SecKeychainItemFreeContent(None, data)

    def put_once(self, service, account, value):
        self._scope(service, account)
        current = self.get(service, account)
        if current is not None:
            if current != value:
                raise SecretError('Existing Keychain value differs; explicit rotation review required')
            return
        service, account = service.encode(), account.encode()
        buffer = ctypes.create_string_buffer(value)
        status = self.security.SecKeychainAddGenericPassword(self.reference, len(service), service, len(account), account,
                                                           len(value), buffer, None)
        if status:
            raise SecretError('Keychain write failed (status %d)' % status)
        # Default creator-process ACL only. Never trust every app or pass -A/-T.


def parse_value(raw):
    value = raw.strip()
    if value.startswith(("'", '"')):
        quote = value[0]
        escaped = False
        for end in range(1, len(value)):
            char = value[end]
            if char == quote and not escaped:
                remainder = value[end + 1:].strip()
                if remainder and not remainder.startswith('#'):
                    raise SecretError('Invalid quoted env suffix (contents withheld)')
                inner = value[1:end]
                if quote == "'":
                    return inner
                return re.sub(r'\\([nrt\\"])', lambda m: {'n': '\n', 'r': '\r', 't': '\t', '\\': '\\', '"': '"'}[m[1]], inner)
            escaped = not escaped if quote == '"' and char == '\\' else False
        raise SecretError('Unclosed quoted env value (contents withheld)')
    return re.split(r'\s+#', value, maxsplit=1)[0].rstrip()


def import_values(env_root):
    """Read exact owner files only; local overrides base; never expand/execute."""
    root = Path(env_root).absolute()
    for part in (root, *root.parents):
        if part.is_symlink():
            raise SecretError('Env root must not contain symlinks')
    if not root.is_dir() or root.stat().st_uid != os.getuid():
        raise SecretError('Env root must be an owner directory')
    values, sources = {}, {}
    for name in ('.env', '.env.local'):
        path = root / name
        if path.is_symlink():
            raise SecretError('Owner env file must not be a symlink')
        if not path.exists():
            sources[name] = None
            continue
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > 1024 * 1024:
            raise SecretError('Owner env file must be a bounded owned regular file')
        with path.open('rb') as file:
            data = file.read(1024 * 1024 + 1)
        if len(data) > 1024 * 1024:
            raise SecretError('Owner env file grew beyond import limit')
        sources[name] = hashlib.sha256(data).hexdigest()
        for line in data.decode().splitlines():
            match = re.fullmatch(r'\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)', line)
            if match and match[1] in RUNTIME_NAMES:
                value = parse_value(match[2])
                if re.search(r'\$\{[^}]*\}', value):
                    raise SecretError('Runtime import requires literal values, not env interpolation')
                values[match[1]] = value
            if match and match[1] == 'AWS_SESSION_TOKEN' and parse_value(match[2]):
                raise SecretError('Runtime import excludes temporary/session credentials')
    if not sources.get('.env') and not sources.get('.env.local'):
        raise SecretError('No owner env files found')
    return values, sources


def runtime_identity(values, expected_account, run=subprocess.run):
    if not re.fullmatch(r'\d{12}', expected_account):
        raise SecretError('Configured personal account is required')
    access, secret = values.get('AWS_ACCESS_KEY_ID', ''), values.get('AWS_SECRET_ACCESS_KEY', '')
    if not re.fullmatch(r'AKIA[A-Z0-9]{16}', access) or not secret:
        raise SecretError('Runtime requires the existing long-lived IAM pair, not administrator SSO/session credentials')
    env = {k: v for k, v in os.environ.items() if not k.startswith('AWS_')}
    env.update(AWS_ACCESS_KEY_ID=access, AWS_SECRET_ACCESS_KEY=secret, AWS_CONFIG_FILE='/dev/null',
               AWS_SHARED_CREDENTIALS_FILE='/dev/null', AWS_EC2_METADATA_DISABLED='true')
    result = run(['aws', 'sts', 'get-caller-identity', '--region', 'eu-north-1', '--no-cli-pager', '--endpoint-url', 'https://sts.eu-north-1.amazonaws.com', '--output', 'json'],
                 env=env, capture_output=True)
    if result.returncode:
        raise SecretError('Runtime IAM verification failed; provider output withheld')
    try:
        identity = json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise SecretError('Runtime IAM verification response invalid; output withheld') from None
    if identity.get('Account') != expected_account or identity.get('Arn') != 'arn:aws:iam::%s:user/durtal-app' % expected_account:
        raise SecretError('Runtime IAM identity differs from the reviewed durtal-app user')


def import_plan(values, sources, expected_account):
    packet = {'account': expected_account, 'sources': sources,
              'names': sorted(values), 'helper_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    return hashlib.sha256(json.dumps(packet, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def import_once(env_root, expected_account, approved_hash, secrets=None, run=subprocess.run):
    values, sources = import_values(env_root)
    if import_plan(values, sources, expected_account) != approved_hash:
        raise SecretError('Reviewed env-import hash changed')
    runtime_identity(values, expected_account, run)
    names = sorted(values)
    store = secrets or Keychain(runtime_names=names, budget=False, signing=False)
    # Preflight all current values before the first write; no partial overwrite.
    for name in names:
        current = store.get(RUNTIME_PREFIX + name, expected_account)
        if current is not None and current != values[name].encode():
            raise SecretError('Existing runtime value differs; rotation review required')
    for name in names:
        store.put_once(RUNTIME_PREFIX + name, expected_account, values[name].encode())
    return {name: 'stored' for name in names}


def runtime_environment(names, expected_account, secrets=None, run=subprocess.run):
    """Deployment imports this API: scoped values stay in memory, never stdout."""
    if not set(names).issubset(RUNTIME_NAMES):
        raise SecretError('Runtime names are outside controlled allowlist')
    store = secrets or Keychain(runtime_names=names, budget=False, signing=False)
    values = {}
    for name in names:
        value = store.get(RUNTIME_PREFIX + name, expected_account)
        if value is None:
            raise SecretError('Required runtime variable missing: ' + name)
        values[name] = value.decode()
    runtime_identity(values, expected_account, run)
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['plan-import', 'import'])
    parser.add_argument('--env-root', type=Path, required=True)
    parser.add_argument('--expected-account', required=True)
    parser.add_argument('--approved-import-sha256')
    parser.add_argument('--apply-reviewed-import', action='store_true')
    args = parser.parse_args()
    if args.mode == 'import' and not (args.apply_reviewed_import and args.approved_import_sha256):
        parser.error('import requires explicit reviewed import hash and approval')
    if args.mode == 'plan-import':
        values, sources = import_values(args.env_root)
        runtime_identity(values, args.expected_account)
        print(json.dumps({'names': sorted(values), 'status': 'planned-read-only',
                          'import_sha256': import_plan(values, sources, args.expected_account)}))
    else:
        print(json.dumps({'names': import_once(args.env_root, args.expected_account, args.approved_import_sha256), 'status': 'imported'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, SecretError) else 'Secret operation failed; values withheld', file=sys.stderr)
        sys.exit(1)
