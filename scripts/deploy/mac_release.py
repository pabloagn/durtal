#!/usr/bin/env python3
"""SLN-509: isolated release preparation/packaging and read-only operation plans.

This tool never installs a service, imports secrets, migrates, switches a running
release or configures Tailscale. Build needs its own explicit --allow-build.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
import tarfile

ACCOUNT = '608240934043'
SHA = re.compile(r'[a-f0-9]{40}')
HASH = re.compile(r'[a-f0-9]{64}')
PUBLIC_BUILD_NAMES = frozenset(('NEXT_PUBLIC_MAPBOX_TOKEN',))
PUBLIC_RUNTIME_NAMES = frozenset(('APP_TIMEZONE', 'AWS_REGION', 'S3_BUCKET', 'EBOOKS_BUCKET', 'EBOOKS_PREFIX',
    'EBOOKS_REGION', 'EBOOK_DELIVERY', 'EBOOK_CDN_URL', 'EBOOK_CDN_KEY_PAIR_ID'))
SECRET_NAMES = frozenset(('DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'DURTAL_API_TOKEN',
    'ADMIN_TOKEN', 'GOOGLE_BOOKS_API_KEY', 'GOOGLE_PLACES_API_KEY', 'ISBNDB_API_KEY', 'ISBNDN_API_KEY',
    'ENRICHMENT_CONTACT', 'ENRICHMENT_MONTHLY_CAP_USD', 'TAVILY_API_KEY', 'BRAVE_SEARCH_API_KEY', 'ANTHROPIC_API_KEY'))
REQUIRED_NAMES = frozenset(('DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'))
MANIFEST = 'release.json'


class Refusal(RuntimeError):
    """Only fixed, nonsecret messages may reach an operator."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(',', ':')).encode()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read_json(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
        raise Refusal('Expected a bounded regular JSON file')
    return json.loads(path.read_bytes())


def owned_path(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
        raise Refusal('Operation paths must be absolute and contain no symlink components')
    existing = next((p for p in (path, *path.parents) if p.exists()), None)
    if existing is None or existing.stat().st_uid != os.getuid():
        raise Refusal('Operation paths must be owned by the current user')
    return path


def private_json(path, data):
    path = owned_path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(canonical(data) + b'\n')


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, timeout=kwargs.pop('timeout', 30), **kwargs)
    if result.returncode:
        raise Refusal('Subprocess failed; child output withheld')
    return result.stdout


def clean_environment(public=None):
    # Do not inherit NODE_OPTIONS, AWS profiles, database URLs, tokens, dotenv,
    # package-manager overrides or other owner shell configuration.
    env = {'PATH': '/usr/bin:/bin', 'HOME': str(Path.home()), 'LANG': 'en_US.UTF-8',
           'NEXT_TELEMETRY_DISABLED': '1', 'CI': '1'}
    if public:
        if not set(public).issubset(PUBLIC_BUILD_NAMES) or any(not isinstance(v, str) for v in public.values()):
            raise Refusal('Only declared public build inputs are accepted')
        env.update(public)
    return env


def executable(path, expected_hash=None):
    path = Path(path)
    if not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
        raise Refusal('An absolute executable path is required')
    actual = path.resolve()
    if actual.stat().st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise Refusal('Executable is writable by other users')
    identity = {'path': str(actual), 'sha256': file_hash(actual)}
    if expected_hash and identity['sha256'] != expected_hash:
        raise Refusal('Pinned executable hash changed')
    return identity


def node_identity(path, expected_hash=None):
    identity = executable(path, expected_hash)
    version = run([identity['path'], '--version'], env=clean_environment()).decode().strip()
    if not re.fullmatch(r'v22\.\d+\.\d+', version):
        raise Refusal('Release build and runtime require Node 22')
    return {**identity, 'version': version}


def source_identity(repo, commit):
    repo = owned_path(repo)
    if not SHA.fullmatch(commit):
        raise Refusal('Use a full reviewed commit SHA')
    actual = run(['git', '-C', str(repo), 'rev-parse', commit + '^{commit}']).decode().strip()
    if actual != commit:
        raise Refusal('Commit identity differs')
    tree = run(['git', '-C', str(repo), 'rev-parse', commit + '^{tree}']).decode().strip()
    return {'commit': commit, 'tree': tree}


