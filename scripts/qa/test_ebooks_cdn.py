"""Lightweight source/phase/identity/privacy tests. Never contacts AWS or Keychain."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/aws' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


cdn = load('cdn_test_module', 'ebooks-cdn.py')
secrets = load('secrets_test_module', 'macos-secrets.py')
ACCOUNT = '111122223333'
ADMIN = 'arn:aws:iam::' + ACCOUNT + ':role/aws-reserved/sso.amazonaws.com/eu-north-1/OwnerAdmin'


class MemorySecrets:
    def __init__(self):
        self.values, self.writes = {}, []

    def get(self, service, account):
        return self.values.get((service, account))

    def put_once(self, service, account, value):
        current = self.get(service, account)
        if current is not None and current != value:
            raise secrets.SecretError('Existing secret differs')
        if current is None:
            self.values[(service, account)] = value
            self.writes.append((service, account))


class FakeAws:
    """Stateful provider simulator; records only metadata, never secret payloads."""
    def __init__(self):
        self.account = ACCOUNT
        self.arn = 'arn:aws:sts::' + ACCOUNT + ':assumed-role/OwnerAdmin/session'
        self.region = 'eu-north-1'
        self.policy = {'Version': '2012-10-17', 'Statement': [{'Sid': 'ExistingEbookGuard', 'Effect': 'Deny'}]}
        self.shared = {'Rules': [{'ID': 'leave-this-rule'}]}
        self.created, self.calls = {}, []
        self.live, self.budget, self.notes = False, None, []
        self.deny, self.fail_edge = None, False
        self.fail_after = None
        self.live_code = None
        self.live_config = None
        self.live_etag = 'live-etag'
        self.duplicate_development_function = False
        self.reject_next_update = False
        self.update_documents = []

    def run(self, args, env, input, capture_output, timeout=None):
        service, op = args[1:3]
        if '--cli-input-json' in args:
            reference = args[args.index('--cli-input-json') + 1]
            path = Path(reference[len('file://'):])
            first, second = path.read_bytes(), path.read_bytes()
            if first != second:
                raise AssertionError('Both private FIFO reads must match')
            document = json.loads(first)
        else:
            document = json.loads(input) if input else {}
        self.calls.append({'service': service, 'op': op, 'args': args, 'env_names': sorted(k for k in env if k.startswith('AWS_')), 'stdin': input is not None or '--cli-input-json' in args})
        def result(value):
            return types.SimpleNamespace(returncode=0, stdout=json.dumps(value).encode(), stderr=b'')
        def absent(code):
            return types.SimpleNamespace(returncode=254, stdout=b'', stderr=('An error occurred (%s) when calling provider secret@example.invalid' % code).encode())
        if self.deny == op:
            return absent('AccessDenied')
        if op == 'get-caller-identity':
            return result({'Account': self.account, 'Arn': self.arn})
        if op == 'get-bucket-location':
            return result({'LocationConstraint': self.region})
        if op == 'get-bucket-policy':
            return result({'Policy': json.dumps(self.policy)})
        if service == 's3api' and op.startswith('get-'):
            return result(self.shared)
        if op == 'get-user-policy':
            return result({'PolicyDocument': {'Statement': [{'Sid': 'ExistingMultipart'}]}})
        if op == 'list-attached-user-policies':
            return result({'AttachedPolicies': [{'PolicyName': 'ExistingMedia', 'PolicyArn': 'arn:aws:iam::' + ACCOUNT + ':policy/ExistingMedia'}]})
        if op == 'get-policy':
            return result({'Policy': {'DefaultVersionId': 'v1'}})
        if op == 'get-policy-version':
            return result({'PolicyVersion': {'Document': {'Statement': [{'Sid': 'PreservedMedia'}]}, 'VersionId': 'v1'}})
        if op == 'get-distribution-config' and args[args.index('--id') + 1] in cdn.PROTECTED:
            return result({'ETag': 'protected-etag', 'DistributionConfig': {'Comment': 'existing unrelated'}})
        lists = {'list-origin-access-controls': ('oac', 'OriginAccessControlList', None),
                 'list-cache-policies': ('cache', 'CachePolicyList', 'CachePolicy'),
                 'list-response-headers-policies': ('headers', 'ResponseHeadersPolicyList', 'ResponseHeadersPolicy'),
                 'list-public-keys': ('public_key', 'PublicKeyList', None),
                 'list-key-groups': ('key_group', 'KeyGroupList', 'KeyGroup'),
                 'list-functions': ('function', 'FunctionList', None),
                 'list-distributions': ('distribution', 'DistributionList', None)}
        if op in lists:
            kind, outer, wrapper = lists[op]
            obj = copy.deepcopy(self.created.get(kind))
            if kind == 'oac' and obj:
                obj = {**obj['OriginAccessControlConfig'], 'Id': obj['Id']}
            if kind == 'public_key' and obj:
                obj = {**obj['PublicKeyConfig'], 'Id': obj['Id']}
            if kind == 'distribution' and obj:
                obj = {**obj['DistributionConfig'], 'Id': obj['Id']}
            entries = [{wrapper: obj} if wrapper else obj] if obj else []
            if kind == 'function' and obj:
                if self.live:
                    live = copy.deepcopy(obj)
                    live['FunctionMetadata']['Stage'] = 'LIVE'
                    entries.append(live)
                if self.duplicate_development_function:
                    entries.append(copy.deepcopy(obj))
                if '--stage' in args:
                    stage = args[args.index('--stage') + 1]
                    entries = [x for x in entries if x['FunctionMetadata']['Stage'] == stage]
            return result({outer: {'Items': entries}})
        creates = {v[0]: (k, v[1], v[2]) for k, v in cdn.CREATE.items()}
        if op in creates:
            kind, field, outer = creates[op]
            obj = {'Id': 'NEW-' + kind, field: document[field]}
            self.created[kind] = obj
            if op == self.fail_after:
                self.fail_after = None
                return absent('Unavailable')
            return result({outer: obj})
        if op == 'get-public-key':
            return result({'PublicKey': self.created['public_key']})
        if op == 'create-function':
            config = document['FunctionConfig']
            self.created['function'] = {'Name': cdn.NAMES['function'], 'FunctionConfig': config,
                                        'FunctionMetadata': {'FunctionARN': 'arn:aws:cloudfront::' + ACCOUNT + ':function/' + cdn.NAMES['function'],
                                                             'Stage': 'DEVELOPMENT'}}
            if op == self.fail_after:
                self.fail_after = None
                return absent('Unavailable')
            return result({'ETag': 'development-etag', 'FunctionSummary': self.created['function']})
        if op == 'describe-function':
            if '--stage' in args and args[args.index('--stage') + 1] == 'LIVE' and not self.live:
                return absent('NoSuchFunctionExists')
            live = args[args.index('--stage') + 1] == 'LIVE'
            summary = copy.deepcopy(self.created['function'])
            summary['FunctionMetadata']['Stage'] = 'LIVE' if live else 'DEVELOPMENT'
            if live and self.live_config is not None:
                summary['FunctionConfig'] = self.live_config
            return result({'ETag': self.live_etag if live else 'development-etag', 'FunctionSummary': summary})
        if op == 'get-function':
            target = Path(args[args.index('--stage') + 2])
            live = args[args.index('--stage') + 1] == 'LIVE'
            target.write_bytes(self.live_code if live and self.live_code is not None else (cdn.TEMPLATES / 'viewer-request.js').read_bytes())
            return result({'ETag': self.live_etag if live else 'development-etag'})
        if op == 'test-function':
            import base64
            event = json.loads(base64.b64decode(document['EventObject']))
            request = event['request']
            valid = request['uri'].startswith('/gold/ebooks/epub/')
            captured = json.loads((ROOT / 'scripts/qa/fixtures/ebooks-cdn-function-output.json').read_bytes())
            if valid and request['method'] != 'OPTIONS':
                output = {'request': request}
            else:
                output = copy.deepcopy(captured[2 if valid else 3]['output'])
            return result({'TestResult': {'FunctionOutput': json.dumps(output), 'FunctionErrorMessage': 'failure' if self.fail_edge else ''}})
        if op == 'publish-function':
            self.live = True
            return result({})
        if op == 'create-distribution-with-tags':
            self.distribution_tags = document['DistributionConfigWithTags']['Tags']
            self.created['distribution'] = {'Id': 'NEW-distribution', 'DistributionConfig': copy.deepcopy(document['DistributionConfigWithTags']['DistributionConfig'])}
            config = self.created['distribution']['DistributionConfig']
            config['DefaultCacheBehavior'].update(GrpcConfig={'Enabled': False}, SmoothStreaming=False)
            config['ViewerCertificate']['SSLSupportMethod'] = 'vip'
            for error in config['CustomErrorResponses']['Items']:
                error.update(ResponseCode='', ResponsePagePath='')
            return result({'Distribution': self.created['distribution']})
        if op == 'get-distribution-config':
            return result({'ETag': 'own-etag', 'DistributionConfig': self.created['distribution']['DistributionConfig']})
        if op == 'list-tags-for-resource':
            return result({'Tags': self.distribution_tags})
        if op == 'get-distribution':
            return result({'Distribution': {'DomainName': 'owned.cloudfront.net', 'Status': 'Deployed'}})
        if op == 'put-bucket-policy':
            self.policy = json.loads(document['Policy'])
            return result({})
        if op == 'update-distribution':
            self.update_documents.append(copy.deepcopy(document))
            if self.reject_next_update or 'SmoothStreaming' not in document['DistributionConfig']['DefaultCacheBehavior']:
                self.reject_next_update = False
                return absent('InvalidArgument')
            self.created['distribution']['DistributionConfig'] = document['DistributionConfig']
            return result({})
        if op == 'describe-budget':
            if not self.budget:
                return absent('NotFoundException')
            budget = copy.deepcopy(self.budget)
            budget.setdefault('HealthStatus', {'Status': 'HEALTHY'})
            return result({'Budget': budget})
        if op == 'create-budget':
            self.budget = document['Budget']
            self.notes = document['NotificationsWithSubscribers']
            if op == self.fail_after:
                self.fail_after = None
                return absent('Unavailable')
            return result({})
        if op == 'update-budget':
            self.budget = document['NewBudget']
            return result({})
        if op == 'describe-notifications-for-budget':
            return result({'Notifications': [n['Notification'] for n in self.notes]})
        if op == 'describe-subscribers-for-notification':
            for note in self.notes:
                if note['Notification'] == document['Notification']:
                    return result({'Subscribers': note['Subscribers']})
            return result({'Subscribers': []})
        if op == 'create-subscriber':
            for n in self.notes:
                if n['Notification'] == document['Notification']:
                    n['Subscribers'].append(document['Subscriber'])
            if op == self.fail_after:
                self.fail_after = None
                return absent('Unavailable')
            return result({})
        if op == 'create-notification':
            self.notes.append({'Notification': document['Notification'], 'Subscribers': document['Subscribers']})
            if op == self.fail_after:
                self.fail_after = None
                return absent('Unavailable')
            return result({})
        raise AssertionError('Unexpected fake provider operation: ' + op)

    def mutations(self):
        return [c for c in self.calls if c['op'] in cdn.MUTATIONS.get(c['service'], set())]


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/private/tmp')
        self.base = Path(self.temp.name)
        self.provider, self.secrets = FakeAws(), MemorySecrets()
        self.aws = cdn.Aws(ACCOUNT, ADMIN, self.provider.run)
        self.control = cdn.Control(self.aws, self.base / 'state', self.secrets)
        self.email = ('owner' + '@' + 'example.invalid').encode()

    def tearDown(self):
        self.temp.cleanup()

    def package(self, phase):
        directory = self.base / ('plan-' + phase)
        hash = self.control.plan(phase, directory)
        return directory, hash

    def apply(self, phase):
        directory, hash = self.package(phase)
        packet = self.control.approved(directory, hash, phase)
        getattr(self.control, phase)(packet, self.email) if phase == 'bootstrap' else getattr(self.control, phase)(packet)

    def test_read_only_plan_ignores_ambient_and_does_not_touch_secrets(self):
        with patch.dict(os.environ, {'AWS_PROFILE': 'forbidden-work', 'AWS_ACCESS_KEY_ID': 'ambient', 'AWS_ENDPOINT_URL': 'https://forbidden.invalid'}):
            self.package('bootstrap')
        self.assertEqual([], self.provider.mutations())
        self.assertEqual([], self.secrets.writes)
        self.assertFalse((self.base / 'state').exists())
        for call in self.provider.calls:
            self.assertEqual(cdn.PROFILE, call['args'][call['args'].index('--profile') + 1])
            self.assertEqual(cdn.REGION, call['args'][call['args'].index('--region') + 1])
            self.assertNotIn('AWS_PROFILE', call['env_names'])
            self.assertNotIn('AWS_ACCESS_KEY_ID', call['env_names'])
            self.assertNotIn('AWS_ENDPOINT_URL', call['env_names'])

    def test_fifo_replays_large_payload_without_regular_file_or_argv_values(self):
        import stat
        marker = os.urandom(128 * 1024)
        with cdn.json_pipe(marker) as reference:
            path = Path(reference[len('file://'):])
            self.assertTrue(stat.S_ISFIFO(path.stat().st_mode))
            self.assertEqual(0o600, stat.S_IMODE(path.stat().st_mode))
            self.assertEqual(0o700, stat.S_IMODE(path.parent.stat().st_mode))
            self.assertTrue(all(stat.S_ISFIFO(p.stat().st_mode) for p in path.parent.iterdir()))
            result = subprocess.run(['python3', '-c',
                'import sys;from pathlib import Path;p=Path(sys.argv[1]);a=p.read_bytes();b=p.read_bytes();assert len(a)==131072 and a==b',
                str(path)], capture_output=True, timeout=20)
            self.assertEqual(0, result.returncode)
        self.assertFalse(path.parent.exists())

    def test_fifo_drains_before_inode_replacement_and_eof_uses_distinct_inodes(self):
        import select
        with cdn.json_pipe(b'{}') as reference:
            path = Path(reference[len('file://'):])
            with path.open('rb') as first:
                inode = os.fstat(first.fileno()).st_ino
                self.assertTrue(select.select([first], [], [], 1)[0])
                self.assertEqual(inode, path.stat().st_ino)
                self.assertEqual(b'{}', first.read(2))
                self.assertEqual(b'', first.read())
                self.assertNotEqual(inode, path.stat().st_ino)
            with path.open('rb') as second:
                self.assertEqual(path.stat().st_ino, os.fstat(second.fileno()).st_ino)
                self.assertNotEqual(inode, os.fstat(second.fileno()).st_ino)
                self.assertEqual(b'{}', second.read())
        self.assertFalse(path.parent.exists())

    def test_fifo_one_reader_and_cli_timeout_cleanup_are_bounded(self):
        import time
        for command, timeout in ((['python3', '-c', 'from pathlib import Path;import sys;assert Path(sys.argv[1]).read_bytes()==bytes([123,125])'], 2),
                                 (['python3', '-c', 'import threading;threading.Event().wait(60)'], 0.2)):
            with cdn.json_pipe(b'{}') as reference:
                path = Path(reference[len('file://'):])
                started = time.monotonic()
                if timeout == 0.2:
                    with self.assertRaises(subprocess.TimeoutExpired):
                        subprocess.run(command + [str(path)], capture_output=True, timeout=timeout)
                else:
                    result = subprocess.run(command + [str(path)], capture_output=True, timeout=timeout)
                    self.assertEqual(0, result.returncode)
            self.assertFalse(path.parent.exists())
            self.assertLess(time.monotonic() - started, 2)

    def test_fifo_slow_partial_reader_preserves_path_until_full_consumption(self):
        import select
        payload = b'x' * (128 * 1024)
        with cdn.json_pipe(payload) as reference:
            path = Path(reference[len('file://'):])
            with path.open('rb', buffering=0) as first:
                inode = os.fstat(first.fileno()).st_ino
                self.assertTrue(select.select([first], [], [], 1)[0])
                prefix = first.read(1)
                self.assertEqual(inode, path.stat().st_ino)
                # The reader deliberately holds the stream before consuming the
                # rest; correctness depends on queue state, not a timed sleep.
                self.assertEqual(payload, prefix + first.read())
                self.assertNotEqual(inode, path.stat().st_ino)
            self.assertEqual(payload, path.read_bytes())
        self.assertFalse(path.parent.exists())

    def test_fifo_unconsumed_data_expires_at_real_writer_deadline(self):
        import threading
        real_thread, workers = threading.Thread, []
        def capture(*args, **kwargs):
            worker = real_thread(*args, **kwargs)
            workers.append(worker)
            return worker
        with patch.object(cdn.threading, 'Thread', side_effect=capture):
            with self.assertRaisesRegex(cdn.Refusal, 'Private FIFO transport failed'):
                with cdn.json_pipe(b'{}') as reference:
                    path = Path(reference[len('file://'):])
                    with path.open('rb'):
                        workers[0].join(timeout=16)
                        self.assertFalse(workers[0].is_alive())
        self.assertFalse(path.parent.exists())

    def test_fifo_partial_reader_exception_stops_writer_and_cleans_nodes(self):
        with self.assertRaisesRegex(RuntimeError, 'consumer stopped'):
            with cdn.json_pipe(b'x' * (256 * 1024)) as reference:
                path = Path(reference[len('file://'):])
                with path.open('rb', buffering=0) as reader:
                    self.assertEqual(b'x', reader.read(1))
                    raise RuntimeError('consumer stopped')
        self.assertFalse(path.parent.exists())

    def test_fifo_idle_cleanup_and_bound_refuse_without_provider_call(self):
        import time
        started = time.monotonic()
        with cdn.json_pipe(b'{}') as reference:
            folder = Path(reference[len('file://'):]).parent
        self.assertFalse(folder.exists())
        self.assertLess(time.monotonic() - started, 2)
        for payload in (b'', b'a' * (256 * 1024 + 1)):
            with self.assertRaises(cdn.Refusal):
                with cdn.json_pipe(payload):
                    self.fail('Unbounded payload must be refused')
        self.assertEqual([], self.provider.calls)

    def test_wrong_identity_region_and_denied_read_fail_closed(self):
        for bad in ('account', 'arn', 'region', 'deny'):
            with self.subTest(bad=bad):
                self.provider = FakeAws()
                setattr(self.provider, bad, {'account': '123456789012', 'arn': 'arn:aws:iam::' + ACCOUNT + ':user/other', 'region': 'us-east-1', 'deny': 'get-bucket-policy'}[bad])
                control = cdn.Control(cdn.Aws(ACCOUNT, ADMIN, self.provider.run), self.base / 'state', self.secrets)
                with self.assertRaises(cdn.Refusal):
                    control.plan('bootstrap', self.base / bad)
                self.assertEqual([], self.provider.mutations())

    def test_unapproved_write_and_protected_id_refused(self):
        with self.assertRaises(cdn.Refusal):
            self.aws.call('s3api', 'put-bucket-policy')
        self.aws.allow_writes = True
        with self.assertRaises(cdn.Refusal):
            self.aws.call('cloudfront', 'update-distribution', ['--id', cdn.PROTECTED[0]])
        self.assertEqual([], self.provider.calls)

    def test_changed_packet_source_and_baseline_refused(self):
        directory, hash = self.package('bootstrap')
        with self.assertRaises(cdn.Refusal):
            self.control.approved(directory, '0' * 64, 'bootstrap')
        with patch.object(cdn, 'source_binding', return_value={'modified': 'hash'}):
            with self.assertRaises(cdn.Refusal):
                self.control.approved(directory, hash, 'bootstrap')
        self.provider.policy['Statement'].append({'Sid': 'Unexpected'})
        with self.assertRaises(cdn.Refusal):
            self.control.approved(directory, hash, 'bootstrap')
        self.assertEqual([], self.provider.mutations())

    def test_bootstrap_publish_budget_and_noop_reapply(self):
        baseline = copy.deepcopy(self.provider.policy)
        self.apply('bootstrap')
        self.assertFalse(self.provider.created['distribution']['DistributionConfig']['Enabled'])
        self.assertEqual(baseline, self.provider.policy)
        self.apply('publish')
        self.assertTrue(self.provider.created['distribution']['DistributionConfig']['Enabled'])
        self.assertEqual(baseline['Statement'], self.provider.policy['Statement'][:-1])
        self.assertEqual(cdn.SID, self.provider.policy['Statement'][-1]['Sid'])
        self.apply('budget')
        self.assertEqual('matches', self.control.verify()['infrastructure'])
        mutations = len(self.provider.mutations())
        for phase in ('bootstrap', 'publish', 'budget'):
            self.apply(phase)
        self.assertEqual(mutations, len(self.provider.mutations()))
        for call in self.provider.mutations():
            self.assertNotIn('iam', call['service'])
            self.assertNotIn('put-bucket-lifecycle-configuration', call['op'])
            self.assertTrue(call['stdin'] or call['op'] == 'publish-function')
        for path in self.base.rglob('*'):
            if path.is_file():
                self.assertNotIn(self.email, path.read_bytes())
                self.assertNotIn(b'BEGIN PRIVATE KEY', path.read_bytes())
                self.assertEqual(0o600, path.stat().st_mode & 0o777)

    def test_publication_preserves_full_returned_config_changes_enabled_only(self):
        self.apply('bootstrap')
        captured = json.loads((ROOT / 'scripts/qa/fixtures/ebooks-cdn-distribution-config.json').read_bytes())
        original = cdn.substitute(captured, self.control.mapping())
        self.provider.created['distribution']['DistributionConfig'] = copy.deepcopy(original)
        expected = copy.deepcopy(original)
        expected['Enabled'] = True
        directory, hash = self.package('publish')
        planned = json.loads((directory / 'plan.json').read_bytes())
        self.assertEqual(expected, planned['documents']['distribution.json'])
        self.assertEqual(original, planned['before']['inventory']['distribution_config']['DistributionConfig'])
        self.assertEqual(original, self.provider.created['distribution']['DistributionConfig'])
        self.control.publish(self.control.approved(directory, hash, 'publish'))
        self.assertEqual({'DistributionConfig': expected}, self.provider.update_documents[-1])
        self.assertFalse(expected['DefaultCacheBehavior']['SmoothStreaming'])
        self.assertEqual(original['ViewerCertificate'], expected['ViewerCertificate'])
        self.assertEqual(original['Origins'], expected['Origins'])
        self.assertEqual(original['CustomErrorResponses'], expected['CustomErrorResponses'])

    def test_rejected_update_preserves_grant_and_fresh_partial_plan_skips_policy_write(self):
        self.apply('bootstrap')
        original_policy = copy.deepcopy(self.provider.policy)
        original_config = copy.deepcopy(self.provider.created['distribution']['DistributionConfig'])
        fingerprint = self.control.state['fingerprint']
        directory, hash = self.package('publish')
        packet = self.control.approved(directory, hash, 'publish')
        self.provider.reject_next_update = True
        with self.assertRaisesRegex(cdn.Refusal, 'InvalidArgument'):
            self.control.publish(packet)
        self.assertEqual(packet['documents']['bucket-policy.after.json'], self.provider.policy)
        self.assertEqual(original_policy['Statement'], self.provider.policy['Statement'][:-1])
        self.assertEqual(original_config, self.provider.created['distribution']['DistributionConfig'])
        self.assertEqual(1, sum(c['op'] == 'put-bucket-policy' for c in self.provider.mutations()))
        fresh_directory, fresh_hash = self.package('publish')
        self.assertNotEqual(hash, fresh_hash)
        fresh = self.control.approved(fresh_directory, fresh_hash, 'publish')
        self.assertEqual(fresh['before']['bucket_policy'], fresh['documents']['bucket-policy.after.json'])
        self.control.publish(fresh)
        self.assertEqual(1, sum(c['op'] == 'put-bucket-policy' for c in self.provider.mutations()))
        self.assertEqual(1, sum(c['op'] == 'create-distribution-with-tags' for c in self.provider.mutations()))
        self.assertEqual(fingerprint, self.control.state['fingerprint'])
        self.assertTrue(self.provider.created['distribution']['DistributionConfig']['Enabled'])

    def test_canned_signature_matches_existing_node_policy_order(self):
        import base64
        from urllib.parse import parse_qs, urlsplit
        self.apply('bootstrap')
        url = cdn.signed_url(self.control, 'gold/ebooks/epub/aa/' + 'a' * 64 + '/file.epub', 2000000000)
        parts = urlsplit(url)
        query = parse_qs(parts.query)
        self.assertEqual(['NEW-public_key'], query['Key-Pair-Id'])
        signature = base64.b64decode(query['Signature'][0].translate(str.maketrans('-_~', '+=/')))
        policy = json.dumps({'Statement': [{'Resource': url.split('?')[0], 'Condition': {'DateLessThan': {'AWS:EpochTime': 2000000000}}}]}, separators=(',', ':')).encode()
        public, signed = self.base / 'public.pem', self.base / 'signature.bin'
        public.write_text(self.control.state['public_pem'])
        signed.write_bytes(signature)
        verify = subprocess.run(['openssl', 'dgst', '-sha1', '-verify', str(public), '-signature', str(signed)], input=policy, capture_output=True)
        self.assertEqual(0, verify.returncode)

    def test_ambiguous_unowned_resource_not_adopted(self):
        self.provider.created['oac'] = {'Id': 'unowned', 'OriginAccessControlConfig': {'Name': 'durtal-ebooks'}}
        with self.assertRaises(cdn.Refusal):
            self.package('bootstrap')
        self.assertEqual([], self.provider.mutations())

    def test_failed_create_resumes_same_fingerprint_without_duplicate(self):
        directory, hash = self.package('bootstrap')
        packet = self.control.approved(directory, hash, 'bootstrap')
        self.provider.fail_after = 'create-origin-access-control'
        with self.assertRaises(cdn.Refusal):
            self.control.bootstrap(packet, self.email)
        fingerprint = self.control.state['fingerprint']
        again = cdn.Control(self.aws, self.base / 'state', self.secrets)
        packet = again.approved(directory, hash, 'bootstrap')
        again.bootstrap(packet, self.email)
        self.assertEqual(fingerprint, again.state['fingerprint'])
        self.assertEqual(1, len([c for c in self.provider.mutations() if c['op'] == 'create-origin-access-control']))

    def test_lost_function_create_response_finishes_recovery_and_publish_plan(self):
        directory, hash = self.package('bootstrap')
        packet = self.control.approved(directory, hash, 'bootstrap')
        self.provider.fail_after = 'create-function'
        with self.assertRaises(cdn.Refusal):
            self.control.bootstrap(packet, self.email)
        self.assertIn('function', self.control.state['pending'])
        self.assertNotIn('function', self.control.state['resources'])
        self.control = cdn.Control(self.aws, self.base / 'state', self.secrets)
        self.control.bootstrap(self.control.approved(directory, hash, 'bootstrap'), self.email)
        self.assertNotIn('function', self.control.state['pending'])
        self.assertEqual(cdn.NAMES['function'], self.control.state['resources']['function'])
        self.assertEqual(1, sum(c['op'] == 'create-function' for c in self.provider.mutations()))
        self.package('publish')

    def test_live_function_drift_blocks_plan_approval_publish_and_verification(self):
        self.apply('bootstrap')
        directory, hash = self.package('publish')
        packet = self.control.approved(directory, hash, 'publish')
        for field, value in (('live_code', b'function handler(e) { return e.request; }'),
                             ('live_config', {'Comment': 'foreign', 'Runtime': 'cloudfront-js-2.0'}),
                             ('live', False), ('live_etag', 'different-live-version')):
            with self.subTest(field=field):
                original = getattr(self.provider, field)
                setattr(self.provider, field, value)
                mutations = len(self.provider.mutations())
                if field != 'live_etag':
                    with self.assertRaises(cdn.Refusal):
                        self.package('publish')
                with self.assertRaises(cdn.Refusal):
                    self.control.approved(directory, hash, 'publish')
                with self.assertRaises(cdn.Refusal):
                    self.control.publish(packet)
                self.assertEqual(mutations, len(self.provider.mutations()))
                setattr(self.provider, field, original)
        self.apply('publish')
        self.apply('budget')
        self.provider.live_code = b'foreign-live-code'
        with self.assertRaises(cdn.Refusal):
            self.control.verify()

    def test_published_function_inventory_uses_exact_development_stage(self):
        self.apply('bootstrap')
        listed = self.aws.call('cloudfront', 'list-functions')['FunctionList']['Items']
        self.assertEqual(['DEVELOPMENT', 'LIVE'], [x['FunctionMetadata']['Stage'] for x in listed])
        self.assertEqual(1, len({x['FunctionMetadata']['FunctionARN'] for x in listed}))
        self.package('publish')
        calls = [c for c in self.provider.calls if c['op'] == 'list-functions' and '--stage' in c['args']]
        self.assertTrue(calls)
        self.assertTrue(all(c['args'][c['args'].index('--stage') + 1] == 'DEVELOPMENT' for c in calls))
        mutations = len(self.provider.mutations())
        self.provider.duplicate_development_function = True
        with self.assertRaisesRegex(cdn.Refusal, 'Ambiguous resource namespace'):
            self.package('publish')
        self.assertEqual(mutations, len(self.provider.mutations()))

    def test_function_list_and_describe_identity_stage_mismatch_refused(self):
        self.apply('bootstrap')
        original = self.provider.run
        mutations = len(self.provider.mutations())
        for operation, stage in (('list-functions', 'DEVELOPMENT'), ('describe-function', 'DEVELOPMENT'),
                                 ('describe-function', 'LIVE')):
            for field, value in (('FunctionARN', 'arn:aws:cloudfront::999999999999:function/' + cdn.NAMES['function']),
                                 ('FunctionARN', 'arn:aws:cloudfront::' + ACCOUNT + ':function/other'),
                                 ('Stage', 'LIVE' if stage == 'DEVELOPMENT' else 'DEVELOPMENT'),
                                 ('Stage', None)):
                with self.subTest(operation=operation, stage=stage, field=field, value=value):
                    def corrupted(args, **kwargs):
                        response = original(args, **kwargs)
                        if args[2] == operation and args[args.index('--stage') + 1] == stage:
                            data = json.loads(response.stdout)
                            summary = data['FunctionList']['Items'][0] if operation == 'list-functions' else data['FunctionSummary']
                            summary['FunctionMetadata'][field] = value
                            response.stdout = json.dumps(data).encode()
                        return response
                    self.aws.run = corrupted
                    with self.assertRaisesRegex(cdn.Refusal, 'function identity/stage changed'):
                        self.package('publish')
                    self.assertEqual(mutations, len(self.provider.mutations()))
        self.aws.run = original

    def test_function_stage_hash_config_and_etags_are_bound_in_plan(self):
        self.apply('bootstrap')
        directory, hash = self.package('publish')
        packet = json.loads((directory / 'plan.json').read_bytes())
        stages = packet['before']['inventory']['function_stages']
        self.assertEqual({'DEVELOPMENT', 'LIVE'}, stages.keys())
        for stage in stages.values():
            self.assertEqual(cdn.file_hash(cdn.TEMPLATES / 'viewer-request.js'), stage['sha256'])
            self.assertEqual(self.control.documents()['function-config.json'], stage['FunctionConfig'])
            self.assertTrue(stage['ETag'])

    def test_filtered_adjusted_budget_and_unknown_fields_fail_verification(self):
        self.apply('bootstrap')
        self.apply('publish')
        self.apply('budget')
        original = copy.deepcopy(self.provider.budget)
        for key, value in (('CostFilters', {'Service': ['Amazon Simple Storage Service']}),
                           ('FilterExpression', {'Dimensions': {'Key': 'SERVICE', 'Values': ['S3']}}),
                           ('AutoAdjustData', {'AutoAdjustType': 'FORECAST'}),
                           ('PlannedBudgetLimits', {'2000000000': {'Amount': '5', 'Unit': 'USD'}}),
                           ('BillingViewArn', 'arn:aws:billing::111122223333:billingview/foreign'),
                           ('Metrics', ['BlendedCost']), ('UnexpectedProviderField', True),
                           ('TimePeriod', {'Start': 0, 'End': 2000000000}),
                           ('TimePeriod', {'Start': 0, 'End': 3706473600})):
            with self.subTest(key=key):
                self.provider.budget = {**copy.deepcopy(original), key: value}
                with self.assertRaises(cdn.Refusal):
                    self.control.verify_budget()
        self.provider.budget = original
        self.provider.budget.pop('CostFilters')
        self.provider.budget.update(CalculatedSpend={'ActualSpend': {'Amount': '1', 'Unit': 'USD'}},
                                   LastUpdatedTime=2000000000,
                                   TimePeriod={'Start': self.control.state['budget_start'], 'End': 3706473600.0})
        self.control.verify_budget()
        self.assertFalse(cdn.equivalent({}, {'Service': ['S3']}))

    def test_aws_empty_security_header_defaults_match_without_writes(self):
        self.apply('bootstrap')
        actual = self.provider.created['headers']['ResponseHeadersPolicyConfig']
        security = actual['SecurityHeadersConfig']
        for field in ('XSSProtection', 'FrameOptions', 'ReferrerPolicy',
                      'ContentSecurityPolicy', 'StrictTransportSecurity'):
            security[field] = {}
        wanted = self.control.documents()['response-headers-policy.json']
        before = copy.deepcopy(actual)
        self.assertFalse(cdn.equivalent(wanted, actual))
        self.assertTrue(cdn.headers_matches(wanted, actual))
        self.assertEqual(before, actual)
        self.package('bootstrap')
        mutations = len(self.provider.mutations())
        self.apply('bootstrap')
        self.assertEqual(mutations, len(self.provider.mutations()))
        self.apply('publish')
        self.apply('budget')
        self.assertEqual('matches', self.control.verify()['infrastructure'])

    def test_populated_unknown_and_changed_header_controls_still_refused(self):
        self.apply('bootstrap')
        original = copy.deepcopy(self.provider.created['headers']['ResponseHeadersPolicyConfig'])
        additions = [('XSSProtection', {'Protection': False, 'Override': True}),
                     ('FrameOptions', {'FrameOption': 'DENY', 'Override': True}),
                     ('ReferrerPolicy', {'ReferrerPolicy': 'no-referrer', 'Override': True}),
                     ('ContentSecurityPolicy', {'ContentSecurityPolicy': "default-src 'none'", 'Override': True}),
                     ('StrictTransportSecurity', {'AccessControlMaxAgeSec': 86400, 'Override': True}),
                     ('UnknownSecurityControl', {}), ('XSSProtection', None)]
        for key, value in additions:
            with self.subTest(key=key, value=value):
                actual = copy.deepcopy(original)
                actual['SecurityHeadersConfig'][key] = value
                self.provider.created['headers']['ResponseHeadersPolicyConfig'] = actual
                with self.assertRaises(cdn.Refusal):
                    self.package('bootstrap')
        for section, field, value in (('SecurityHeadersConfig', 'ContentTypeOptions', {}),
                                      ('SecurityHeadersConfig', 'ContentTypeOptions', {'Override': False}),
                                      ('CorsConfig', 'AccessControlAllowCredentials', True),
                                      ('CorsConfig', 'AccessControlAllowHeaders', {'Quantity': 2, 'Items': ['Range', 'Authorization']})):
            actual = copy.deepcopy(original)
            actual[section][field] = value
            self.provider.created['headers']['ResponseHeadersPolicyConfig'] = actual
            with self.assertRaises(cdn.Refusal):
                self.package('bootstrap')
        self.provider.created['headers']['ResponseHeadersPolicyConfig'] = original

    def test_distribution_only_normalizes_explicit_defaults(self):
        self.apply('bootstrap')
        config = self.provider.created['distribution']['DistributionConfig']
        config.update(OriginGroups={'Quantity': 0, 'Items': []}, Staging=False,
                      ContinuousDeploymentPolicyId='')
        config['Origins']['Items'][0]['OriginShield'] = {'Enabled': False}
        config['Origins']['Items'][0]['S3OriginConfig']['OriginReadTimeout'] = 30
        config['DefaultCacheBehavior'].update(SmoothStreaming=False, FieldLevelEncryptionId='')
        config['ViewerCertificate'].update(MinimumProtocolVersion='TLSv1', CertificateSource='cloudfront')
        self.package('publish')
        self.apply('publish')
        self.apply('budget')
        self.assertEqual('matches', self.control.verify()['infrastructure'])
        baseline = copy.deepcopy(self.provider.created['distribution']['DistributionConfig'])
        def shield(c):
            c['Origins']['Items'][0]['OriginShield'] = {'Enabled': True, 'OriginShieldRegion': 'us-east-1'}
        def origin_timeout(c):
            c['Origins']['Items'][0]['S3OriginConfig']['OriginReadTimeout'] = 60
        def behavior(c):
            c['DefaultCacheBehavior']['RealtimeLogConfigArn'] = 'arn:foreign'
        def certificate(c):
            c['ViewerCertificate']['SSLSupportMethod'] = 'static-ip'
        for mutate in (shield, origin_timeout, behavior, certificate,
                       lambda c: c.update(Staging=True), lambda c: c.update(Unexpected=True)):
            changed = copy.deepcopy(baseline)
            mutate(changed)
            self.provider.created['distribution']['DistributionConfig'] = changed
            with self.assertRaises(cdn.Refusal):
                self.control.verify()
        self.provider.created['distribution']['DistributionConfig'] = baseline

    def test_captured_distribution_defaults_validate_and_resume_without_recreation(self):
        self.apply('bootstrap')
        captured = json.loads((ROOT / 'scripts/qa/fixtures/ebooks-cdn-distribution-config.json').read_bytes())
        actual = cdn.substitute(captured, self.control.mapping())
        wanted = self.control.documents()['distribution.json']
        original = copy.deepcopy(actual)
        self.assertFalse(cdn.equivalent(wanted, actual))
        self.assertTrue(cdn.distribution_matches(wanted, actual))
        self.assertEqual(original, actual)
        self.provider.created['distribution']['DistributionConfig'] = actual
        mutations = len(self.provider.mutations())
        self.apply('bootstrap')
        self.assertEqual(mutations, len(self.provider.mutations()))
        self.assertEqual(1, sum(c['op'] == 'create-distribution-with-tags' for c in self.provider.mutations()))
        self.apply('publish')
        self.apply('budget')
        self.assertEqual('matches', self.control.verify()['infrastructure'])

    def test_nondefault_grpc_errors_certificate_and_unknown_config_still_refused(self):
        self.apply('bootstrap')
        baseline = copy.deepcopy(self.provider.created['distribution']['DistributionConfig'])
        changes = [lambda c: c['DefaultCacheBehavior'].update(GrpcConfig={'Enabled': True}),
                   lambda c: c['DefaultCacheBehavior'].update(GrpcConfig={'Enabled': False, 'Unknown': ''}),
                   lambda c: c['CustomErrorResponses']['Items'][0].update(ResponseCode='200'),
                   lambda c: c['CustomErrorResponses']['Items'][0].update(ResponsePagePath='/error.html'),
                   lambda c: c['CustomErrorResponses']['Items'][0].update(ErrorCachingMinTTL=60),
                   lambda c: c['CustomErrorResponses']['Items'][0].update(Unknown=''),
                   lambda c: c['ViewerCertificate'].update(CloudFrontDefaultCertificate=False),
                   lambda c: c['ViewerCertificate'].update(ACMCertificateArn='arn:foreign'),
                   lambda c: c['ViewerCertificate'].update(IAMCertificateId='foreign'),
                   lambda c: c['ViewerCertificate'].update(Certificate='foreign'),
                   lambda c: c['ViewerCertificate'].update(CertificateSource='acm'),
                   lambda c: c['ViewerCertificate'].update(SSLSupportMethod='sni-only'),
                   lambda c: c['ViewerCertificate'].update(SSLSupportMethod='static-ip'),
                   lambda c: c.update(Aliases={'Quantity': 1, 'Items': ['foreign.invalid']}),
                   lambda c: c.update(Unknown={})]
        mutations = len(self.provider.mutations())
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                actual = copy.deepcopy(baseline)
                change(actual)
                self.assertFalse(cdn.distribution_matches(self.control.documents()['distribution.json'], actual))
                self.provider.created['distribution']['DistributionConfig'] = actual
                with self.assertRaisesRegex(cdn.Refusal, 'distribution topology drifted'):
                    self.package('bootstrap')
                self.assertEqual(mutations, len(self.provider.mutations()))
        self.provider.created['distribution']['DistributionConfig'] = baseline

    def test_reviewed_budget_notification_subscriber_drift_blocks_old_plan(self):
        self.apply('bootstrap')
        self.apply('budget')
        directory, hash = self.package('budget')
        packet = self.control.approved(directory, hash, 'budget')
        self.provider.notes.pop()
        self.provider.notes[0]['Subscribers'] = []
        mutations = len(self.provider.mutations())
        with self.assertRaises(cdn.Refusal):
            self.control.approved(directory, hash, 'budget')
        with self.assertRaises(cdn.Refusal):
            self.control.budget(packet)
        self.assertEqual(mutations, len(self.provider.mutations()))
        # New plan concretely approves repairing the observed missing entries.
        self.apply('budget')
        self.control.verify_budget()

    def test_unconfirmed_budget_create_requires_causal_ownership_recovery(self):
        self.apply('bootstrap')
        directory, hash = self.package('budget')
        packet = self.control.approved(directory, hash, 'budget')
        self.provider.fail_after = 'create-budget'
        with self.assertRaises(cdn.Refusal):
            self.control.budget(packet)
        ledger = (self.base / 'state/state.json').read_bytes()
        self.control = cdn.Control(self.aws, self.base / 'state', self.secrets)
        mutations = len(self.provider.mutations())
        with self.assertRaisesRegex(cdn.Refusal, 'ownership recovery'):
            self.control.budget(self.control.approved(directory, hash, 'budget'))
        self.assertEqual(mutations, len(self.provider.mutations()))
        self.assertEqual(ledger, (self.base / 'state/state.json').read_bytes())
        self.assertEqual(1, sum(c['op'] == 'create-budget' for c in self.provider.mutations()))
        self.provider.notes.pop()
        self.provider.notes[0]['Subscribers'] = []
        with self.assertRaises(cdn.Refusal):
            self.control.approved(directory, hash, 'budget')
        self.assertEqual(mutations, len(self.provider.mutations()))
        self.assertEqual(ledger, (self.base / 'state/state.json').read_bytes())
        self.assertNotIn(self.email, ledger)

    def test_confirmed_budget_step_cannot_authorize_external_rollback(self):
        self.apply('bootstrap')
        self.apply('budget')
        removed = self.provider.notes.pop()
        directory, hash = self.package('budget')
        packet = self.control.approved(directory, hash, 'budget')
        self.control.budget(packet)
        self.assertTrue(self.control.state['budget_progress']['steps'][-1]['confirmed'])
        self.provider.notes = [n for n in self.provider.notes if n['Notification'] != removed['Notification']]
        mutations = len(self.provider.mutations())
        with self.assertRaises(cdn.Refusal):
            self.control.approved(directory, hash, 'budget')
        with self.assertRaises(cdn.Refusal):
            self.control.budget(packet)
        self.assertEqual(mutations, len(self.provider.mutations()))

    def test_lost_notification_response_is_held_without_duplicate_or_journal_rewrite(self):
        self.apply('bootstrap')
        self.apply('budget')
        self.provider.notes.pop()
        directory, hash = self.package('budget')
        packet = self.control.approved(directory, hash, 'budget')
        self.provider.fail_after = 'create-notification'
        with self.assertRaises(cdn.Refusal):
            self.control.budget(packet)
        self.assertFalse(self.control.state['budget_progress']['steps'][-1]['confirmed'])
        ledger = (self.base / 'state/state.json').read_bytes()
        self.control = cdn.Control(self.aws, self.base / 'state', self.secrets)
        mutations = len(self.provider.mutations())
        with self.assertRaisesRegex(cdn.Refusal, 'ownership recovery'):
            self.control.budget(self.control.approved(directory, hash, 'budget'))
        self.assertFalse(self.control.state['budget_progress']['steps'][-1]['confirmed'])
        self.assertEqual(1, sum(c['op'] == 'create-notification' for c in self.provider.mutations()))
        self.assertEqual(mutations, len(self.provider.mutations()))
        self.assertEqual(ledger, (self.base / 'state/state.json').read_bytes())

    def test_captured_aws_function_output_envelopes_match_exact_values(self):
        fixtures = json.loads((ROOT / 'scripts/qa/fixtures/ebooks-cdn-function-output.json').read_bytes())
        for item in fixtures:
            with self.subTest(case=item['case']):
                self.assertTrue(cdn.edge_test_output_matches(item['output'], item['event']['request'], item['expectedStatus']))
        request = fixtures[0]['event']['request']
        signed = copy.deepcopy(request)
        signed['querystring'] = {'Expires': {'value': '2000000000'},
                                'Key-Pair-Id': {'value': 'FAKE'}, 'Signature': {'value': 'fixture'}}
        self.assertTrue(cdn.edge_test_output_matches({'request': signed}, signed, 0))
        changed = copy.deepcopy(signed)
        changed['querystring']['Signature']['value'] = 'changed'
        self.assertFalse(cdn.edge_test_output_matches({'request': changed}, signed, 0))

    def test_function_envelope_and_preflight_corruption_are_refused(self):
        fixtures = json.loads((ROOT / 'scripts/qa/fixtures/ebooks-cdn-function-output.json').read_bytes())
        request, output = fixtures[0]['event']['request'], fixtures[0]['output']
        for corrupt in (request, {'response': request}, {'request': request, 'response': {}},
                        {'request': {**request, 'uri': '/gold/media/cover.webp'}},
                        {'request': {**request, 'headers': {'authorization': {'value': 'unexpected'}}}}):
            self.assertFalse(cdn.edge_test_output_matches(corrupt, request, 0))
        preflight = fixtures[2]
        for key, value in (('statusCode', 200), ('statusDescription', 'OK'),
                           ('cookies', {'unexpected': {'value': 'cookie'}}), ('body', 'unexpected')):
            corrupt = copy.deepcopy(preflight['output'])
            corrupt['response'][key] = value
            self.assertFalse(cdn.edge_test_output_matches(corrupt, preflight['event']['request'], 204))
        for key, value in (('access-control-allow-origin', 'https://unexpected.invalid'),
                           ('access-control-allow-methods', 'GET, HEAD, OPTIONS, POST'),
                           ('access-control-allow-headers', 'Range, Authorization'),
                           ('access-control-max-age', '1')):
            corrupt = copy.deepcopy(preflight['output'])
            corrupt['response']['headers'][key]['value'] = value
            self.assertFalse(cdn.edge_test_output_matches(corrupt, preflight['event']['request'], 204))
        denied = fixtures[3]
        corrupt = copy.deepcopy(denied['output'])
        corrupt['response']['statusCode'] = 204
        self.assertFalse(cdn.edge_test_output_matches(corrupt, denied['event']['request'], 403))

    def test_edge_failure_prevents_publish_and_distribution_create(self):
        self.provider.fail_edge = True
        directory, hash = self.package('bootstrap')
        packet = self.control.approved(directory, hash, 'bootstrap')
        with self.assertRaises(cdn.Refusal):
            self.control.bootstrap(packet, self.email)
        self.assertFalse(self.provider.live)
        self.assertNotIn('distribution', self.provider.created)

    def test_subscriber_mismatch_never_overwritten_and_never_saved(self):
        self.apply('bootstrap')
        self.apply('publish')
        self.apply('budget')
        self.provider.notes[0]['Subscribers'].append({'SubscriptionType': 'EMAIL', 'Address': 'different@example.invalid'})
        directory, hash = self.package('budget')
        packet = self.control.approved(directory, hash, 'budget')
        before = len(self.provider.mutations())
        with self.assertRaises(cdn.Refusal):
            self.control.budget(packet)
        self.assertEqual(before, len(self.provider.mutations()))
        self.assertNotIn(b'different@example.invalid', (directory / 'plan.json').read_bytes())

    def test_state_binding_and_symlink_and_permissions_refused(self):
        self.apply('bootstrap')
        with self.assertRaises(cdn.Refusal):
            cdn.Control(cdn.Aws('444455556666', 'arn:aws:iam::444455556666:role/Other', self.provider.run), self.base / 'state', self.secrets)
        link = self.base / 'link'
        link.symlink_to(self.base / 'state')
        with self.assertRaises(cdn.Refusal):
            cdn.Control(self.aws, link, self.secrets)
        os.chmod(self.base / 'state/state.json', 0o644)
        with self.assertRaises(cdn.Refusal):
            cdn.Control(self.aws, self.base / 'state', self.secrets)

    def test_unapproved_phase_cannot_provision_keychain(self):
        with self.assertRaises(cdn.Refusal):
            self.control.bootstrap({'phase': 'bootstrap'}, self.email)
        with self.assertRaises(cdn.Refusal):
            self.control.generate_key()
        self.assertEqual([], self.secrets.writes)
        self.assertEqual([], self.provider.mutations())

    def test_source_changed_after_approval_stops_phase_before_secret_write(self):
        directory, hash = self.package('bootstrap')
        packet = self.control.approved(directory, hash, 'bootstrap')
        with patch.object(cdn, 'source_binding', return_value={'changed': 'hash'}):
            with self.assertRaises(cdn.Refusal):
                self.control.bootstrap(packet, self.email)
        self.assertEqual([], self.secrets.writes)
        self.assertEqual([], self.provider.mutations())

    def test_scoped_oac_resources_exclude_unpublished_domains(self):
        resources = self.control.documents()['cloudfront-bucket-statement.json']['Resource']
        self.assertEqual(112, len(resources))
        for resource in resources:
            self.assertTrue(resource.startswith('arn:aws:s3:::durtal/gold/ebooks/') or resource.startswith('arn:aws:s3:::durtal/files/') or resource.startswith('arn:aws:s3:::durtal/derived/'))
            self.assertNotEqual('arn:aws:s3:::durtal/*', resource)
            self.assertNotIn('/bronze/', resource)
            self.assertNotIn('/silver/', resource)
            self.assertNotIn('/media/', resource)

    def test_provider_output_suppressed(self):
        self.provider.deny = 'get-bucket-policy'
        with self.assertRaises(cdn.AwsError) as error:
            self.package('bootstrap')
        self.assertNotIn('secret@example.invalid', str(error.exception))


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/private/tmp')
        self.root = Path(self.temp.name)
        self.pair = 'AWS_ACCESS_KEY_ID=AKIA' + 'A' * 16 + '\nAWS_SECRET_ACCESS_KEY=existing-pair\n'
        (self.root / '.env').write_text(self.pair + 'DATABASE_URL=base\nADMIN_TOKEN=base\nAWS_PROFILE=forbidden\nUNRELATED_SECRET=excluded\n')
        (self.root / '.env.local').write_text('DATABASE_URL="local\\nvalue"\nDURTAL_API_TOKEN=literal$(never-run)\n')
        self.store = MemorySecrets()

    def tearDown(self):
        self.temp.cleanup()

    def iam_run(self, args, env, capture_output):
        self.assertNotIn('AWS_PROFILE', env)
        self.assertNotIn('AWS_ENDPOINT_URL', env)
        self.assertEqual('/dev/null', env['AWS_CONFIG_FILE'])
        self.assertEqual('/dev/null', env['AWS_SHARED_CREDENTIALS_FILE'])
        self.assertNotIn('--profile', args)
        self.assertNotIn('existing-pair', repr(args))
        return types.SimpleNamespace(returncode=0, stdout=json.dumps({'Account': ACCOUNT, 'Arn': 'arn:aws:iam::' + ACCOUNT + ':user/durtal-app'}).encode())

    def test_allowlist_local_precedence_no_execution_immutable_owner_files(self):
        before = {p.name: p.read_bytes() for p in self.root.iterdir()}
        values, sources = secrets.import_values(self.root)
        self.assertEqual('local\nvalue', values['DATABASE_URL'])
        self.assertEqual('literal$(never-run)', values['DURTAL_API_TOKEN'])
        self.assertNotIn('AWS_PROFILE', values)
        self.assertNotIn('UNRELATED_SECRET', values)
        hash = secrets.import_plan(values, sources, ACCOUNT)
        with patch.dict(os.environ, {'AWS_PROFILE': 'forbidden', 'AWS_ENDPOINT_URL': 'https://forbidden.invalid'}):
            result = secrets.import_once(self.root, ACCOUNT, hash, self.store, self.iam_run)
        self.assertEqual(set(values), set(result))
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.root.iterdir()})
        self.assertEqual(values, secrets.runtime_environment(values.keys(), ACCOUNT, self.store, self.iam_run))

    def test_changed_source_or_wrong_runtime_identity_prevents_all_writes(self):
        values, sources = secrets.import_values(self.root)
        hash = secrets.import_plan(values, sources, ACCOUNT)
        with self.assertRaises(secrets.SecretError):
            secrets.import_once(self.root, ACCOUNT, '0' * 64, self.store, self.iam_run)
        wrong = lambda *a, **k: types.SimpleNamespace(returncode=0, stdout=json.dumps({'Account': ACCOUNT, 'Arn': 'arn:aws:sts::' + ACCOUNT + ':assumed-role/Admin/session'}).encode())
        with self.assertRaises(secrets.SecretError):
            secrets.import_once(self.root, ACCOUNT, hash, self.store, wrong)
        self.assertEqual([], self.store.writes)

    def test_session_pair_and_existing_conflict_refused(self):
        with (self.root / '.env.local').open('a') as target:
            target.write('AWS_SESSION_TOKEN=must-not-import\n')
        with self.assertRaises(secrets.SecretError):
            secrets.import_values(self.root)
        (self.root / '.env.local').write_text('DATABASE_URL=local\n')
        values, sources = secrets.import_values(self.root)
        self.store.values[(secrets.RUNTIME_PREFIX + 'DATABASE_URL', ACCOUNT)] = b'different'
        hash = secrets.import_plan(values, sources, ACCOUNT)
        with self.assertRaises(secrets.SecretError):
            secrets.import_once(self.root, ACCOUNT, hash, self.store, self.iam_run)
        self.assertEqual([], self.store.writes)

    def test_capability_scope_excludes_unselected_env_and_unrelated_services(self):
        helper = object.__new__(secrets.Keychain)
        helper.runtime_names, helper.budget, helper.signing = frozenset(['DATABASE_URL']), False, False
        helper._scope(secrets.RUNTIME_PREFIX + 'DATABASE_URL', ACCOUNT)
        for service in (secrets.EMAIL_SERVICE, secrets.KEY_SERVICE, secrets.RUNTIME_PREFIX + 'AWS_SECRET_ACCESS_KEY', 'unrelated-service'):
            with self.assertRaises(secrets.SecretError):
                helper._scope(service, ACCOUNT)


if __name__ == '__main__':
    unittest.main()
