#!/usr/bin/env python3
"""Pure deployment tests: isolated fixtures only, no build/Keychain/AWS/server."""
import base64
import io
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy'
sys.path.insert(0, str(DEPLOY))
import mac_release as release
import runtime_launcher as launcher

COMMIT, TREE = 'a' * 40, 'b' * 40
NEXT_ENV_DEV = b'/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/dev/types/routes.d.ts";\n\n// NOTE: This file should not be edited\n'
NEXT_ENV_PRODUCTION = NEXT_ENV_DEV.replace(b'./.next/dev/types/', b'./.next/types/')
GENERATED_PUBLIC_FILES = ('public/icons/durtal-192.png', 'public/icons/durtal-512.png',
                          'public/icons/durtal-maskable-512.png', 'public/offline-assets.json')


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/private/tmp' if sys.platform == 'darwin' else '/tmp')
        self.root = Path(self.temp.name)
        self.node = {'path': '/absolute/node22', 'sha256': 'c' * 64, 'version': 'v22.20.0'}

    def tearDown(self):
        self.temp.cleanup()

    def make_release(self, name='one', commit=COMMIT, retained=None, journal=None):
        root = self.root / name
        (root / '.next/static').mkdir(parents=True)
        (root / 'public/fonts/reader').mkdir(parents=True)
        (root / 'deploy').mkdir()
        (root / 'server.js').write_text('server')
        (root / '.next/BUILD_ID').write_text(commit)
        (root / '.next/static' / (commit + '.js')).write_text(commit)
        (root / 'public/fonts/reader/font.woff2').write_bytes(b'font')
        for file in ('mac_release.py', 'runtime_launcher.py', 'phone_secrets.py', 'macos-secrets.py'):
            (root / 'deploy' / file).write_text('# test source')
        manifest = {'version': 1, 'commit': commit, 'tree': TREE, 'buildId': commit,
                    'deploymentToolFiles': {p.name: release.file_hash(p) for p in (root / 'deploy').iterdir()},
                    'node': self.node, 'lockSha256': 'd' * 64, 'publicInputsSha256': 'e' * 64,
                    'migrations': {'entries': journal or [], 'sha256': release.digest(release.canonical(journal or []))},
                    'retainedBuildIds': retained or [], 'files': release.snapshot(root, mutable_cache=True)}
        manifest['artifactSha256'] = release.digest(release.canonical(manifest))
        release.private_json(root / release.MANIFEST, manifest)
        return root, manifest

    def config(self, root):
        return {'version': 1, 'account': release.ACCOUNT, 'node': {k: self.node[k] for k in ('path', 'sha256')},
                'python': {'path': '/absolute/python', 'sha256': 'f' * 64}, 'release': str(root),
                'helper': {'path': str(root / 'deploy/phone_secrets.py'), 'sha256': release.file_hash(root / 'deploy/phone_secrets.py')},
                'aws': {'path': '/absolute/aws', 'sha256': 'a' * 64}, 'secretSource': str(Path.home() / 'personal/durtal/.env.local'), 'port': 3110, 'runtimeNames': sorted(release.REQUIRED_NAMES),
                'environment': {'AWS_REGION': 'eu-north-1', 'S3_BUCKET': 'durtal', 'EBOOKS_REGION': 'eu-north-1', 'EBOOKS_BUCKET': 'durtal', 'EBOOK_DELIVERY': 'app'},
                'logDirectory': str(self.root / 'logs'), 'cdn': None}

    def test_build_environment_has_no_ambient_secret_or_node_options(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'private', 'AWS_PROFILE': 'work', 'NODE_OPTIONS': '--import evil', 'HTTP_PROXY': 'private'}):
            env = release.clean_environment({'NEXT_PUBLIC_MAPBOX_TOKEN': 'public'})
        self.assertFalse(set(('DATABASE_URL', 'AWS_PROFILE', 'NODE_OPTIONS', 'HTTP_PROXY')) & set(env))
        self.assertEqual(env['NEXT_PUBLIC_MAPBOX_TOKEN'], 'public')
        with self.assertRaises(release.Refusal):
            release.clean_environment({'EBOOK_CDN_PRIVATE_KEY': 'secret'})

    def test_node_22_and_pinned_executable_required(self):
        path = self.root / 'node'
        path.write_text('executable'); path.chmod(0o700)
        with patch.object(release, 'run', return_value=b'v26.9.0\n'):
            with self.assertRaisesRegex(release.Refusal, 'Node 22'):
                release.node_identity(str(path))
        with self.assertRaisesRegex(release.Refusal, 'hash changed'):
            release.executable(str(path), '0' * 64)

    def test_build_never_runs_without_explicit_heavy_gate(self):
        with patch.object(release, 'run') as run:
            with self.assertRaisesRegex(release.Refusal, 'allow-build'):
                release.build(self.root)
            run.assert_not_called()

    def test_preparation_rejects_changed_source_and_public_inputs(self):
        directory = self.root / 'prepare'
        source = directory / 'source'; source.mkdir(parents=True)
        (source / 'pnpm-lock.yaml').write_text('lock')
        (source / 'app.ts').write_text('reviewed')
        state = {'node': self.node, 'pnpm': {'path': '/absolute/pnpm', 'sha256': 'f' * 64},
                 'sourceFiles': release.snapshot_source(source), 'lockSha256': release.file_hash(source / 'pnpm-lock.yaml'),
                 'publicInputsSha256': release.digest(release.canonical({}))}
        release.private_json(directory / 'preparation.json', state)
        release.private_json(directory / 'public-build-inputs.json', {})
        with patch.object(release, 'node_identity'), patch.object(release, 'executable'):
            release.verify_preparation(directory)
            (source / 'app.ts').write_text('owner dirty changes')
            with self.assertRaisesRegex(release.Refusal, 'source changed'):
                release.verify_preparation(directory)
        (directory / 'public-build-inputs.json').write_text('{"NEXT_PUBLIC_MAPBOX_TOKEN":"changed"}')
        with self.assertRaisesRegex(release.Refusal, 'inputs changed'):
            release.verify_preparation(directory)

    def test_fresh_dependency_gate_precedes_install(self):
        source = self.root / 'source'; source.mkdir(); (source / 'node_modules').mkdir()
        with patch.object(release, 'verify_preparation', return_value=({}, source, {})), patch.object(release, 'run') as run:
            with self.assertRaisesRegex(release.Refusal, 'fresh dependencies'):
                release.build(self.root, allow=True)
            run.assert_not_called()

    def test_release_tampering_and_unknown_files_are_detected(self):
        root, manifest = self.make_release()
        self.assertEqual(release.verify_release(root)['artifactSha256'], manifest['artifactSha256'])
        (root / 'server.js').write_text('tampered')
        with self.assertRaisesRegex(release.Refusal, 'differs'):
            release.verify_release(root)
        (root / 'server.js').write_text('server')
        (root / 'untracked.js').write_text('unexpected')
        with self.assertRaisesRegex(release.Refusal, 'differs'):
            release.verify_release(root)

    def test_mutable_next_cache_does_not_relabel_release(self):
        root, manifest = self.make_release()
        (root / '.next/cache').mkdir()
        (root / '.next/cache/data').write_text('runtime data')
        self.assertEqual(release.verify_release(root)['artifactSha256'], manifest['artifactSha256'])

    def test_secret_files_and_escaping_symlinks_are_refused(self):
        root, _ = self.make_release()
        (root / '.env.local').write_text('SECRET=private')
        with self.assertRaisesRegex(release.Refusal, 'secret file'):
            release.verify_release(root)
        (root / '.env.local').unlink()
        (root / 'escape').symlink_to('/tmp')
        with self.assertRaisesRegex(release.Refusal, 'symlink'):
            release.verify_release(root)

    def test_configuration_refuses_secrets_wrong_account_live_dev_port_and_public_build_inputs(self):
        root, _ = self.make_release(); config = self.config(root)
        release.checked_config(config)
        for mutation in ({'account': '000000000000'}, {'port': 3100}, {'port': True},
                         {'environment': {**config['environment'], 'DATABASE_URL': 'private'}},
                         {'environment': {**config['environment'], 'NEXT_PUBLIC_MAPBOX_TOKEN': 'public'}},
                         {'runtimeNames': [*config['runtimeNames'], 'AWS_SESSION_TOKEN']}, {'unknown': 'private'}):
            with self.assertRaises(release.Refusal):
                release.checked_config({**config, **mutation})

    def test_configuration_accepts_only_an_upload_bridge_path(self):
        root, _ = self.make_release(); config = self.config(root)
        bridge = str(Path.home() / '.durtal/ebook-upload/bridge.json')
        release.checked_config({**config, 'environment': {**config['environment'], 'EBOOK_UPLOAD_BRIDGE': bridge}})
        for value in ('bridge.json', str(Path.home() / '.durtal/ebook-upload/service.json'), str(Path.home() / '.durtal/../x/bridge.json')):
            with self.assertRaises(release.Refusal):
                release.checked_config({**config, 'environment': {**config['environment'], 'EBOOK_UPLOAD_BRIDGE': value}})

    def test_natural_voice_key_is_a_runtime_secret_and_its_voice_and_model_public(self):
        root, _ = self.make_release(); config = self.config(root)
        release.checked_config({**config, 'runtimeNames': [*config['runtimeNames'], 'ELEVENLABS_API_KEY'],
                                'environment': {**config['environment'], 'ELEVENLABS_VOICE_ID': 'JBFqnCBsd6RMkjVDRZzb',
                                                'ELEVENLABS_MODEL_ID': 'eleven_multilingual_v2'}})
        with self.assertRaises(release.Refusal):
            release.checked_config({**config, 'environment': {**config['environment'], 'ELEVENLABS_API_KEY': 'private'}})

    def test_allowed_hosts_is_a_public_runtime_setting(self):
        root, _ = self.make_release(); config = self.config(root)
        release.checked_config({**config, 'environment': {**config['environment'], 'DURTAL_ALLOWED_HOSTS': 'durtal.example.com'}})
        with self.assertRaises(release.Refusal):
            release.checked_config({**config, 'runtimeNames': [*config['runtimeNames'], 'DURTAL_ALLOWED_HOSTS']})

    def test_cloudfront_requires_reviewed_public_identity(self):
        root, _ = self.make_release(); config = self.config(root)
        config['environment']['EBOOK_DELIVERY'] = 'cloudfront'
        with self.assertRaises(release.Refusal): release.checked_config(config)

    def cloudfront_config(self, root):
        config = self.config(root)
        public = '-----BEGIN PUBLIC KEY-----\nPUBLIC-ONLY-FIXTURE\n-----END PUBLIC KEY-----\n'
        config['environment'].update(EBOOK_DELIVERY='cloudfront',
                                     EBOOK_CDN_URL='https://d23cymsihkm67a.cloudfront.net',
                                     EBOOK_CDN_KEY_PAIR_ID='KA44DGPUW76EM')
        config['cdn'] = {'publicKeyPem': public, 'fingerprint': release.digest(public.encode())}
        return config

    def signing_store(self, config, raw=b'PRIVATE-FIXTURE-NOT-A-REAL-KEY', error=None):
        calls, closes = [], []
        class Store:
            def get(self, service, account):
                calls.append((service, account))
                if error: raise error
                return raw
            def close(self): closes.append(True)
        store = Store()
        options = []
        def factory(**kwargs):
            options.append(kwargs)
            return store
        return SimpleNamespace(Keychain=factory), calls, closes, options

    def test_cloudfront_public_config_has_no_private_key_or_ambient_credentials(self):
        root, _ = self.make_release(); config = self.cloudfront_config(root)
        self.assertIs(release.checked_config(config), config)
        for field, value in [('fingerprint', '0' * 64), ('fingerprint', None),
                             ('publicKeyPem', None), ('publicKeyPem', 'x' * 8193)]:
            altered = {**config, 'cdn': {**config['cdn'], field: value}}
            with self.subTest(field=field, value_type=type(value).__name__):
                with self.assertRaises(release.Refusal): release.checked_config(altered)
        for location in ('environment', 'runtimeNames'):
            altered = {**config, location: ({**config[location], 'EBOOK_CDN_PRIVATE_KEY': 'private'}
                       if location == 'environment' else [*config[location], 'EBOOK_CDN_PRIVATE_KEY'])}
            with self.assertRaises(release.Refusal): release.checked_config(altered)
        app = self.config(root); app['cdn'] = config['cdn']
        with self.assertRaises(release.Refusal): release.checked_config(app)

    def test_signing_reads_exact_item_closes_store_and_uses_only_stdin(self):
        root, _ = self.make_release(); config = self.cloudfront_config(root)
        raw = b'PRIVATE-FIXTURE-NOT-A-REAL-KEY'
        module, calls, closes, options = self.signing_store(config, raw)
        invoked = []
        def run(args, **kwargs):
            invoked.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout=config['cdn']['fingerprint'].encode(), stderr=b'')
        with patch.object(launcher, 'load_signing_helper', return_value=module), \
             patch.dict(os.environ, {'AWS_PROFILE': 'work', 'HTTP_PROXY': 'private', 'NODE_OPTIONS': 'bad'}):
            self.assertEqual(launcher.load_signing_key(config, run), raw)
        self.assertEqual(options, [{'runtime_names': (), 'budget': False, 'signing': True}])
        self.assertEqual(calls, [(launcher.SIGNING_SERVICE, release.ACCOUNT + ':' + config['cdn']['fingerprint'])])
        self.assertEqual(closes, [True])
        args, kwargs = invoked[0]
        self.assertEqual(args, [config['node']['path'], '-e', launcher.SIGNING_PUBLIC_IDENTITY])
        self.assertEqual(kwargs['input'], raw); self.assertEqual(kwargs['timeout'], 15)
        self.assertNotIn(raw.decode(), str(args)); self.assertNotIn(raw.decode(), str(kwargs['env']))
        self.assertFalse({'AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'HTTP_PROXY', 'NODE_OPTIONS'} & kwargs['env'].keys())

    def test_signing_keychain_missing_locked_invalid_data_fails_closed(self):
        root, _ = self.make_release(); config = self.cloudfront_config(root)
        cases = [(None, None), (b'', None), (b'x' * 65537, None), (b'a\x00b', None),
                 (b'\xff', None), ('not bytes', None), (b'key', RuntimeError('SECRET-PROVIDER-DETAIL'))]
        for raw, error in cases:
            module, calls, closes, _ = self.signing_store(config, raw, error)
            with self.subTest(kind=type(raw).__name__, length=len(raw) if raw is not None else None), \
                 patch.object(launcher, 'load_signing_helper', return_value=module), \
                 patch.object(launcher, 'bounded_run') as run:
                with self.assertRaises(release.Refusal) as rejected:
                    launcher.load_signing_key(config, run)
                self.assertNotIn('SECRET-PROVIDER-DETAIL', str(rejected.exception))
                run.assert_not_called(); self.assertEqual(closes, [True])

    def test_signing_crypto_failure_wrong_identity_or_timeout_is_sanitized(self):
        root, _ = self.make_release(); config = self.cloudfront_config(root)
        cases = [SimpleNamespace(returncode=2, stdout=b'PRIVATE-FIXTURE', stderr=b'PRIVATE-FIXTURE'),
                 SimpleNamespace(returncode=0, stdout=b'0' * 64, stderr=b''),
                 SimpleNamespace(returncode=0, stdout=config['cdn']['fingerprint'].encode(), stderr=b'PRIVATE-FIXTURE'),
                 subprocess.TimeoutExpired('node', 15, output=b'PRIVATE-FIXTURE', stderr=b'PRIVATE-FIXTURE')]
        for result in cases:
            module, _, closes, _ = self.signing_store(config)
            def run(*args, **kwargs):
                if isinstance(result, Exception): raise result
                return result
            with self.subTest(result_type=type(result).__name__), patch.object(launcher, 'load_signing_helper', return_value=module):
                with self.assertRaises(release.Refusal) as rejected: launcher.load_signing_key(config, run)
                self.assertNotIn('PRIVATE-FIXTURE', str(rejected.exception)); self.assertEqual(closes, [True])
        with patch.object(launcher, 'load_signing_helper') as loader:
            with self.assertRaises(release.Refusal): launcher.load_signing_key({**config, 'account': '000000000000'})
            loader.assert_not_called()

    def test_app_mode_never_loads_signing_keychain(self):
        root, _ = self.make_release(); config = self.config(root)
        helper = SimpleNamespace(runtime_environment=lambda *args: {name: 'ordinary-fixture' for name in release.REQUIRED_NAMES})
        with patch.object(launcher, 'load_signing_helper') as signing:
            env, redactions = launcher.load_environment(config, helper)
            signing.assert_not_called()
        self.assertNotIn('EBOOK_CDN_PRIVATE_KEY', env); self.assertNotIn('signing-pem', redactions)

    def test_signing_is_in_memory_child_env_and_log_redactions_only(self):
        root, _ = self.make_release(); config = self.cloudfront_config(root)
        raw = b'-----BEGIN PRIVATE KEY-----\nPRIVATE-FIXTURE-LINE\n-----END PRIVATE KEY-----\n'
        helper = SimpleNamespace(runtime_environment=lambda *args: {name: 'ordinary-fixture' for name in release.REQUIRED_NAMES})
        with patch.object(launcher, 'load_signing_key', return_value=raw) as signing:
            env, redactions = launcher.load_environment(config, helper)
            signing.assert_called_once()
        self.assertEqual(base64.b64decode(env['EBOOK_CDN_PRIVATE_KEY']), raw)
        log = launcher.BoundedLog(self.root / 'signing-logs', redactions)
        log.consume(io.BytesIO(raw + env['EBOOK_CDN_PRIVATE_KEY'].encode() + b'\nPRIVATE-FIXTURE-LINE\n'))
        output = log.path.read_bytes()
        self.assertNotIn(b'PRIVATE-FIXTURE-LINE', output)
        self.assertNotIn(env['EBOOK_CDN_PRIVATE_KEY'].encode(), output)
        self.assertNotIn('EBOOK_CDN_PRIVATE_KEY', config['environment'])
        self.assertNotIn(raw.decode(), json.dumps(config))

    def test_signing_helper_tampering_is_rejected_before_import(self):
        root, _ = self.make_release(); config = self.cloudfront_config(root)
        (root / 'deploy/macos-secrets.py').write_text('tampered')
        with patch.object(launcher.importlib.util, 'spec_from_file_location') as importer:
            with self.assertRaises(release.Refusal): launcher.load_signing_helper(config)
            importer.assert_not_called()

    def test_cloudfront_launchd_plan_contains_only_public_configuration_references(self):
        root, _ = self.make_release(); config = self.cloudfront_config(root)
        path = self.root / 'cloudfront.json'; release.private_json(path, config)
        output = self.root / 'cloudfront.plist'
        with patch.object(release, 'node_identity', return_value=self.node), \
             patch.object(release, 'executable', return_value=config['python']), \
             patch.object(launcher, 'load_signing_helper') as signing:
            result = release.launchd_plan(path, output)
            signing.assert_not_called()
        plist = plistlib.loads(output.read_bytes())
        self.assertFalse(result['installed']); self.assertFalse(plist['KeepAlive'])
        self.assertNotIn('EBOOK_CDN_PRIVATE_KEY', str(plist)); self.assertNotIn('signing-pem', str(plist))
        self.assertEqual(plist['ProgramArguments'][-2:], ['--config-sha256', release.file_hash(path)])

    def test_failed_signing_preflight_never_spawns_or_retries_server(self):
        root, manifest = self.make_release(); config = self.cloudfront_config(root)
        config['python']['path'] = str(Path(sys.executable).resolve())
        path = self.root / 'launch.json'; release.private_json(path, config)
        with patch.object(launcher, 'verify_release', return_value=manifest), \
             patch.object(launcher, 'node_identity', return_value=self.node), \
             patch.object(launcher, 'executable', return_value=config['python']), \
             patch.object(launcher, 'load_helper'), \
             patch.object(launcher, 'load_environment', side_effect=release.Refusal('Signing unavailable')) as preflight, \
             patch.object(launcher.subprocess, 'Popen') as spawn:
            with self.assertRaises(release.Refusal): launcher.launch(path, release.file_hash(path))
            preflight.assert_called_once(); spawn.assert_not_called()

    def test_crash_restarts_reuse_verified_env_without_keychain_reread(self):
        root, manifest = self.make_release(); config = self.cloudfront_config(root)
        config['python']['path'] = str(Path(sys.executable).resolve())
        path = self.root / 'restart.json'; release.private_json(path, config)
        event = MagicMock(); event.is_set.return_value = False; event.wait.return_value = False
        children = []
        for _ in range(3):
            child = MagicMock(); child.poll.side_effect = [None, 0, 0]; children.append(child)
        env = {'EBOOK_CDN_PRIVATE_KEY': 'PRIVATE-FIXTURE', 'PORT': str(config['port'])}
        with patch.object(launcher, 'verify_release', return_value=manifest), \
             patch.object(launcher, 'node_identity', return_value=self.node), \
             patch.object(launcher, 'executable', return_value=config['python']), \
             patch.object(launcher, 'load_helper'), \
             patch.object(launcher, 'load_environment', return_value=(env, {})) as preflight, \
             patch.object(launcher, 'BoundedLog'), patch.object(launcher, 'unused_port'), \
             patch.object(launcher, 'probe_health', return_value=True), \
             patch.object(launcher.signal, 'signal'), \
             patch.object(launcher.threading, 'Event', return_value=event), \
             patch.object(launcher.threading, 'Thread'), \
             patch.object(launcher.subprocess, 'Popen', side_effect=children) as spawn:
            launcher.launch(path, release.file_hash(path))
        preflight.assert_called_once(); self.assertEqual(spawn.call_count, 3)
        for call in spawn.call_args_list:
            self.assertIs(call.kwargs['env'], env)
            self.assertEqual(call.args[0], [config['node']['path'], 'server.js'])
            self.assertNotIn('PRIVATE-FIXTURE', str(call.args))
        for child in children: child.stdout.close.assert_called_once()

    def test_rewrapped_rsa2048_short_pem_lines_redact_across_fragmented_reads(self):
        # Synthetic fixture generated only when root runs this test. The
        # rewrapped accepted private key stays in memory; no owner item read.
        node = shutil.which('node'); self.assertIsNotNone(node, 'Existing Node22 is required')
        script = r'''const c=require('node:crypto');
const {privateKey,publicKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});
const publicPem=publicKey.export({type:'spki',format:'pem'});
process.stdout.write(JSON.stringify({privatePem:privateKey.export({type:'pkcs8',format:'pem'}),
 publicPem,fingerprint:c.createHash('sha256').update(publicPem).digest('hex')}));'''
        result = subprocess.run([node, '-e', script], capture_output=True, timeout=15, env=release.clean_environment())
        self.assertEqual(result.returncode, 0, 'Synthetic crypto fixture creation failed; output withheld')
        pair = json.loads(result.stdout)
        lines = pair['privatePem'].strip().splitlines()
        body = ''.join(lines[1:-1])
        short_lines = [body[i:i + 4] for i in range(0, len(body), 4)]
        raw = ('\n'.join([lines[0], *short_lines, lines[-1]]) + '\n').encode()
        root, _ = self.make_release(); config = self.cloudfront_config(root); config['node']['path'] = node
        config['cdn'] = {'publicKeyPem': pair['publicPem'], 'fingerprint': pair['fingerprint']}
        config['runtimeNames'].append('ADMIN_TOKEN')
        release.checked_config(config)
        module, calls, closes, _ = self.signing_store(config, raw)
        ordinary = {name: 'ordinary-fixture' for name in release.REQUIRED_NAMES}
        ordinary['ADMIN_TOKEN'] = 'ordinary-long-prefix\nabc\nordinary-long-suffix'
        helper = SimpleNamespace(runtime_environment=lambda *args: ordinary)
        with patch.object(launcher, 'load_signing_helper', return_value=module):
            env, redactions = launcher.load_environment(config, helper)
        self.assertEqual(base64.b64decode(env['EBOOK_CDN_PRIVATE_KEY']), raw)
        self.assertEqual(len(calls), 1); self.assertEqual(closes, [True])
        log = launcher.BoundedLog(self.root / 'rewrapped-signing-logs', redactions)
        self.assertTrue(all(line in log.secrets for line in short_lines))
        self.assertNotIn('abc', log.secrets)  # Ordinary multiline policy unchanged.
        class Fragmented(io.BytesIO):
            def __init__(self, value):
                super().__init__(value); self.turn = 0
            def read(self, size=-1):
                self.turn += 1
                return super().read(min(size, (1, 3, 2, 5)[self.turn % 4]))
        payload = raw + env['EBOOK_CDN_PRIVATE_KEY'].encode() + b'\n' + short_lines[0].encode() + b'\n'
        log.consume(Fragmented(payload))
        # Every input line was signing material. Check whole output lines so
        # random Base64 substrings cannot coincidentally match redaction text.
        output = log.path.read_bytes()
        emitted = output.splitlines()
        self.assertTrue(emitted)
        self.assertTrue(all(line.startswith(b'[') and line.endswith(b']') for line in emitted))
        self.assertFalse(set(emitted) & {line.encode() for line in short_lines})
        self.assertNotIn(env['EBOOK_CDN_PRIVATE_KEY'].encode(), output)

    def test_real_node_crypto_accepts_matching_rsa2048_only(self):
        # Isolated synthetic pairs stay in memory. No owner Keychain/source,
        # credentials, AWS, network, server, key files or installed dependency.
        node = shutil.which('node'); self.assertIsNotNone(node, 'Existing Node22 is required')
        script = r'''const c=require('node:crypto');
const out=[];
for(const [type,options] of [['rsa',{modulusLength:2048}],['rsa',{modulusLength:1024}],['ec',{namedCurve:'prime256v1'}]]) {
 const {privateKey,publicKey}=c.generateKeyPairSync(type,options);
 const publicPem=publicKey.export({type:'spki',format:'pem'});
 out.push({privatePem:privateKey.export({type:'pkcs8',format:'pem'}),publicPem,
  fingerprint:c.createHash('sha256').update(publicPem).digest('hex')});
} process.stdout.write(JSON.stringify(out));'''
        result = subprocess.run([node, '-e', script], capture_output=True, timeout=15, env=release.clean_environment())
        self.assertEqual(result.returncode, 0, 'Synthetic crypto fixture creation failed; output withheld')
        pairs = json.loads(result.stdout)
        root, _ = self.make_release(); config = self.cloudfront_config(root); config['node']['path'] = node
        for index, pair in enumerate(pairs):
            config['cdn'] = {'fingerprint': pair['fingerprint'], 'publicKeyPem': pair['publicPem']}
            raw = pair['privatePem'].encode()
            module, _, _, _ = self.signing_store(config, raw)
            with patch.object(launcher, 'load_signing_helper', return_value=module):
                if index == 0:
                    self.assertEqual(launcher.load_signing_key(config), raw)
                    config['cdn']['fingerprint'] = '0' * 64
                    with self.assertRaises(release.Refusal): launcher.load_signing_key(config)
                else:
                    with self.assertRaises(release.Refusal): launcher.load_signing_key(config)
        module, _, _, _ = self.signing_store(config, b'not a private key')
        with patch.object(launcher, 'load_signing_helper', return_value=module):
            with self.assertRaises(release.Refusal): launcher.load_signing_key(config)

    def retain_current_assets(self, current, one, target, two):
        (target / release.MANIFEST).unlink()
        two['retainedBuildIds'] = [one['buildId']]
        for relative in one['files']:
            if relative.startswith('.next/static/'):
                (target / relative).write_bytes((current / relative).read_bytes())
        two['files'] = release.snapshot(target, mutable_cache=True)
        two.pop('artifactSha256'); two['artifactSha256'] = release.digest(release.canonical(two))
        release.private_json(target / release.MANIFEST, two)

    def live_evidence(self, migration_hash):
        return {'version': 1, 'migrationSha256': migration_hash, 'evidenceSha256': 'e' * 64}

    def test_transition_cannot_skip_assets_or_schema_and_sw_review(self):
        current, one = self.make_release()
        target, two = self.make_release('two', '2' * 40)
        with self.assertRaisesRegex(release.Refusal, 'cached assets'):
            release.transition_plan(current, target)
        self.retain_current_assets(current, one, target, two)
        with self.assertRaisesRegex(release.Refusal, 'attestation'):
            release.transition_plan(current, target)
        evidence = self.live_evidence(one['migrations']['sha256'])
        attestation = {'fromArtifact': one['artifactSha256'], 'toArtifact': two['artifactSha256'],
                       'liveMigrationSha256': evidence['migrationSha256'],
                       'liveMigrationEvidenceSha256': release.digest(release.canonical(evidence)),
                       'schemaCompatible': True, 'serviceWorkerCompatible': True}
        plan = release.transition_plan(current, target, attestation, evidence)
        self.assertFalse(plan['mutations']); self.assertFalse(plan['migrate']); self.assertFalse(plan['restoreDatabase'])
        attestation['serviceWorkerCompatible'] = False
        with self.assertRaises(release.Refusal): release.transition_plan(current, target, attestation, evidence)

    def test_transition_uses_separate_post_migration_evidence_and_binds_receipt(self):
        current, one = self.make_release()
        journal = [{'tag': '0000_forward', 'when': 1, 'sha256': 'f' * 64}]
        target, two = self.make_release('two', '2' * 40, journal=journal)
        self.retain_current_assets(current, one, target, two)
        evidence = self.live_evidence(two['migrations']['sha256'])
        attestation = {'fromArtifact': one['artifactSha256'], 'toArtifact': two['artifactSha256'],
                       'liveMigrationSha256': one['migrations']['sha256'],
                       'liveMigrationEvidenceSha256': release.digest(release.canonical(evidence)),
                       'schemaCompatible': True, 'serviceWorkerCompatible': True}
        self.assertNotEqual(evidence['migrationSha256'], one['migrations']['sha256'])
        with self.assertRaisesRegex(release.Refusal, 'attestation'):
            release.transition_plan(current, target, attestation, evidence)
        attestation['liveMigrationSha256'] = evidence['migrationSha256']
        plan = release.transition_plan(current, target, attestation, evidence)
        self.assertEqual(plan['liveMigrationSha256'], two['migrations']['sha256'])
        self.assertEqual(plan['liveMigrationEvidenceSha256'], release.digest(release.canonical(evidence)))
        self.assertFalse(plan['mutations']); self.assertFalse(plan['migrate'])
        for changed in ({**evidence, 'evidenceSha256': 'd' * 64},
                        {**evidence, 'migrationSha256': 'malformed'}, None):
            with self.assertRaisesRegex(release.Refusal, 'attestation'):
                release.transition_plan(current, target, attestation, changed)
        for field in ('fromArtifact', 'toArtifact'):
            with self.assertRaisesRegex(release.Refusal, 'attestation'):
                release.transition_plan(current, target, {**attestation, field: '0' * 64}, evidence)

    def test_launchd_plan_contains_no_secrets_and_does_not_restart_preflight(self):
        root, _ = self.make_release(); config = self.config(root)
        config_path = self.root / 'config.json'; release.private_json(config_path, config)
        output = self.root / 'service.plist'
        with patch.object(release, 'node_identity', return_value=self.node), patch.object(release, 'executable', return_value=config['python']):
            result = release.launchd_plan(config_path, output)
        plist = plistlib.loads(output.read_bytes())
        self.assertFalse(result['installed']); self.assertFalse(plist['KeepAlive'])
        self.assertTrue(plist['RunAtLoad'])
        self.assertNotIn('DATABASE_URL', str(plist)); self.assertNotIn('AWS_SECRET_ACCESS_KEY', str(plist))
        self.assertEqual(plist['ProgramArguments'][1], str(root / 'deploy/runtime_launcher.py'))
        self.assertEqual(plist['Umask'], 63)
        self.assertEqual(plist['EnvironmentVariables']['PYTHONDONTWRITEBYTECODE'], '1')

    def test_launcher_entrypoint_does_not_mutate_packaged_modules(self):
        folder = self.root / 'packaged-deploy'; folder.mkdir()
        for name in ('mac_release.py', 'runtime_launcher.py'):
            (folder / name).write_bytes((DEPLOY / name).read_bytes())
        before = release.snapshot(folder)
        result = subprocess.run([sys.executable, str(folder / 'runtime_launcher.py'), '--help'],
                                env=release.clean_environment(), capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0)
        self.assertFalse((folder / '__pycache__').exists())
        self.assertEqual(release.snapshot(folder), before)

    def test_mutable_cache_and_log_paths_cannot_escape_artifact_guards(self):
        root, _ = self.make_release()
        (root / '.next/cache').symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(release.Refusal, 'Mutable cache'):
            release.verify_release(root)
        config = self.config(root); config['logDirectory'] = str(root / 'logs')
        with self.assertRaisesRegex(release.Refusal, 'logs must be outside'):
            release.checked_config(config)

    def test_health_checks_identity_not_just_ok(self):
        _, manifest = self.make_release()
        self.assertFalse(launcher.probe_health(3110, manifest, fetch=lambda _: {'status': 'ok', 'service': 'durtal'}))
        self.assertTrue(launcher.probe_health(3110, manifest, fetch=lambda _: {'status': 'ok', 'service': 'durtal', 'build': {k: manifest[k] for k in ('commit', 'tree', 'buildId')}}))

    def test_logs_redact_fragmented_secrets_drop_large_lines_and_rotate(self):
        logs = launcher.BoundedLog(self.root / 'logs', {'DATABASE_URL': 'secret-split-value'}, limit=90, copies=2)
        logs.consume(io.BytesIO(b'hello secret-split-value\n' + b'x' * 9000 + b'\nAuthorization: private\n'))
        logs.write('https://example.test/file?Signature=private')
        for i in range(20): logs.write('ordinary server event %d' % i)
        output = b''.join(p.read_bytes() for p in (self.root / 'logs').iterdir())
        self.assertNotIn(b'secret-split-value', output); self.assertNotIn(b'private', output)
        self.assertLessEqual(len(list((self.root / 'logs').iterdir())), 3)
        self.assertTrue(all(p.stat().st_size <= 90 for p in (self.root / 'logs').iterdir()))

    def test_secret_api_scopes_existing_owner_source_and_clean_environment(self):
        root, _ = self.make_release(); config = self.config(root)
        calls = []
        class Helper:
            @staticmethod
            def runtime_environment(names, source, node, aws):
                calls.append((names, source, node))
                return {'DATABASE_URL': 'private', 'AWS_ACCESS_KEY_ID': 'private', 'AWS_SECRET_ACCESS_KEY': 'private'}
        env, _ = launcher.load_environment(config, Helper)
        self.assertEqual(env['HOSTNAME'], '127.0.0.1'); self.assertEqual(env['NODE_ENV'], 'production')
        self.assertNotIn('AWS_PROFILE', env); self.assertNotIn('NODE_OPTIONS', env)
        self.assertEqual(calls[0][1], config['secretSource'])
        with patch.object(Helper, 'runtime_environment', side_effect=RuntimeError('private')):
            with self.assertRaises(RuntimeError): launcher.load_environment(config, Helper)

    def prepared_build(self, name='prepared', built=True):
        directory = self.root / name
        source = directory / 'source'; source.mkdir(parents=True)
        (source / 'pnpm-lock.yaml').write_text('lock')
        (source / 'next-env.d.ts').write_bytes(NEXT_ENV_DEV)
        migration = source / 'src/lib/db/migrations'
        (migration / 'meta').mkdir(parents=True)
        (migration / '0000_initial.sql').write_text('select 1;')
        (migration / 'meta/_journal.json').write_text(json.dumps({'entries': [{'tag': '0000_initial', 'when': 1}]}))
        for folder, names in [('scripts/deploy', ['mac_release.py', 'runtime_launcher.py']), ('scripts/aws', ['phone_secrets.py'])]:
            (source / folder).mkdir(parents=True)
            for name in names: (source / folder / name).write_text('# reviewed fixture source')
        (source / 'public/fonts/reader').mkdir(parents=True)
        (source / 'public/fonts/reader/font.woff2').write_bytes(b'font')
        state = {'commit': COMMIT, 'tree': TREE, 'buildId': COMMIT, 'node': self.node,
                 'pnpm': {'path': '/absolute/pnpm', 'sha256': 'f' * 64},
                 'sourceFiles': release.snapshot_source(source), 'lockSha256': release.file_hash(source / 'pnpm-lock.yaml'),
                 'publicInputsSha256': release.digest(release.canonical({})),
                 'productionNextEnv': release.production_next_env(source)}
        release.private_json(directory / 'preparation.json', state)
        release.private_json(directory / 'public-build-inputs.json', {})
        if not built:
            return directory, source
        (source / 'next-env.d.ts').write_bytes(NEXT_ENV_PRODUCTION)
        (source / '.next/standalone/.next').mkdir(parents=True)
        (source / '.next/standalone/server.js').write_text('server')
        (source / '.next/standalone/.next/BUILD_ID').write_text(COMMIT)
        (source / '.next/BUILD_ID').write_text(COMMIT)
        (source / '.next/static').mkdir()
        (source / '.next/static/new.js').write_text('new')
        release.private_json(directory / 'build.json', {'preparationSha256': release.file_hash(directory / 'preparation.json'),
            'standaloneFiles': release.snapshot(source / '.next/standalone', mutable_cache=True),
            'staticFiles': release.snapshot(source / '.next/static'), 'publicFiles': release.snapshot(source / 'public')})
        return directory, source

    def test_generated_public_extras_are_allowed_only_after_build(self):
        for number, relative in enumerate(GENERATED_PUBLIC_FILES):
            with self.subTest(relative=relative):
                directory, source = self.prepared_build(name=f'generated-{number}', built=False)
                path = source / relative; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'generated')
                self.assertNotIn(relative, release.read_json(directory / 'preparation.json')['sourceFiles'])
                with patch.object(release, 'node_identity'), patch.object(release, 'executable'):
                    with self.assertRaisesRegex(release.Refusal, 'source changed'):
                        release.verify_preparation(directory)
                    (source / 'next-env.d.ts').write_bytes(NEXT_ENV_PRODUCTION)
                    release.verify_preparation(directory, production=True)

    def test_archived_generated_paths_remain_strict_after_build(self):
        for number, relative in enumerate(GENERATED_PUBLIC_FILES):
            for mutation in ('tamper', 'delete'):
                with self.subTest(relative=relative, mutation=mutation):
                    directory, source = self.prepared_build(name=f'archived-{number}-{mutation}', built=False)
                    path = source / relative; path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(b'archived')
                    state = release.read_json(directory / 'preparation.json')
                    state['sourceFiles'] = release.snapshot_source(source)
                    (directory / 'preparation.json').unlink()
                    release.private_json(directory / 'preparation.json', state)
                    (source / 'next-env.d.ts').write_bytes(NEXT_ENV_PRODUCTION)
                    with patch.object(release, 'node_identity'), patch.object(release, 'executable'):
                        release.verify_preparation(directory, production=True)
                        if mutation == 'tamper': path.write_bytes(b'tampered')
                        else: path.unlink()
                        with self.assertRaisesRegex(release.Refusal, 'source changed'):
                            release.verify_preparation(directory, production=True)

    def test_postbuild_rejects_other_public_extras_and_generated_symlinks(self):
        for number, relative in enumerate(('public/icons/other.png', 'public/icons/durtal-192.png.bak', 'public/offline-assets.json.bak')):
            with self.subTest(relative=relative):
                directory, source = self.prepared_build(name=f'extra-{number}')
                path = source / relative; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'unexpected')
                with patch.object(release, 'node_identity'), patch.object(release, 'executable'):
                    with self.assertRaisesRegex(release.Refusal, 'source changed'):
                        release.verify_preparation(directory, production=True)
        directory, source = self.prepared_build(name='generated-symlink')
        (source / 'public/offline-assets.json').symlink_to(source / 'pnpm-lock.yaml')
        with patch.object(release, 'node_identity'), patch.object(release, 'executable'):
            with self.assertRaisesRegex(release.Refusal, 'symlink'):
                release.verify_preparation(directory, production=True)

    def test_mocked_build_accepts_only_exact_generated_declaration_transition(self):
        # Exercise build's pre/post checks and package's production check; no pnpm
        # process, dependency install or Next build is invoked.
        for name in ('expected', 'unchanged', 'extra-declaration-change', 'other-source-change'):
            with self.subTest(name=name):
                directory, source = self.prepared_build(name=name, built=False)
                def mocked_command(args, **kwargs):
                    if args[-1] == 'build':
                        declaration = NEXT_ENV_DEV if name == 'unchanged' else NEXT_ENV_PRODUCTION
                        if name == 'extra-declaration-change': declaration += b'// unreviewed edit\n'
                        (source / 'next-env.d.ts').write_bytes(declaration)
                        for relative in GENERATED_PUBLIC_FILES:
                            path = source / relative; path.parent.mkdir(parents=True, exist_ok=True)
                            path.write_bytes(b'generated public fixture')
                        if name == 'other-source-change':
                            (source / 'scripts/deploy/mac_release.py').write_text('unreviewed edit')
                        (source / '.next/standalone/.next').mkdir(parents=True)
                        (source / '.next/standalone/server.js').write_text('server')
                        (source / '.next/standalone/.next/BUILD_ID').write_text(COMMIT)
                        (source / '.next/BUILD_ID').write_text(COMMIT)
                        (source / '.next/static').mkdir()
                        (source / '.next/static/new.js').write_text('new')
                    return b''
                with patch.object(release, 'node_identity'), patch.object(release, 'executable'), patch.object(release, 'run', side_effect=mocked_command) as run:
                    if name != 'expected':
                        with self.assertRaisesRegex(release.Refusal, 'source changed'):
                            release.build(directory, allow=True)
                        self.assertFalse((directory / 'build.json').exists())
                    else:
                        release.build(directory, allow=True)
                        self.assertEqual(run.call_count, 2)
                        proof = release.read_json(directory / 'build.json')
                        manifest = release.package(directory, self.root / 'valid-production-package')
                        for relative in GENERATED_PUBLIC_FILES:
                            identity = release.snapshot_entry(source / relative)
                            self.assertEqual(proof['publicFiles'][relative.removeprefix('public/')], identity)
                            self.assertEqual(manifest['files'][relative], identity)
                        (source / 'public/offline-assets.json').write_bytes(b'tampered generated output')
                        with self.assertRaisesRegex(release.Refusal, 'output changed'):
                            release.package(directory, self.root / 'tampered-generated-package')
                        (source / 'public/offline-assets.json').write_bytes(b'generated public fixture')
                        (source / 'next-env.d.ts').write_bytes(NEXT_ENV_PRODUCTION + b'// later tamper\n')
                        with self.assertRaisesRegex(release.Refusal, 'source changed'):
                            release.package(directory, self.root / 'tampered-declaration-package')

    def test_packager_preserves_real_old_assets_and_shared_helper(self):
        directory, source = self.prepared_build()
        old, one = self.make_release('old', '1' * 40)
        target = self.root / 'packaged'
        with patch.object(release, 'node_identity'), patch.object(release, 'executable'):
            manifest = release.package(directory, target, old)
        self.assertEqual(manifest['retainedBuildIds'], [one['buildId']])
        self.assertTrue((target / '.next/static' / ('1' * 40 + '.js')).is_file())
        self.assertEqual((target / 'deploy/phone_secrets.py').read_text(), (DEPLOY / 'phone_secrets.py').read_text())
        self.assertEqual(release.verify_release(target)['artifactSha256'], manifest['artifactSha256'])

    def test_packager_rejects_asset_collision_and_output_tampering(self):
        directory, source = self.prepared_build()
        old, _ = self.make_release('old', '1' * 40)
        (old / 'public/fonts/reader/font.woff2').write_bytes(b'different cached font')
        (old / release.MANIFEST).unlink()
        old_manifest = {'version': 1, 'commit': '1' * 40, 'tree': TREE, 'buildId': '1' * 40, 'node': self.node,
                        'migrations': {'entries': [], 'sha256': release.digest(release.canonical([]))}, 'retainedBuildIds': [], 'files': release.snapshot(old)}
        old_manifest['artifactSha256'] = release.digest(release.canonical(old_manifest))
        release.private_json(old / release.MANIFEST, old_manifest)
        with patch.object(release, 'node_identity'), patch.object(release, 'executable'):
            with self.assertRaisesRegex(release.Refusal, 'asset collision'):
                release.package(directory, self.root / 'collision', old)
            (source / '.next/standalone/server.js').write_text('tampered output')
            with self.assertRaisesRegex(release.Refusal, 'output changed'):
                release.package(directory, self.root / 'tampered')

    def test_main_build_id_is_attested_separately_from_source_commit(self):
        directory, source = self.prepared_build()
        build_id = 'main-next-generated-id'
        (source / '.next/BUILD_ID').write_text(build_id)
        (source / '.next/standalone/.next/BUILD_ID').write_text(build_id)
        proof = release.read_json(directory / 'build.json')
        proof.update(buildId=build_id, standaloneFiles=release.snapshot(source / '.next/standalone', mutable_cache=True))
        (directory / 'build.json').write_bytes(release.canonical(proof))
        target = self.root / 'main-release'
        with patch.object(release, 'node_identity'), patch.object(release, 'executable'):
            manifest = release.package(directory, target)
        self.assertEqual(manifest['commit'], COMMIT)
        self.assertEqual(manifest['buildId'], build_id)
        self.assertFalse(manifest['healthHasBuildIdentity'])
        release.verify_release(target)

    def test_main_health_requires_owned_pid_not_just_ok(self):
        manifest = {'healthHasBuildIdentity': False}
        fetch = lambda _: {'status': 'ok', 'service': 'durtal'}
        with self.assertRaises(release.Refusal): launcher.probe_health(3110, manifest, fetch)
        with patch.object(launcher.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'p123\n')):
            self.assertTrue(launcher.probe_health(3110, manifest, fetch, pid=123))
        with patch.object(launcher.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'p456\n')):
            self.assertFalse(launcher.probe_health(3110, manifest, fetch, pid=123))

    def test_existing_env_source_is_scoped_and_not_evaluated(self):
        import phone_secrets
        source = self.root / 'personal/durtal/.env.local'
        source.parent.mkdir(parents=True); source.write_text('DATABASE_URL="fixture"\nUNRELATED_SECRET=unused\n'); source.chmod(0o600)
        names = sorted(release.REQUIRED_NAMES)
        values = {name: 'fixture' for name in names}
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, json.dumps(values).encode())
        with patch.object(Path, 'home', return_value=self.root), patch.object(phone_secrets, 'verify_identity') as identity:
            self.assertEqual(phone_secrets.runtime_environment(names, source, '/pinned/node', {}, run), values)
            with self.assertRaises(release.Refusal): phone_secrets.runtime_environment(names, self.root / 'other', '/pinned/node', {}, run)
            source.chmod(0o666)
            with self.assertRaises(release.Refusal): phone_secrets.runtime_environment(names, source, '/pinned/node', {}, run)
        identity.assert_called_once_with(values, {})
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0][:3], ['/pinned/node', '-e', phone_secrets.PARSE])
        self.assertEqual(json.loads(calls[0][0][3]), names)
        self.assertEqual(calls[0][1]['env'], {'PATH': '/usr/bin:/bin'})

    def test_identity_reuses_approved_helper_with_no_ambient_environment(self):
        import phone_secrets
        values = {'AWS_ACCESS_KEY_ID': 'AKIA' + 'A' * 16, 'AWS_SECRET_ACCESS_KEY': 'fixture'}
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args, 0, json.dumps({'Account': release.ACCOUNT,
                'Arn': 'arn:aws:iam::' + release.ACCOUNT + ':user/durtal-app'}).encode())
        with patch.object(phone_secrets, 'executable'), patch.dict(os.environ, {'AWS_PROFILE': 'work', 'NODE_OPTIONS': 'bad', 'UNRELATED_SECRET': 'unused'}):
            phone_secrets.verify_identity(values, {'path': '/pinned/aws', 'sha256': 'a' * 64}, run)
        self.assertEqual(calls[0][0][0], '/pinned/aws')
        self.assertEqual(calls[0][1]['timeout'], 15)
        self.assertNotIn('NODE_OPTIONS', calls[0][1]['env'])
        self.assertNotIn('AWS_PROFILE', calls[0][1]['env'])
        self.assertNotIn('UNRELATED_SECRET', calls[0][1]['env'])

    def test_archive_excludes_direnv_without_executing_or_copying_it(self):
        import tarfile
        repo = self.root / 'archive-repo'; repo.mkdir()
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode='w') as tar:
            for name, data in {'.envrc': b'dotenv_if_exists .env.local', 'pnpm-lock.yaml': b'lock', 'next-env.d.ts': NEXT_ENV_DEV}.items():
                info = tarfile.TarInfo(name); info.size = len(data); tar.addfile(info, io.BytesIO(data))
        destination = self.root / 'excluded-direnv'
        with patch.object(release, 'source_identity', return_value={'commit': COMMIT, 'tree': TREE}), \
                patch.object(release, 'node_identity', return_value=self.node), \
                patch.object(release, 'executable', return_value={'path': '/pinned/pnpm', 'sha256': 'f' * 64}), \
                patch.object(release, 'run', side_effect=[b'10.26.1', archive.getvalue()]):
            state = release.prepare(repo, COMMIT, destination, '/pinned/node', '/pinned/pnpm', {})
        self.assertEqual(state['excludedSourcePaths'], ['.envrc'])
        self.assertFalse((destination / 'source/.envrc').exists())

    def test_migration_timestamps_must_be_monotonic(self):
        _, source = self.prepared_build()
        path = source / 'src/lib/db/migrations/meta/_journal.json'
        path.write_text(json.dumps({'entries': [{'tag': '0000_initial', 'when': 1}, {'tag': '0001_later', 'when': 1}]}))
        with self.assertRaisesRegex(release.Refusal, 'strictly ordered'):
            release.migrations(source)

    def test_archive_preparation_excludes_dirty_files_dependencies_and_env(self):
        repo = self.root / 'repo'; repo.mkdir()
        (repo / 'pnpm-lock.yaml').write_text('lock')
        (repo / 'app.ts').write_text('reviewed')
        (repo / '.env.example').write_text('DATABASE_URL=')
        (repo / 'next-env.d.ts').write_bytes(NEXT_ENV_DEV)
        run = lambda args: subprocess.run(args, cwd=repo, check=True, capture_output=True)
        run(['git', 'init', '-q'])
        run(['git', 'add', 'pnpm-lock.yaml', 'app.ts', '.env.example', 'next-env.d.ts'])
        run(['git', '-c', 'user.name=Pablo Aguirre', '-c', 'user.email=pabloaguirrenck@protonmail.com', 'commit', '-qm', 'Fixture'])
        commit = run(['git', 'rev-parse', 'HEAD']).stdout.decode().strip()
        (repo / 'app.ts').write_text('dirty owner change')
        (repo / '.env.local').write_text('SECRET=private')
        (repo / 'node_modules').mkdir(); (repo / 'node_modules/copied').write_text('old dependencies')
        real_run = release.run
        def commands(args, **kwargs):
            if args == ['/absolute/node22', '/absolute/pnpm', '--version']: return b'10.26.1\n'
            return real_run(args, **kwargs)
        with patch.object(release, 'node_identity', return_value=self.node), patch.object(release, 'executable', return_value={'path': '/absolute/pnpm', 'sha256': 'f' * 64}), patch.object(release, 'run', side_effect=commands):
            with self.assertRaisesRegex(release.Refusal, 'outside the checkout'):
                release.prepare(str(repo), commit, repo / 'archive', '/absolute/node22', '/absolute/pnpm', {})
            release.prepare(str(repo), commit, self.root / 'archive', '/absolute/node22', '/absolute/pnpm', {})
        source = self.root / 'archive/source'
        self.assertEqual((source / 'app.ts').read_text(), 'reviewed')
        self.assertFalse((source / '.env.local').exists()); self.assertFalse((source / 'node_modules').exists())
        self.assertEqual((repo / 'app.ts').read_text(), 'dirty owner change')


if __name__ == '__main__':
    unittest.main()