def prepare(repo, commit, destination, node, pnpm, public):
    """Git archive only: never copy a checkout, node_modules, .next or env files."""
    identity = source_identity(repo, commit)
    destination = owned_path(destination)
    if destination.exists() or destination.is_relative_to(Path(repo).resolve()):
        raise Refusal('Preparation requires a new isolated directory outside the checkout')
    node = node_identity(node)
    pnpm = executable(pnpm)
    version = run([node['path'], pnpm['path'], '--version'], env=clean_environment()).decode().strip()
    if version != '10.26.1':
        raise Refusal('Release requires pnpm 10.26.1')
    clean_environment(public)
    archive = run(['git', '-C', str(repo), 'archive', '--format=tar', commit], timeout=60)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        members = tar.getmembers()
        for member in members:
            parts = Path(member.name).parts
            if member.name.startswith('/') or '..' in parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise Refusal('Source archive contains an unsafe member')
            if any(p.startswith('.env') and p != '.env.example' or p in ('node_modules', '.next', '.git') or p.endswith(('.pem', '.key')) for p in parts):
                raise Refusal('Source archive contains a forbidden build input')
        destination.mkdir(mode=0o700, parents=False)
        source = destination / 'source'
        source.mkdir(mode=0o700)
        tar.extractall(source, members=members, filter='data')
    lock = source / 'pnpm-lock.yaml'
    state = {**identity, 'node': node, 'pnpm': {**pnpm, 'version': version}, 'lockSha256': file_hash(lock),
             'publicInputsSha256': digest(canonical(public)), 'buildId': commit, 'sourceFiles': snapshot_source(source),
             'productionNextEnv': production_next_env(source)}
    private_json(destination / 'preparation.json', state)
    private_json(destination / 'public-build-inputs.json', public)
    return state


def snapshot(root, mutable_cache=False):
    root = Path(root).resolve()
    result = {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root).as_posix()
        if relative == MANIFEST:
            continue
        if mutable_cache and (relative == '.next/cache' or relative.startswith('.next/cache/')):
            if path.is_symlink() or not (path.is_file() or path.is_dir()):
                raise Refusal('Mutable cache cannot contain symlinks or special files')
            continue
        if path.is_symlink():
            target = os.readlink(path)
            if Path(target).is_absolute() or not path.resolve().is_relative_to(root) or not path.exists():
                raise Refusal('Artifact symlink escapes the release or is broken')
            result[relative] = {'link': target}
        elif path.is_file():
            if path.name.startswith('.env') or path.suffix in ('.pem', '.key'):
                raise Refusal('Runtime secret file cannot enter a release')
            result[relative] = {'sha256': file_hash(path), 'bytes': path.stat().st_size}
        elif not path.is_dir():
            raise Refusal('Special files cannot enter a release')
    return result


def production_next_env(source):
    # Next changes only this generated declaration import during production build.
    # Derive the expected bytes from the pinned archive, including its comments.
    data = (Path(source) / 'next-env.d.ts').read_bytes()
    development = b'import "./.next/dev/types/routes.d.ts";'
    production = b'import "./.next/types/routes.d.ts";'
    if data.count(development) + data.count(production) != 1:
        raise Refusal('Expected one known Next routes declaration import')
    expected = data.replace(development, production, 1)
    return {'sha256': digest(expected), 'bytes': len(expected)}


def verify_preparation(directory, production=False):
    directory = owned_path(directory)
    state = read_json(directory / 'preparation.json')
    public = read_json(directory / 'public-build-inputs.json')
    if digest(canonical(public)) != state['publicInputsSha256']:
        raise Refusal('Public build inputs changed')
    node_identity(state['node']['path'], state['node']['sha256'])
    executable(state['pnpm']['path'], state['pnpm']['sha256'])
    source = directory / 'source'
    actual = snapshot_source(source)
    expected = dict(state['sourceFiles'])
    if production and 'next-env.d.ts' in expected:
        if 'productionNextEnv' not in state:
            raise Refusal('Prepared production declaration expectation is missing')
        expected['next-env.d.ts'] = state['productionNextEnv']
    if actual != expected or file_hash(source / 'pnpm-lock.yaml') != state['lockSha256']:
        raise Refusal('Prepared source changed from the pinned archive')
    return state, source, public


