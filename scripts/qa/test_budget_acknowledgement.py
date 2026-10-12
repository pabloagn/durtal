"""Repository acknowledgement fixtures only. No AWS, owner files or Keychain.

Future execution requires root's offline slot grant. Synthetic process fixtures
exercise pipe/deadline cleanup; all budget identity/secret responses are mocks.
"""
import copy
import io
import signal
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts/aws' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

cdn = load('ack_cdn_test', 'ebooks-cdn.py')
ack = load('ack_test', 'budget-acknowledgement.py')
ACCOUNT = '608240934043'
ADMIN = 'arn:aws:iam::608240934043:role/aws-reserved/sso.amazonaws.com/eu-north-1/AWSReservedSSO_AdministratorAccess_3edaaa0f75b46e2f'


class AcknowledgementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/private/tmp' if sys.platform == 'darwin' else '/tmp')
        self.root = Path(self.temp.name)
        self.state_dir = self.root / 'state'; self.state_dir.mkdir(mode=0o700)
        self.state = self.state_dir / 'state.json'; self.folder = self.root / 'receipt'
        self.email = b'intended-owner@example.invalid'
        self.binding = {'account': ACCOUNT, 'admin': ADMIN, 'profile': cdn.PROFILE, 'region': cdn.REGION, 'bucket': cdn.BUCKET}
        initial = {'binding': self.binding, 'budget_start': 1790812800, 'resources': {'unchanged': 'owned-resource'}, 'pending': ['budget']}
        self.write(self.state, initial)
        model = cdn.Control(SimpleNamespace(account=ACCOUNT, admin=ADMIN), self.state_dir)
        docs = model.documents(); self.documents = {n: docs[n] for n in ('budget.json', 'budget-notifications.json')}
        self.notes = [cdn.notification_config(x['Notification']) for x in docs['budget-notifications.json']]
        after = {'budget': cdn.budget_config(docs['budget.json']), 'notifications': cdn.notification_preimage([
            {'Notification': n, 'Subscribers': [{'SubscriptionType': 'EMAIL', 'Address': '__ALERT_EMAIL_FROM_KEYCHAIN__'}]} for n in self.notes])}
        initial['budget_progress'] = {'plan_sha256': ack.ORIGINAL_PLAN_SHA,
            'steps': [{'before': {'budget': None, 'notifications': []}, 'after': after, 'confirmed': False}]}
        self.write(self.state, initial)
        self.before = self.state.read_bytes(); self.info = self.state.stat()
        final = copy.deepcopy(initial); final['budget_progress']['steps'][0]['confirmed'] = True
        final['budget_owned'] = True; final['pending'] = []
        self.after = json.dumps(final, indent=2, sort_keys=True, allow_nan=False).encode() + b'\n'
        # Synthetic causal/failure references exercise the full predicate; test
        # constants are scoped shims, never actual root evidence or a grant.
        causal = self.root / 'causal.json'; self.write(causal, {'immutable_bindings': {'original_plan_canonical_sha256': ack.ORIGINAL_PLAN_SHA,
            'original_plan_account_profile_region_admin': self.binding}})
        journal = self.root / 'historic.json'; journal.write_bytes(self.before); journal.chmod(0o600)
        failures = []
        for name in ('failed43', 'failed1'):
            f = self.root / (name + '.json'); self.write(f, {'fixture': name, 'accepted': False}); failures.append(f)
        self.contract_patches = patch.multiple(ack, CAUSAL_SHA=ack.sha(causal.read_bytes()),
            ORIGINAL_JOURNAL_SHA=ack.sha(self.before), FAILED_NATIVE_SHAS=frozenset(ack.sha(f.read_bytes()) for f in failures))
        self.contract_patches.start(); self.addCleanup(self.contract_patches.stop)
        executable = self.root / 'never-executed-tool'; executable.write_text('fixture'); executable.chmod(0o700)
        def pin(p): return {'path': str(p), 'sha256': ack.sha(p.read_bytes())}
        self.payload = {'version': 1, 'contract': ack.CONTRACT, 'binding': self.binding,
            'source': {'root': str(cdn.ROOT), 'head': 'a' * 40, 'files': cdn.source_binding()},
            'tools': {'python': pin(Path(sys.executable).resolve()), 'git': pin(executable), 'aws': pin(executable),
                'aws_interpreter': pin(Path(sys.executable).resolve())},
            'causal': {'accepted_contract_sha256': ack.CAUSAL_SHA, 'original_plan_canonical_sha256': ack.ORIGINAL_PLAN_SHA,
                'old_plan_evidence_only_never_execute': True, 'ownership_premise_only': True},
            'references': [pin(f) for f in (causal, journal, *failures)],
            'ledger': {'path': str(self.state), 'device': self.info.st_dev, 'inode': self.info.st_ino,
                'preimage_sha256': ack.sha(self.before), 'original_step': initial['budget_progress']['steps'][0],
                'expected_after': final, 'after_sha256': ack.sha(self.after)},
            'receipt_directory': str(self.folder), 'intended_documents': self.documents,
            'intended_notifications': self.notes, 'helper_sha256': ack.sha(Path(ack.__file__).read_bytes()),
            'supersedes_private_admission': 'budget-create-local-journal-only'}
        self.args = SimpleNamespace(expected_account=ACCOUNT, admin_arn=ADMIN, state_dir=self.state_dir,
            acknowledgement_payload=self.root / 'payload.json', root_grant=self.root / 'grant.json',
            acknowledge_reviewed_budget_create=True)
        self.refresh_grant()
        self.calls, self.closes, self.keychain_options = [], [], []
        outer = self
        class Store:
            def get(self, service, account):
                outer.assertEqual((service, account), (cdn.EMAIL_SERVICE, ACCOUNT)); return outer.email
            def close(self): outer.closes.append(True)
        def keychain(**kwargs): self.keychain_options.append(kwargs); return Store()
        self.secret_module = SimpleNamespace(Keychain=keychain)
        self.budget_rounds = 0
        self.mutate = None

    def tearDown(self): self.temp.cleanup()

    def write(self, path, value):
        path.write_bytes(json.dumps(value, sort_keys=True, indent=2).encode() + b'\n'); path.chmod(0o600)

    def refresh_grant(self):
        self.write(self.args.acknowledgement_payload, self.payload)
        self.args.approved_acknowledgement_sha256 = ack.sha(ack.canonical(self.payload))
        review = {'decision': ack.REVIEW_DECISION, 'contract': ack.CONTRACT,
            'payload_sha256': self.args.approved_acknowledgement_sha256, 'helper_sha256': self.payload['helper_sha256'],
            'supersedes_private_admission': self.payload['supersedes_private_admission'], 'failed_private_evidence_preserved': True}
        path = self.root / 'review.json'; self.write(path, review)
        grant = {'root_thread': ack.ROOT_THREAD, 'contract': ack.CONTRACT,
            'payload_sha256': self.args.approved_acknowledgement_sha256, 'helper_sha256': self.payload['helper_sha256'],
            'supersedes_private_admission': self.payload['supersedes_private_admission'], 'exclusive_ledger_lane': True,
            'zero_cloud_writes': True, 'execute_once': True, 'external_deadline_seconds': 180,
            'expires_at_epoch': time.time() + 300, 'independent_review': {'path': str(path), 'sha256': ack.sha(path.read_bytes())}}
        self.write(self.args.root_grant, grant); self.args.root_grant_sha256 = ack.sha(self.args.root_grant.read_bytes())

    def run_fixture(self, argv, env, deadline, maximum=30):
        if argv[-1:] == ['--version']: return b'aws-cli/2.fixture'
        service, op = argv[1:3]; self.calls.append((service, op))
        self.assertIn((service, op), ack.ALLOWED)
        self.assertNotIn(self.email.decode(), str(argv)); self.assertNotIn(self.email.decode(), str(env))
        if op == 'get-caller-identity':
            result = {'Account': ACCOUNT, 'Arn': 'arn:aws:sts::'+ACCOUNT+':assumed-role/'+ADMIN.rsplit('/', 1)[-1]+'/fixture'}
        elif op == 'describe-budget':
            self.budget_rounds += 1
            result = {'Budget': {**self.payload['ledger']['original_step']['after']['budget'], 'HealthStatus': {'Status': 'HEALTHY'}}}
        elif op == 'describe-notifications-for-budget':
            result = {'Notifications': [{k:v for k,v in n.items() if k != 'ThresholdType'} for n in self.notes]}
        else:
            note = json.loads(argv[argv.index('--notification') + 1]); self.assertIn(note, self.notes)
            result = {'Subscribers': [{'SubscriptionType': 'EMAIL', 'Address': self.email.decode()}]}
        if self.mutate: self.mutate(op, result)
        return ack.canonical(result)

    def execute_fixture(self):
        with patch.object(ack, 'source_guard'), patch.object(ack, 'bounded_run', side_effect=self.run_fixture), \
             patch.object(ack, 'load_pinned', return_value=self.secret_module):
            return ack._execute(self.args, cdn, time.monotonic() + 170)

    def assert_no_commit(self):
        self.assertEqual(self.state.read_bytes(), self.before)
        self.assertFalse((self.folder / 'committed-receipt.json').exists())

    def test_exact_two_rounds_minimal_atomic_transition_private_receipts(self):
        result = self.execute_fixture()
        self.assertEqual(result['status'], 'BUDGET_CREATE_ACKNOWLEDGED_CLOUD_WRITES_ZERO')
        self.assertEqual(self.state.read_bytes(), self.after)
        self.assertEqual(len(self.calls), 12); self.assertEqual(self.budget_rounds, 2)
        self.assertEqual(self.keychain_options, [{'budget': True, 'signing': False, 'runtime_names': ()}])
        self.assertEqual(self.closes, [True])
        self.assertEqual((self.folder / 'ledger.before.json').read_bytes(), self.before)
        self.assertEqual((self.folder / 'ledger.after.proposed.json').read_bytes(), self.after)
        for file in self.folder.iterdir():
            self.assertNotIn(self.email, file.read_bytes()); self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        final = json.loads(self.after); original = json.loads(self.before)
        self.assertEqual(final['resources'], original['resources'])
        self.assertEqual(final['budget_progress']['plan_sha256'], original['budget_progress']['plan_sha256'])

    def test_absent_unhealthy_extra_alert_pagination_wrong_recipient_refuse(self):
        cases = ['absent', 'unhealthy', 'extra', 'pagination', 'recipient']
        for case in cases:
            with self.subTest(case=case):
                # Fresh receipt path for each refusal, never retry a created packet.
                self.folder = self.root / ('receipt-' + case); self.payload['receipt_directory'] = str(self.folder); self.refresh_grant()
                def mutate(op, result):
                    if case == 'absent' and op == 'describe-budget': result.clear()
                    if case == 'unhealthy' and op == 'describe-budget': result['Budget']['HealthStatus']['Status'] = 'UNHEALTHY'
                    if case == 'extra' and op == 'describe-notifications-for-budget': result['Notifications'].append(result['Notifications'][0])
                    if case == 'pagination' and op == 'describe-notifications-for-budget': result['NextToken'] = 'incomplete'
                    if case == 'recipient' and op == 'describe-subscribers-for-notification': result['Subscribers'][0]['Address'] = 'wrong@example.invalid'
                self.mutate = mutate
                with self.assertRaises(Exception): self.execute_fixture()
                self.assert_no_commit()

    def test_second_round_cloud_drift_cannot_commit(self):
        def mutate(op, result):
            if op == 'describe-budget' and self.budget_rounds == 2: result['Budget']['BudgetLimit']['Amount'] = '6'
        self.mutate = mutate
        with self.assertRaises(Exception): self.execute_fixture()
        self.assert_no_commit()

    def test_same_inode_byte_drift_and_same_byte_inode_drift_cannot_commit(self):
        for kind in ('bytes', 'inode'):
            with self.subTest(kind=kind):
                self.state.write_bytes(self.before); self.info = self.state.stat()
                self.payload['ledger'].update(device=self.info.st_dev, inode=self.info.st_ino)
                self.folder = self.root / ('drift-' + kind); self.payload['receipt_directory'] = str(self.folder); self.refresh_grant()
                self.budget_rounds = 0
                def mutate(op, result):
                    if op == 'describe-budget' and self.budget_rounds == 2:
                        if kind == 'bytes': self.state.write_bytes(self.before + b' ')
                        else:
                            replacement = self.state_dir / 'replacement'; replacement.write_bytes(self.before); replacement.chmod(0o600); os.replace(replacement, self.state)
                self.mutate = mutate
                with self.assertRaises(ack.Stop): self.execute_fixture()
                self.assertFalse((self.folder / 'committed-receipt.json').exists())
                if kind == 'bytes': self.assertEqual(self.state.read_bytes(), self.before + b' ')
                else: self.assertEqual(self.state.read_bytes(), self.before)

    def test_expired_or_nonexclusive_grant_rejected_before_provider_or_receipts(self):
        for key, value in [('expires_at_epoch', time.time()-1), ('exclusive_ledger_lane', False),
                           ('zero_cloud_writes', False), ('supersedes_private_admission', 'blanket')]:
            self.refresh_grant(); grant = json.loads(self.args.root_grant.read_bytes()); grant[key] = value
            self.write(self.args.root_grant, grant); self.args.root_grant_sha256 = ack.sha(self.args.root_grant.read_bytes())
            with self.subTest(key=key), self.assertRaises(ack.Stop): self.execute_fixture()
            self.assertEqual(self.calls, []); self.assertFalse(self.folder.exists()); self.assert_no_commit()

    def test_source_or_historical_failure_pin_drift_refuses(self):
        self.payload['source']['files']['scripts/aws/ebooks-cdn.py'] = '0'*64; self.refresh_grant()
        with self.assertRaises(ack.Stop): self.execute_fixture()
        self.assert_no_commit(); self.assertFalse(self.folder.exists())
        self.payload['source']['files'] = cdn.source_binding(); self.payload['references'].pop(); self.refresh_grant()
        with self.assertRaises(ack.Stop): self.execute_fixture()
        self.assert_no_commit()

    def test_post_replace_failure_is_ambiguous_and_replay_is_refused(self):
        replace = os.replace
        def fail_after_replace(source, destination):
            replace(source, destination)
            raise ack.Stop('Synthetic crash after replacement')
        with patch.object(ack.os, 'replace', side_effect=fail_after_replace):
            with self.assertRaises(ack.Stop): self.execute_fixture()
        self.assertEqual(self.state.read_bytes(), self.after)
        self.assertTrue((self.folder/'prepared-receipt.json').exists())
        self.assertFalse((self.folder/'committed-receipt.json').exists())
        count = len(self.calls)
        with self.assertRaises(ack.Stop): self.execute_fixture()
        self.assertEqual(len(self.calls), count); self.assertEqual(self.state.read_bytes(), self.after)

    def test_committed_receipt_failure_never_reports_success_or_repairs(self):
        write = ack.exclusive_file
        def fail_receipt(path, raw):
            if path.name == 'committed-receipt.json': raise ack.Stop('Synthetic receipt failure')
            return write(path, raw)
        with patch.object(ack, 'exclusive_file', side_effect=fail_receipt):
            with self.assertRaises(ack.Stop): self.execute_fixture()
        self.assertEqual(self.state.read_bytes(), self.after)
        self.assertFalse((self.folder/'committed-receipt.json').exists())

    def test_keychain_close_failure_is_not_retried_and_cannot_commit(self):
        closes = []
        class Store:
            def get(_, service, account): return self.email
            def close(_):
                closes.append(True)
                raise RuntimeError('Synthetic provider close failure')
        self.secret_module = SimpleNamespace(Keychain=lambda **kwargs: Store())
        with self.assertRaises(RuntimeError): self.execute_fixture()
        self.assertEqual(closes, [True]); self.assert_no_commit()

    def test_mutating_or_out_of_scope_cloud_call_is_never_executed(self):
        client = ack.ReadOnlyBudgetAws(self.payload, time.monotonic()+30)
        with patch.object(ack, 'bounded_run') as run:
            for service, op in [('budgets','create-budget'), ('budgets','update-budget'), ('s3api','head-object'), ('cloudfront','get-distribution')]:
                with self.assertRaises(ack.Stop): client.call(service, op)
            run.assert_not_called()

    def test_logical_transition_rejects_confirmed_different_plan_or_not_create(self):
        for mutation in ('confirmed','plan','before'):
            value = json.loads(self.before)
            if mutation == 'confirmed': value['budget_progress']['steps'][0]['confirmed'] = True
            if mutation == 'plan': value['budget_progress']['plan_sha256'] = '0'*64
            if mutation == 'before': value['budget_progress']['steps'][0]['before']['budget'] = {}
            raw = ack.canonical(value); payload = copy.deepcopy(self.payload); payload['ledger']['preimage_sha256'] = ack.sha(raw)
            with self.subTest(mutation=mutation), self.assertRaises(ack.Stop): ack.logical_after(raw,payload)

    def test_private_path_mode_and_duplicate_json_are_rejected(self):
        with self.assertRaises(ack.Stop): ack.decode(b'{"x":1,"x":2}')
        self.state.chmod(0o644)
        with self.assertRaises(ack.Stop): ack.read_private(self.state)
        link = self.root/'link'; link.symlink_to(self.state)
        with self.assertRaises(ack.Stop): ack.read_private(link)

    def test_subprocess_output_cap_and_deadline_have_owned_cleanup(self):
        env = {'PATH':'/usr/bin:/bin'}
        output = ack.bounded_run([sys.executable,'-c','import sys;sys.stdout.write("fixture")'], env,time.monotonic()+5)
        self.assertEqual(output,b'fixture')
        for script in ('import sys;sys.stdout.buffer.write(b"x"*(3*1024*1024))', 'import time;time.sleep(2)'):
            with self.subTest(script_kind='cap' if 'stdout' in script else 'deadline'), self.assertRaises(ack.Stop):
                ack.bounded_run([sys.executable,'-c',script],env,time.monotonic()+.5)

    def test_stale_final_read_and_advisory_lock_contention_refuse(self):
        original_clock = time.monotonic
        offset, checks = [0], [0]
        def guard(*args):
            checks[0] += 1
            if checks[0] == 3: offset[0] = 11
        deadline = original_clock() + 170
        with patch.object(ack, 'source_guard', side_effect=guard), \
             patch.object(ack, 'bounded_run', side_effect=self.run_fixture), \
             patch.object(ack, 'load_pinned', return_value=self.secret_module), \
             patch.object(ack.time, 'monotonic', side_effect=lambda: original_clock() + offset[0]):
            with self.assertRaises(ack.Stop): ack._execute(self.args, cdn, deadline)
        self.assert_no_commit(); self.assertTrue((self.folder/'prepared-receipt.json').exists())
        self.folder = self.root/'locked-receipt'; self.payload['receipt_directory'] = str(self.folder); self.refresh_grant()
        with patch.object(ack.fcntl, 'flock', side_effect=BlockingIOError()):
            with self.assertRaises(BlockingIOError): self.execute_fixture()
        self.assert_no_commit(); self.assertFalse(self.folder.exists())

    def test_asynchronous_reaper_is_refused_before_process_spawn(self):
        with patch.object(ack.signal, 'getsignal', return_value=ack.signal.SIG_IGN), \
             patch.object(ack.subprocess, 'Popen') as spawn:
            with self.assertRaises(ack.Stop): ack.bounded_run(['unused'], {}, time.monotonic()+1)
            spawn.assert_not_called()

    def test_commit_checks_repeat_after_delayed_temp_fsync_and_final_state_read(self):
        # Advance synthetic clocks only; no sleeps, providers or live paths.
        clock_mono, clock_wall = time.monotonic, time.time
        fsync, mkstemp, unchanged = os.fsync, ack.tempfile.mkstemp, ack.unchanged_state
        for checkpoint in ('temporary-fsync', 'final-state-read'):
            for condition in ('grant-expiry', 'stale-read', 'commit-reserve'):
                with self.subTest(checkpoint=checkpoint, condition=condition):
                    self.folder = self.root / (checkpoint + '-' + condition)
                    self.payload['receipt_directory'] = str(self.folder); self.refresh_grant()
                    self.budget_rounds = 0; self.calls.clear()
                    mono, wall = clock_mono(), clock_wall()
                    offsets, temporary_fd, checks = [0.0, 0.0], [None], [0]
                    deadline = mono + (8 if condition == 'commit-reserve' else 170)
                    if condition == 'grant-expiry':
                        grant = json.loads(self.args.root_grant.read_bytes()); grant['expires_at_epoch'] = wall + 2
                        self.write(self.args.root_grant, grant)
                        self.args.root_grant_sha256 = ack.sha(self.args.root_grant.read_bytes())
                    def invalidate():
                        if condition == 'grant-expiry': offsets[1] = 3
                        elif condition == 'stale-read': offsets[0] = 11
                        else: offsets[0] = 4
                    def track_temporary(*args, **kwargs):
                        fd, path = mkstemp(*args, **kwargs); temporary_fd[0] = fd
                        return fd, path
                    def delayed_fsync(fd):
                        result = fsync(fd)
                        if checkpoint == 'temporary-fsync' and fd == temporary_fd[0]: invalidate()
                        return result
                    def delayed_state(*args):
                        result = unchanged(*args); checks[0] += 1
                        if checkpoint == 'final-state-read' and checks[0] == 3: invalidate()
                        return result
                    with patch.object(ack, 'source_guard'), \
                         patch.object(ack, 'bounded_run', side_effect=self.run_fixture), \
                         patch.object(ack, 'load_pinned', return_value=self.secret_module), \
                         patch.object(ack.time, 'monotonic', side_effect=lambda: mono + offsets[0]), \
                         patch.object(ack.time, 'time', side_effect=lambda: wall + offsets[1]), \
                         patch.object(ack.tempfile, 'mkstemp', side_effect=track_temporary), \
                         patch.object(ack.os, 'fsync', side_effect=delayed_fsync), \
                         patch.object(ack, 'unchanged_state', side_effect=delayed_state), \
                         patch.object(ack.os, 'replace') as replace:
                        with self.assertRaises(ack.Stop): ack._execute(self.args, cdn, deadline)
                        replace.assert_not_called()
                    self.assert_no_commit()
                    self.assertEqual((self.state.stat().st_dev, self.state.stat().st_ino), (self.info.st_dev, self.info.st_ino))
                    self.assertEqual((self.folder / 'ledger.before.json').read_bytes(), self.before)
                    self.assertTrue((self.folder / 'prepared-receipt.json').exists())
                    self.assertFalse(list(self.state_dir.glob('.sln491-acknowledgement-*')))

    def test_owned_group_settlement_is_one_shot_and_reaps_after_signal_failure(self):
        for condition in ('exited-EPERM', 'live-EPERM', 'wait-failure', 'success', 'waitid-failure'):
            with self.subTest(condition=condition):
                calls = []; permission = PermissionError('synthetic denied group')
                wait_error = subprocess.TimeoutExpired('synthetic', 2)
                child = SimpleNamespace(pid=123456, returncode=None)
                def observe(*args):
                    calls.append('observe')
                    if condition == 'waitid-failure': raise ChildProcessError('synthetic lost wait ownership')
                    return SimpleNamespace(si_pid=child.pid) if condition == 'exited-EPERM' else None
                def group_signal(*args):
                    calls.append('signal')
                    if condition in ('exited-EPERM', 'live-EPERM'): raise permission
                def reap(timeout):
                    self.assertEqual(timeout,2); calls.append('reap')
                    if condition in ('live-EPERM','wait-failure'): raise wait_error
                    child.returncode = 0
                child.wait = Mock(side_effect=reap)
                with patch.object(ack.os,'waitid',side_effect=observe) as observed, \
                     patch.object(ack.os,'killpg',side_effect=group_signal) as killed:
                    custody = ack.OwnedReadGroup(child)
                    for iteration in range(2):
                        if condition == 'success': custody.settle()
                        else:
                            with self.assertRaises(ack.Stop) as error: custody.settle()
                            if condition.endswith('EPERM'): self.assertIs(error.exception.__cause__,permission)
                            if condition == 'wait-failure': self.assertIs(error.exception.__cause__,wait_error)
                    self.assertEqual(calls,['observe','reap'] if condition == 'waitid-failure' else ['observe','signal','reap'])
                    self.assertEqual(observed.call_count,1); self.assertEqual(child.wait.call_count,1)
                    self.assertEqual(killed.call_count,0 if condition=='waitid-failure' else 1)
                    self.assertTrue(custody.reap_attempted); self.assertTrue(custody.signal_attempted)

    def test_original_refusal_is_preserved_and_handles_close_when_cleanup_fails(self):
        original = OSError('synthetic selector setup failure')
        permission = PermissionError('synthetic group permission failure')
        selector = Mock(); selector.register.side_effect = original
        class SyntheticStream(io.BytesIO):
            def fileno(self): return 0
        child = SimpleNamespace(pid=123456, returncode=0, stdout=SyntheticStream(), stderr=SyntheticStream(), wait=Mock(return_value=0))
        with patch.object(ack.selectors,'DefaultSelector',return_value=selector), \
             patch.object(ack.subprocess,'Popen',return_value=child), \
             patch.object(ack.os,'set_blocking'), \
             patch.object(ack.os,'waitid',return_value=None), \
             patch.object(ack.os,'killpg',side_effect=permission) as killed:
            with self.assertRaises(OSError) as caught: ack.bounded_run(['synthetic'],{},time.monotonic()+2)
        self.assertIs(caught.exception,original)
        self.assertIsInstance(original.__cause__,ack.Stop)
        self.assertIs(original.__cause__.__cause__,permission)
        self.assertEqual(killed.call_count,1); child.wait.assert_called_once_with(timeout=2)
        selector.close.assert_called_once(); self.assertTrue(child.stdout.closed and child.stderr.closed)

    def test_supervisor_spawn_failure_closes_status_pipes_and_selector(self):
        pipe=ack.os.pipe; descriptors=[]; failure=OSError('synthetic supervisor spawn refused')
        def tracked_pipe():
            pair=pipe(); descriptors.extend(pair); return pair
        selector=Mock()
        with patch.object(ack.os,'pipe',side_effect=tracked_pipe), \
             patch.object(ack.selectors,'DefaultSelector',return_value=selector), \
             patch.object(ack.subprocess,'Popen',side_effect=failure):
            with self.assertRaises(OSError) as caught: ack.bounded_run(['synthetic'],{},time.monotonic()+2)
        self.assertIs(caught.exception,failure); selector.close.assert_called_once()
        self.assertEqual(len(descriptors),2)
        for fd in descriptors:
            with self.assertRaises(OSError): os.fstat(fd)

    def test_actual_quick_commands_failure_cap_timeout_and_direct_reap(self):
        spawn = ack.subprocess.Popen; children = []
        def tracked(*args, **kwargs):
            child=spawn(*args, **kwargs); child.wait=Mock(wraps=child.wait); children.append(child); return child
        cases=[('zero','print("quick",end="")',False),('nonzero','import sys;sys.exit(7)',True),
               ('cap','import sys;sys.stdout.buffer.write(b"x"*(3*1024*1024))',True),
               ('timeout','import time;time.sleep(5)',True)]
        with patch.object(ack.subprocess,'Popen',side_effect=tracked):
            for name,code,refuse in cases:
                with self.subTest(case=name):
                    if refuse:
                        with self.assertRaises(ack.Stop): ack.bounded_run([sys.executable,'-c',code],{'PATH':'/usr/bin:/bin'},time.monotonic()+.5)
                    else:
                        self.assertEqual(ack.bounded_run([sys.executable,'-c',code],{'PATH':'/usr/bin:/bin'},time.monotonic()+5),b'quick')
                    child=children[-1]; child.wait.assert_called_once_with(timeout=2)
                    self.assertEqual(child.returncode,-signal.SIGKILL)
                    self.assertTrue(child.stdout.closed and child.stderr.closed)
                    with self.assertRaises(ProcessLookupError): os.kill(child.pid,0)

    def test_actual_same_group_descendant_settles_after_command_exit_and_pipe_close(self):
        code='import subprocess,sys;child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(10)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);print(child.pid,flush=True)'
        raw=ack.bounded_run([sys.executable,'-c',code],{'PATH':'/usr/bin:/bin'},time.monotonic()+5)
        descendant=int(raw); until=time.monotonic()+2
        while True:
            try: os.kill(descendant,0)
            except ProcessLookupError: break
            self.assertLess(time.monotonic(),until,'Owned live descendant remained after final group settlement')
            time.sleep(.01)

    def test_existing_alarm_is_not_cancelled_and_action_flag_is_required(self):
        with patch.object(ack.signal,'getitimer',return_value=(5.0,0.0)), patch.object(ack.signal,'alarm') as alarm:
            with self.assertRaises(ack.Stop): ack.execute(self.args,cdn)
            alarm.assert_not_called()
        self.args.acknowledge_reviewed_budget_create=False
        with self.assertRaises(ack.Stop): ack.execute(self.args,cdn)


if __name__ == '__main__': unittest.main()