def snapshot_source(root):
    # Generated output is excluded, but every archived source remains pinned.
    # Walk exclusions before resolving package-manager symlinks.
    root = Path(root)
    result = {}
    for base, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if d not in ('node_modules', '.next', '__pycache__')]
        if any((Path(base) / d).is_symlink() for d in dirs):
            raise Refusal('Prepared source contains an unexpected directory symlink')
        for name in sorted(files):
            path = Path(base) / name
            relative = path.relative_to(root).as_posix()
            if relative.startswith('public/vendor/pdfjs/'):
                continue
            if path.is_symlink() or not path.is_file():
                raise Refusal('Prepared source contains an unexpected symlink/special file')
            result[relative] = {'sha256': file_hash(path), 'bytes': path.stat().st_size}
    return result


def build(directory, allow=False):
    if not allow:
        raise Refusal('Heavy build requires explicit --allow-build and the coordinator slot')
    state, source, public = verify_preparation(directory)
    if (source / 'node_modules').exists() or (source / '.next').exists():
        raise Refusal('Build requires fresh dependencies and no reused build output')
    env = clean_environment(public)
    home = Path(directory) / 'build-home'
    home.mkdir(mode=0o700)
    env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / 'config'), npm_config_userconfig='/dev/null', npm_config_globalconfig='/dev/null')
    env['PATH'] = str(Path(state['node']['path']).parent) + ':/usr/bin:/bin'
    env.update(DURTAL_BUILD_COMMIT=state['commit'], DURTAL_BUILD_TREE=state['tree'], DURTAL_BUILD_ID=state['buildId'])
    command = [state['node']['path'], state['pnpm']['path']]
    # Output is deliberately not forwarded: dependency/build errors can contain
    # arbitrary source text. No runtime secret is available in this environment.
    run([*command, 'install', '--frozen-lockfile', '--store-dir', str(Path(directory) / 'pnpm-store')], cwd=source, env=env, timeout=1200)
    run([*command, 'build'], cwd=source, env=env, timeout=1200)
    verify_preparation(directory, production=True)
    build_id = (source / '.next/BUILD_ID').read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', build_id):
        raise Refusal('Invalid baked Next build ID')
    private_json(Path(directory) / 'build.json', {'buildId': build_id, 'preparationSha256': file_hash(Path(directory) / 'preparation.json'),
        'standaloneFiles': snapshot(source / '.next/standalone', mutable_cache=True),
        'staticFiles': snapshot(source / '.next/static'), 'publicFiles': snapshot(source / 'public')})
    return {'built': True, 'commit': state['commit']}


def migrations(source):
    folder = Path(source) / 'src/lib/db/migrations'
    journal = read_json(folder / 'meta/_journal.json')
    entries = []
    previous = -1
    for entry in journal['entries']:
        if entry['when'] <= previous or not re.fullmatch(r'\d{4}_[a-zA-Z0-9_-]+', entry['tag']):
            raise Refusal('Migration journal is not strictly ordered')
        previous = entry['when']
        entries.append({'tag': entry['tag'], 'when': entry['when'], 'sha256': file_hash(folder / (entry['tag'] + '.sql'))})
    return {'entries': entries, 'sha256': digest(canonical(entries))}


def package(directory, destination, retained=None):
    state, source, _ = verify_preparation(directory, production=True)
    proof = read_json(Path(directory) / 'build.json')
    if proof['preparationSha256'] != file_hash(Path(directory) / 'preparation.json'):
        raise Refusal('Build provenance changed')
    for key, folder in [('standaloneFiles', '.next/standalone'), ('staticFiles', '.next/static'), ('publicFiles', 'public')]:
        if snapshot(source / folder, mutable_cache=key == 'standaloneFiles') != proof[key]:
            raise Refusal('Built output changed before packaging')
    tooling = Path(__file__).resolve().parent
    tooling_files = {name: file_hash(tooling / name) for name in ('mac_release.py', 'runtime_launcher.py', 'phone_secrets.py', 'macos-secrets.py')}
    destination = owned_path(destination)
    if destination.exists() or destination.is_relative_to(Path(directory)):
        raise Refusal('Package destination must be a new directory outside the preparation')
    destination.mkdir(mode=0o700)
    shutil.copytree(source / '.next/standalone', destination, dirs_exist_ok=True, symlinks=True)
    shutil.copytree(source / '.next/static', destination / '.next/static', dirs_exist_ok=True, symlinks=True)
    shutil.copytree(source / 'public', destination / 'public', dirs_exist_ok=True, symlinks=True)
    shutil.rmtree(destination / '.next/cache', ignore_errors=True)
    (destination / 'deploy').mkdir()
    for name in tooling_files:
        shutil.copy2(tooling / name, destination / 'deploy' / name)
        if file_hash(destination / 'deploy' / name) != tooling_files[name]:
            raise Refusal('Deployment tooling changed during packaging')
    retained_ids = []
    if retained:
        old = verify_release(retained)
        retained_ids.append(old['buildId'])
        for relative, identity in old['files'].items():
            if not (relative.startswith('.next/static/') or relative.startswith('public/fonts/reader/') or relative.startswith('public/vendor/pdfjs/')):
                continue
            old_file, new_file = Path(retained) / relative, destination / relative
            if new_file.exists():
                if identity != snapshot_entry(new_file):
                    raise Refusal('Cached asset collision: version filenames before packaging')
            else:
                new_file.parent.mkdir(parents=True, exist_ok=True)
                if old_file.is_symlink():
                    raise Refusal('Retained cached assets must be regular files')
                shutil.copy2(old_file, new_file)
    manifest = {key: state[key] for key in ('commit', 'tree', 'node', 'lockSha256', 'publicInputsSha256', 'buildId')}
    manifest.update(version=1, buildId=proof.get('buildId', state['buildId']), healthHasBuildIdentity=False, deploymentToolFiles=tooling_files, migrations=migrations(source), retainedBuildIds=retained_ids,
                    files=snapshot(destination, mutable_cache=True))
    manifest['artifactSha256'] = digest(canonical(manifest))
    private_json(destination / MANIFEST, manifest)
    verify_release(destination)
    return manifest


def snapshot_entry(path):
    return {'sha256': file_hash(path), 'bytes': path.stat().st_size}


def verify_release(directory):
    directory = owned_path(directory)
    manifest = read_json(directory / MANIFEST)
    packet = {k: v for k, v in manifest.items() if k != 'artifactSha256'}
    if (directory / MANIFEST).stat().st_mode & 0o077:
        raise Refusal('Release manifest must be private to its owner')
    if manifest.get('version') != 1 or digest(canonical(packet)) != manifest.get('artifactSha256'):
        raise Refusal('Release manifest identity changed')
    if not SHA.fullmatch(manifest.get('commit', '')) or not SHA.fullmatch(manifest.get('tree', '')) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', manifest.get('buildId', '')):
        raise Refusal('Release source/build identity invalid')
    if snapshot(directory, mutable_cache=True) != manifest['files']:
        raise Refusal('Release artifact differs from its manifest')
    if (directory / '.next/BUILD_ID').read_text().strip() != manifest['buildId'] or not (directory / 'server.js').is_file():
        raise Refusal('Standalone server or baked build ID invalid')
    entries = manifest['migrations']['entries']
    if digest(canonical(entries)) != manifest['migrations']['sha256']:
        raise Refusal('Migration manifest identity invalid')
    return manifest


def checked_config(config):
    expected = {'version', 'account', 'node', 'python', 'release', 'helper', 'aws', 'secretSource', 'port', 'runtimeNames', 'environment', 'logDirectory', 'cdn'}
    if not isinstance(config, dict) or set(config) - expected or config.get('version') != 1 or config.get('account') != ACCOUNT:
        raise Refusal('Runtime config version/account/field is not approved')
    if isinstance(config.get('port'), bool) or not isinstance(config.get('port'), int) or not 1024 <= config['port'] <= 65535 or config['port'] == 3100:
        raise Refusal('Use an explicit unused unprivileged port, never owner development port 3100')
    names = config.get('runtimeNames', [])
    if not isinstance(names, list) or any(not isinstance(n, str) for n in names) or len(set(names)) != len(names) or not REQUIRED_NAMES.issubset(names) or not set(names).issubset(SECRET_NAMES):
        raise Refusal('Runtime secret names must be a unique approved allowlist including the app IAM pair and database')
    env = config.get('environment', {})
    if not isinstance(env, dict) or not set(env).issubset(PUBLIC_RUNTIME_NAMES) or any(not isinstance(v, str) for v in env.values()):
        raise Refusal('Runtime config accepts public settings only; no secret/public-build inputs')
    if env.get('AWS_REGION') != 'eu-north-1' or env.get('S3_BUCKET') != 'durtal' or env.get('EBOOKS_REGION') != 'eu-north-1' or env.get('EBOOKS_BUCKET') != 'durtal':
        raise Refusal('Runtime storage must be the approved personal bucket and region')
    if env.get('EBOOK_DELIVERY') != 'app':
        raise Refusal('Explicit delivery mode is required')
    cdn = config.get('cdn')
    if env['EBOOK_DELIVERY'] == 'cloudfront':
        if not isinstance(cdn, dict) or set(cdn) != {'fingerprint', 'publicKeyPem'} or not HASH.fullmatch(cdn.get('fingerprint', '')) or digest(cdn['publicKeyPem'].encode()) != cdn['fingerprint']:
            raise Refusal('CloudFront signing public identity is required')
        if not re.fullmatch(r'https://[a-z0-9]+\.cloudfront\.net', env.get('EBOOK_CDN_URL', '')) or not re.fullmatch(r'[A-Z0-9]+', env.get('EBOOK_CDN_KEY_PAIR_ID', '')):
            raise Refusal('Owned CloudFront URL/key ID required')
    elif cdn or env.get('EBOOK_CDN_URL') or env.get('EBOOK_CDN_KEY_PAIR_ID'):
        raise Refusal('App mode cannot silently carry CDN settings')
    if config.get('secretSource') != str(Path.home() / 'personal/durtal/.env.local'):
        raise Refusal('Only the existing owner app environment source is permitted')
    for field in ('node', 'python', 'helper', 'aws'):
        item = config.get(field)
        if not isinstance(item, dict) or set(item) != {'path', 'sha256'} or not Path(item['path']).is_absolute() or not HASH.fullmatch(item['sha256']):
            raise Refusal('Absolute hash-pinned runtime paths required')
    for field in ('release', 'logDirectory'):
        owned_path(config[field])
    if Path(config['logDirectory']).is_relative_to(Path(config['release'])):
        raise Refusal('Runtime logs must be outside the attested release')
    return config


def launchd_plan(config_path, output):
    config_path = owned_path(config_path)
    if config_path.stat().st_mode & 0o077:
        raise Refusal('Runtime configuration must be private to its owner')
    config = checked_config(read_json(config_path))
    release = verify_release(config['release'])
    node_identity(config['node']['path'], config['node']['sha256'])
    if config['node'] != {k: release['node'][k] for k in ('path', 'sha256')}:
        raise Refusal('Launch must use the exact build Node executable')
    python = executable(config['python']['path'], config['python']['sha256'])
    if file_hash(config['helper']['path']) != config['helper']['sha256']:
        raise Refusal('Shared SLN-491 helper hash changed')
    if Path(config['helper']['path']) != Path(config['release']) / 'deploy/phone_secrets.py':
        raise Refusal('Launch plan must use the packaged shared helper')
    launcher = Path(config['release']) / 'deploy/runtime_launcher.py'
    # KeepAlive=false is intentional: a missing/locked Keychain or invalid
    # identity exits once. Runtime crashes are restarted by the bounded launcher.
    plist = {'Label': 'com.durtal.production', 'ProgramArguments': [python['path'], str(launcher), '--config', str(config_path), '--config-sha256', file_hash(config_path)],
             'WorkingDirectory': config['release'], 'RunAtLoad': True, 'KeepAlive': False, 'ThrottleInterval': 30,
             'ExitTimeOut': 30, 'Umask': 63, 'ProcessType': 'Background', 'EnvironmentVariables': {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1'}}
    output = owned_path(output)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        plistlib.dump(plist, f)
    return {'installed': False, 'configSha256': file_hash(config_path), 'plistSha256': file_hash(output), 'artifactSha256': release['artifactSha256']}


def transition_plan(current_dir, target_dir, compatibility=None, live_migrations=None):
    """Never infer backwards SQL compatibility or service-worker safety."""
    current, target = verify_release(current_dir), verify_release(target_dir)
    if current['buildId'] not in target['retainedBuildIds'] and current['buildId'] != target['buildId']:
        raise Refusal('Target does not retain currently served cached assets')
    for relative, identity in current['files'].items():
        if relative.startswith(('.next/static/', 'public/fonts/reader/', 'public/vendor/pdfjs/')) and target['files'].get(relative) != identity:
            raise Refusal('Target cached assets differ from the currently served release')
    # A running release's migration list is historical build provenance. The live
    # database may already contain separately reviewed forward migrations.
    if (not isinstance(live_migrations, dict) or set(live_migrations) != {'version', 'migrationSha256', 'evidenceSha256'}
            or live_migrations.get('version') != 1
            or any(not isinstance(live_migrations.get(key), str) or not HASH.fullmatch(live_migrations[key])
                   for key in ('migrationSha256', 'evidenceSha256'))):
        raise Refusal('Separate reviewed live migration evidence required for transition attestation')
    expected = {'fromArtifact': current['artifactSha256'], 'toArtifact': target['artifactSha256'],
                'liveMigrationSha256': live_migrations['migrationSha256'],
                'liveMigrationEvidenceSha256': digest(canonical(live_migrations)),
                'schemaCompatible': True, 'serviceWorkerCompatible': True}
    # Even identical migration lists do not prove an old SW/client can switch.
    if compatibility != expected:
        raise Refusal('Exact reviewed schema and service-worker compatibility attestation required')
    return {**expected, 'operation': 'switch-review-only', 'planSha256': digest(canonical(expected)),
            'mutations': False, 'migrate': False, 'restoreDatabase': False, 'resetTailscale': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='mode', required=True)
    p = subs.add_parser('prepare')
    for name in ('repo', 'commit', 'destination', 'node', 'pnpm', 'public-inputs'):
        p.add_argument('--' + name, required=True)
    p = subs.add_parser('build'); p.add_argument('--directory', required=True); p.add_argument('--allow-build', action='store_true')
    p = subs.add_parser('package'); p.add_argument('--directory', required=True); p.add_argument('--destination', required=True); p.add_argument('--retain')
    p = subs.add_parser('verify'); p.add_argument('--release', required=True)
    p = subs.add_parser('launchd-plan'); p.add_argument('--config', required=True); p.add_argument('--output', required=True)
    p = subs.add_parser('transition-plan'); p.add_argument('--current', required=True); p.add_argument('--target', required=True); p.add_argument('--compatibility', required=True); p.add_argument('--live-migrations', required=True)
    args = parser.parse_args()
    if args.mode == 'prepare':
        result = prepare(args.repo, args.commit, args.destination, args.node, args.pnpm, read_json(args.public_inputs))
        result = {k: result[k] for k in ('commit', 'tree', 'buildId', 'lockSha256', 'publicInputsSha256')}
    elif args.mode == 'build': result = build(args.directory, args.allow_build)
    elif args.mode == 'package':
        result = package(args.directory, args.destination, args.retain)
        result = {k: result[k] for k in ('commit', 'buildId', 'artifactSha256')}
    elif args.mode == 'verify':
        result = verify_release(args.release)
        result = {k: result[k] for k in ('commit', 'buildId', 'artifactSha256')}
    elif args.mode == 'launchd-plan': result = launchd_plan(args.config, args.output)
    else: result = transition_plan(args.current, args.target, read_json(args.compatibility), read_json(args.live_migrations))
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, Refusal) else 'Release operation failed; details withheld', file=__import__('sys').stderr)
        raise SystemExit(1)
