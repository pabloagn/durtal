#!/usr/bin/env python3
"""Repository budget-create acknowledgement; only ebooks-cdn.py invokes this.

Zero cloud writes, explicit root review/grant and exclusive local ledger lane.
This reviewed contract supersedes private native admission only for this action.
No standalone entrypoint, replay, adoption, repair or automatic retry.
"""
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import selectors
import stat
import subprocess
import sys
import tempfile
import time
import types

ROOT_THREAD = '01a11852-61c9-7f31-b0fb-1fc9f0b21e1a'
REVIEW_DECISION = 'APPROVED_ROOT_ONLY_REPOSITORY_BUDGET_ACKNOWLEDGEMENT'
CONTRACT = 'repository-budget-create-acknowledgement-v1'
CAUSAL_SHA = '797534c36b4570e5f37d8fecf311c586fad19cd1c08991d66e1c290a7b92b888'
ORIGINAL_PLAN_SHA = '5e066e0b53c6da2a454c0c36eabf299324c65c0a0ccdefb643bb3b3b1c351a74'
ORIGINAL_JOURNAL_SHA = '13a7f4a2cc520176e342c6d3246816d0a69d827d65b815569ab65fdf0753cf31'
FAILED_NATIVE_SHAS = frozenset({'1aa3b4513c4ffbf68b99b45438e279c41e6ca4dd7c48993b6f433897ae937fe8',
    'd6d6342fda812c390bd176b374c9c1de9a3824314a4145c414db31627914e6ee'})
ALLOWED = frozenset({('sts', 'get-caller-identity'), ('budgets', 'describe-budget'),
    ('budgets', 'describe-notifications-for-budget'), ('budgets', 'describe-subscribers-for-notification')})
class Stop(RuntimeError):
    pass

def require(value, message):
    if not value:
        raise Stop(message)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()

def decode(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique,
        parse_constant=lambda _: (_ for _ in ()).throw(Stop('Nonfinite JSON')))

def read_private(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'Absolute normalized private path required')
    require(not any(p.is_symlink() for p in (path, *path.parents)), 'Symlink refused')
    directory = path.parent.stat()
    require(stat.S_ISDIR(directory.st_mode) and directory.st_uid == os.getuid() and
        stat.S_IMODE(directory.st_mode) == 0o700, 'Private directory guard')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and
            stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 4*1024*1024, 'Private file guard')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(4*1024*1024 + 1)
        require(len(raw) <= 4*1024*1024, 'Private file size guard')
        require((path.stat().st_dev, path.stat().st_ino) == (info.st_dev, info.st_ino), 'Private file replaced')
        return raw, info
    finally:
        os.close(fd)

def exclusive_file(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())

def check_pin(pin):
    path = Path(pin['path'])
    require(str(path.resolve()) == pin['path'], 'Pinned resolved path changed')
    require(re.fullmatch(r'[a-f0-9]{64}', pin['sha256']) and sha(path.read_bytes()) == pin['sha256'], 'File pin drift')

# The command runs in a child of this pinned-Python group leader. After
# reporting the command's exit status and closing output, the leader stays
# live until the parent's one final group signal. Darwin excludes zombies
# from killpg, so an exited leader alone cannot serve as a signalable lease.
_READ_SUPERVISOR = """import os,signal,subprocess,sys
status_fd=int(sys.argv[1])
try:
    command=subprocess.Popen(sys.argv[2:], stdin=subprocess.DEVNULL)
    result=command.wait()
except BaseException:
    result=125
os.write(status_fd, (str(result)+"\\n").encode("ascii"))
os.close(status_fd)
os.close(1)
os.close(2)
while True:
    signal.pause()
"""

class OwnedReadGroup:
    """One group action before one bounded reap; unresolved custody refuses."""
    def __init__(self, child):
        self.child = child
        self.signal_attempted = self.reap_attempted = False
        self.error = None
        self.leader_exit = None

    def settle(self):
        if not self.signal_attempted:
            self.signal_attempted = True
            try:
                # Observe without releasing the PID; no poll/early reap.
                self.leader_exit = os.waitid(os.P_PID, self.child.pid,
                    os.WEXITED | os.WNOHANG | os.WNOWAIT)
                os.killpg(self.child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except BaseException as error:
                self.error = error
        if not self.reap_attempted:
            self.reap_attempted = True
            try:
                self.child.wait(timeout=2)
            except BaseException as error:
                if self.error is None:
                    self.error = error
                else:
                    self.error.add_note('Bounded direct-child reap also failed; external custody required')
        if self.error is not None:
            raise Stop('Owned read group settlement unresolved; external custody required') from self.error


def bounded_run(argv, env, deadline, maximum=30):
    remaining = min(maximum, deadline - time.monotonic())
    require(remaining > 0, 'Execution deadline expired')
    end = time.monotonic() + remaining
    require(all(hasattr(os, name) for name in ('waitid', 'P_PID', 'WEXITED', 'WNOHANG', 'WNOWAIT')),
        'Nonreaping standard process wait is required')
    require(signal.getsignal(signal.SIGCHLD) == signal.SIG_DFL,
        'Default child-exit disposition required; no asynchronous reaper')
    selector = selectors.DefaultSelector()
    status_read = status_write = None
    status_stream = None
    try:
        status_read, status_write = os.pipe()
        status_stream = os.fdopen(status_read, 'rb')
        status_read = None  # status_stream now owns the descriptor
        child = subprocess.Popen([sys.executable, '-I', '-c', _READ_SUPERVISOR,
            str(status_write), *argv], env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
            pass_fds=(status_write,))
    except BaseException:
        if status_stream is not None:
            status_stream.close()
        elif status_read is not None:
            os.close(status_read)
        selector.close()
        raise
    finally:
        if status_write is not None:
            os.close(status_write)
    buffers = {'stdout': bytearray(), 'stderr': bytearray(), 'status': bytearray()}
    custody = OwnedReadGroup(child)
    try:
        for name in buffers:
            stream = status_stream if name == 'status' else getattr(child, name)
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, name)
        while selector.get_map():
            remaining = min(end, deadline) - time.monotonic()
            require(remaining > 0, 'Read-only command deadline expired')
            for key, _ in selector.select(min(remaining, 1)):
                try:
                    chunk = os.read(key.fileobj.fileno(), 65536)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                target = buffers[key.data]
                limit = 64 if key.data == 'status' else 2 * 1024 * 1024
                require(len(target) + len(chunk) <= limit, 'Provider output size guard')
                target.extend(chunk)
        require(re.fullmatch(rb'-?[0-9]+\n', bytes(buffers['status'])) is not None,
            'Read-only supervisor status missing or invalid')
        result = int(buffers['status'])
        custody.settle()
        require(custody.leader_exit is None and child.returncode == -signal.SIGKILL,
            'Read-only supervisor lease exited before final group settlement')
        require(result == 0, 'Read-only command failed; output withheld')
        return bytes(buffers['stdout'])
    except BaseException as original:
        try:
            custody.settle()
        except BaseException as cleanup:
            if cleanup is not original:
                original.add_note('Owned read cleanup unresolved; external root custody required')
                raise original from cleanup
        raise
    finally:
        selector.close()
        child.stdout.close()
        child.stderr.close()
        status_stream.close()

class ReadOnlyBudgetAws:
    def __init__(self, payload, deadline):
        self.payload, self.deadline = payload, deadline
        self.account = payload['binding']['account']
        self.admin = payload['binding']['admin']
        self.calls = []
        # Rebuild environment: no AWS ambient credentials/endpoints, Python or loader overrides.
        self.env = {k: os.environ[k] for k in ('HOME', 'TMPDIR', 'LANG', 'LC_ALL') if k in os.environ}
        self.env.update(PATH='/usr/bin:/bin:/opt/homebrew/bin', PYTHONDONTWRITEBYTECODE='1',
            AWS_CONFIG_FILE=str(Path.home()/'.aws/config'),
            AWS_SHARED_CREDENTIALS_FILE=str(Path.home()/'.aws/credentials'),
            AWS_EC2_METADATA_DISABLED='true', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS='true',
            AWS_USE_FIPS_ENDPOINT='false', AWS_USE_DUALSTACK_ENDPOINT='false', AWS_MAX_ATTEMPTS='1')

    def call(self, service, operation, arguments=(), document=None, missing=None):
        require((service, operation) in ALLOWED, 'AWS operation outside four-read capability')
        require(missing in (None, 'NotFoundException'), 'Unexpected missing policy')
        expected = ['--account-id', self.account, '--budget-name', 'durtal-monthly']
        if service == 'sts':
            require(not arguments and document is None, 'STS operands changed')
            operands = []
        elif operation == 'describe-subscribers-for-notification':
            require(not arguments and isinstance(document, dict) and
                set(document) == {'AccountId','BudgetName','Notification'} and
                document['AccountId'] == self.account and document['BudgetName'] == 'durtal-monthly', 'Subscriber operand drift')
            require(document['Notification'] in self.payload['intended_notifications'], 'Unreviewed percentage identity')
            operands = expected + ['--notification', canonical(document['Notification']).decode(), '--max-results', '100']
        else:
            require(list(arguments) == expected and document is None, 'Budget read operands changed')
            operands = expected
            if operation == 'describe-notifications-for-budget':
                operands += ['--max-results', '100']
        argv = [self.payload['tools']['aws']['path'], service, operation, *operands,
            '--profile', 'durtal-personal', '--region', 'eu-north-1', '--no-cli-pager',
            '--no-cli-auto-prompt', '--no-paginate', '--cli-binary-format', 'base64', '--output', 'json',
            '--cli-connect-timeout', '5', '--cli-read-timeout', '15']
        if service == 'sts':
            argv += ['--endpoint-url', 'https://sts.eu-north-1.amazonaws.com']
        output = decode(bounded_run(argv, self.env, self.deadline))
        require(isinstance(output, dict), 'Provider object required')
        if operation == 'describe-budget':
            require(set(output) == {'Budget'}, 'Unknown budget response envelope')
        elif service == 'budgets':
            field = 'Subscribers' if operation == 'describe-subscribers-for-notification' else 'Notifications'
            require(set(output) <= {field,'NextToken'} and field in output and
                output.get('NextToken') in (None,''), 'Unknown or unresolved pagination')
        self.calls.append({'service': service, 'operation': operation, 'complete': True})
        return output

    def identity(self):
        value = self.call('sts', 'get-caller-identity')
        role = self.admin.rsplit('/',1)[-1]
        prefix = 'arn:aws:sts::%s:assumed-role/%s/' % (self.account, role)
        arn = value.get('Arn','')
        require(value.get('Account') == self.account and
            (arn == self.admin or (arn.startswith(prefix) and bool(arn[len(prefix):]) and '/' not in arn[len(prefix):])),
            'Exact personal account/admin identity failed')
        return {'account': self.account, 'approved_admin_role': self.admin, 'matched': True}

def load_pinned(path, expected, name):
    raw = Path(path).read_bytes()
    require(sha(raw) == expected, 'Pinned module changed')
    module = types.ModuleType(name)
    module.__file__ = path
    exec(compile(raw,path,'exec'), module.__dict__)
    return module

def source_guard(payload, deadline):
    for pin in payload['tools'].values():
        check_pin(pin)
        info = Path(pin['path']).stat()
        require(stat.S_ISREG(info.st_mode) and os.access(pin['path'], os.X_OK) and
            not info.st_mode & (stat.S_IWGRP | stat.S_IWOTH), 'Pinned executable permissions changed')
    launcher = Path(payload['tools']['aws']['path']).read_bytes().splitlines()[0]
    require(launcher.startswith(b'#!') and
        str(Path(launcher[2:].decode()).resolve()) == payload['tools']['aws_interpreter']['path'],
        'AWS launcher interpreter pin changed')
    for relative, expected in payload['source']['files'].items():
        path = Path(payload['source']['root'])/relative
        require(not any(p.is_symlink() for p in (path,*path.parents)), 'Source symlink refused')
        require(sha(path.read_bytes()) == expected, 'Source content drift')
    root = payload['source']['root']
    env = {'PATH':'/usr/bin:/bin', 'HOME':str(Path.home()), 'GIT_OPTIONAL_LOCKS':'0'}
    argv = [payload['tools']['git']['path'],'-C',root]
    require(bounded_run(argv+['rev-parse','HEAD'],env,deadline).decode().strip() == payload['source']['head'], 'Source HEAD drift')
    require(bounded_run(argv+['status','--porcelain=v1','--untracked-files=all'],env,deadline) == b'', 'Source worktree dirty')
    require(time.monotonic() < deadline, 'Source guard deadline')

def logical_after(raw, payload):
    require(sha(raw) == payload['ledger']['preimage_sha256'], 'Ledger preimage drift')
    value = decode(raw)
    require(value.get('binding') == payload['binding'] and value.get('budget_start') == 1790812800,
        'Ledger binding/start drift')
    require('budget_owned' not in value and value.get('pending') == ['budget'], 'Ledger ownership/pending drift')
    progress = value.get('budget_progress',{})
    require(progress.get('plan_sha256') == payload['causal']['original_plan_canonical_sha256'] and
        set(progress) == {'plan_sha256','steps'} and len(progress['steps']) == 1,
        'Single original create journal required')
    step = progress['steps'][0]
    require(step.get('confirmed') is False and step['before'].get('budget') is None and
        step['after'].get('budget') is not None, 'Exact originally unconfirmed create required')
    require(step == payload['ledger']['original_step'], 'Original create step drift')
    after = copy.deepcopy(value)
    after['budget_progress']['steps'][0]['confirmed'] = True
    after['budget_owned'] = True
    after['pending'] = [p for p in after['pending'] if p != 'budget']
    require(after == payload['ledger']['expected_after'], 'Reviewed after state mismatch')
    encoded = json.dumps(after,indent=2,sort_keys=True,allow_nan=False).encode()+b'\n'
    require(sha(encoded) == payload['ledger']['after_sha256'], 'After encoding drift')
    return encoded

def accepted_read(controller, payload):
    identity = controller.aws.identity()
    current, private = controller.read_budget()
    require(current.get('budget') is not None, 'Budget absent; no create allowed')
    require(controller.budget_preimage(current) == controller.budget_preimage(payload['ledger']['original_step']['after']),
        'Current cloud configuration differs from exact approved create outcome')
    evidence = current['budget_evidence']
    require(evidence['health']['accepted'] and evidence['complete_notification_read'] and
        evidence['all_present_recipients_match_intended'] and len(private) == 3 and
        len(evidence['percentage_lookups']) == 3 and
        all(p['single_intended_email_recipient'] for p in evidence['percentage_lookups']),
        'Incomplete health/percentage/private-recipient acceptance')
    return {'identity':identity,'snapshot':current,'recipient_exported':False,
        'finished_monotonic':time.monotonic()}

def validate_payload(payload, cdn, args):
    fields = {'version', 'contract', 'binding', 'source', 'tools', 'causal', 'references',
              'ledger', 'receipt_directory', 'intended_documents', 'intended_notifications',
              'helper_sha256', 'supersedes_private_admission'}
    require(isinstance(payload, dict) and set(payload) == fields and type(payload['version']) is int and payload['version'] == 1 and
        payload['contract'] == CONTRACT, 'Exact repository acknowledgement payload required')
    require(payload['supersedes_private_admission'] == 'budget-create-local-journal-only',
        'Explicit scope of contract supersession required')
    binding = {'account': args.expected_account, 'admin': args.admin_arn,
               'profile': cdn.PROFILE, 'region': cdn.REGION, 'bucket': cdn.BUCKET}
    require(binding['account'] == '608240934043' and payload['binding'] == binding,
        'Exact owner storage/administrator binding required')
    # Reuse the repository's account/administrator syntax validation, without a call.
    cdn.Aws(binding['account'], binding['admin'])
    require(payload['source']['root'] == str(cdn.ROOT) and
        re.fullmatch(r'[a-f0-9]{40}', payload['source']['head']) and
        payload['source']['files'] == cdn.source_binding(), 'Exact current repository source required')
    require(set(payload['tools']) == {'python', 'git', 'aws', 'aws_interpreter'} and
        str(Path(sys.executable).resolve()) == payload['tools']['python']['path'], 'Exact pinned toolchain required')
    require(sha(Path(__file__).read_bytes()) == payload['helper_sha256'], 'Acknowledgement module changed')
    require(payload['causal']['accepted_contract_sha256'] == CAUSAL_SHA and
        payload['causal']['original_plan_canonical_sha256'] == ORIGINAL_PLAN_SHA and
        payload['causal']['old_plan_evidence_only_never_execute'] is True and
        payload['causal']['ownership_premise_only'] is True, 'Accepted causal premise required')
    required = {CAUSAL_SHA, ORIGINAL_JOURNAL_SHA} | FAILED_NATIVE_SHAS
    require(required.issubset({r['sha256'] for r in payload['references']}),
        'Causal journal and failed native evidence must remain pinned')
    for pin in payload['references']:
        check_pin(pin)
    causal = decode(Path(next(r['path'] for r in payload['references'] if r['sha256'] == CAUSAL_SHA)).read_bytes())
    original = decode(Path(next(r['path'] for r in payload['references'] if r['sha256'] == ORIGINAL_JOURNAL_SHA)).read_bytes())
    require(causal['immutable_bindings']['original_plan_canonical_sha256'] == ORIGINAL_PLAN_SHA and
        causal['immutable_bindings']['original_plan_account_profile_region_admin'] == binding and
        original['binding'] == binding and original['budget_progress']['plan_sha256'] == ORIGINAL_PLAN_SHA and
        original['budget_progress']['steps'] == [payload['ledger']['original_step']],
        'Historical causal-create step differs')
    state = Path(payload['ledger']['path'])
    require(state.is_absolute() and '..' not in state.parts and
        state == Path(args.state_dir).absolute() / 'state.json', 'Exact owner ledger path required')
    folder = Path(payload['receipt_directory'])
    require(folder.is_absolute() and '..' not in folder.parts and not folder.is_relative_to(cdn.ROOT) and
        not folder.is_relative_to(state.parent) and not folder.exists(), 'New external receipt directory required')
    # Private path guard also rejects symlink components, including nonexistent leaves.
    cdn.private_directory(state.parent)
    cdn.private_directory(folder)
    return state, folder


def authorize(payload, payload_sha, args):
    grant_raw, _ = read_private(args.root_grant)
    require(sha(grant_raw) == args.root_grant_sha256, 'Root grant digest drift')
    grant = decode(grant_raw)
    require(grant['root_thread'] == ROOT_THREAD and grant['contract'] == CONTRACT and
        grant['payload_sha256'] == payload_sha and grant['helper_sha256'] == payload['helper_sha256'] and
        grant['supersedes_private_admission'] == payload['supersedes_private_admission'] and
        grant['exclusive_ledger_lane'] is True and grant['zero_cloud_writes'] is True and
        grant['execute_once'] is True and grant['external_deadline_seconds'] == 180 and
        time.time() < grant['expires_at_epoch'] <= time.time() + 600, 'Fresh exact exclusive root grant required')
    review_raw, _ = read_private(grant['independent_review']['path'])
    require(sha(review_raw) == grant['independent_review']['sha256'], 'Independent review digest drift')
    review = decode(review_raw)
    require(review['decision'] == REVIEW_DECISION and review['contract'] == CONTRACT and
        review['payload_sha256'] == payload_sha and review['helper_sha256'] == payload['helper_sha256'] and
        review['supersedes_private_admission'] == payload['supersedes_private_admission'] and
        review['failed_private_evidence_preserved'] is True, 'Exact independent contract/source review required')
    return grant, grant_raw


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def unchanged_state(path, before, info):
    raw, latest = read_private(path)
    require(raw == before and (latest.st_dev, latest.st_ino) == (info.st_dev, info.st_ino),
        'Ledger bytes/inode drift; no acknowledgement')


def _execute(args, cdn, deadline):
    raw, _ = read_private(args.acknowledgement_payload)
    payload = decode(raw)
    payload_sha = sha(canonical(payload))
    require(payload_sha == args.approved_acknowledgement_sha256, 'Approved acknowledgement payload changed')
    state, folder = validate_payload(payload, cdn, args)
    grant, grant_raw = authorize(payload, payload_sha, args)
    source_guard(payload, deadline)
    require(bounded_run([payload['tools']['aws']['path'], '--version'],
        {'PATH': '/usr/bin:/bin', 'HOME': str(Path.home())}, deadline).startswith(b'aws-cli/2.'), 'AWS CLI v2 required')
    before, info = read_private(state)
    require((info.st_dev, info.st_ino) == (payload['ledger']['device'], payload['ledger']['inode']),
        'Reviewed ledger device/inode changed')
    after = logical_after(before, payload)
    lock_fd = os.open(state.parent / '.sln491-budget-recovery.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    store = None
    try:
        lock_info = os.fstat(lock_fd)
        require(stat.S_ISREG(lock_info.st_mode) and lock_info.st_uid == os.getuid() and
            stat.S_IMODE(lock_info.st_mode) == 0o600, 'Exclusive advisory lock guard')
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        unchanged_state(state, before, info)
        folder.mkdir(mode=0o700)
        fsync_directory(folder.parent)
        exclusive_file(folder / 'ledger.before.json', before)
        exclusive_file(folder / 'ledger.after.proposed.json', after)
        exclusive_file(folder / 'root-grant.json', grant_raw)
        aws = ReadOnlyBudgetAws(payload, deadline)
        secrets_path = cdn.ROOT / 'scripts/aws/macos-secrets.py'
        secrets = load_pinned(str(secrets_path), payload['source']['files']['scripts/aws/macos-secrets.py'], 'acknowledgement_budget_secrets')
        store = secrets.Keychain(budget=True, signing=False, runtime_names=())
        controller = cdn.Control(aws, state.parent, secrets=store)
        require(controller.state == decode(before), 'Controller read a different ledger')
        docs = controller.documents()
        intended = {name: docs[name] for name in ('budget.json', 'budget-notifications.json')}
        require(intended == payload['intended_documents'], 'Reviewed budget documents differ from repository')
        require(payload['intended_notifications'] == [cdn.notification_config(x['Notification'])
            for x in intended['budget-notifications.json']], 'Exact three intended percentage identities required')
        first = accepted_read(controller, payload)
        source_guard(payload, deadline)
        second = accepted_read(controller, payload)
        require(controller.budget_preimage(first['snapshot']) == controller.budget_preimage(second['snapshot']),
            'Budget drift between the two fresh rounds')
        closing, store = store, None
        closing.close()
        # Snapshots have only repository-redacted recipient placeholders/booleans.
        # Actual subscriber addresses stay in Control/read_budget memory only.
        receipt = {'status': 'PREPARED_NOT_COMMITTED', 'contract': CONTRACT,
            'payload_sha256': payload_sha, 'helper_sha256': payload['helper_sha256'],
            'before_sha256': sha(before), 'after_sha256': sha(after), 'cloud_writes': 0,
            'reads': aws.calls, 'accepted_reads': [first, second],
            'failed_private_evidence_preserved': True, 'superseded_scope': payload['supersedes_private_admission']}
        exclusive_file(folder / 'prepared-receipt.json', canonical(receipt) + b'\n')
        fsync_directory(folder)
        source_guard(payload, deadline)
        for pin in payload['references']:
            check_pin(pin)
        unchanged_state(state, before, info)
        require(time.monotonic() - second['finished_monotonic'] <= 10 and time.monotonic() + 5 < deadline,
            'Latest read stale or insufficient commit reserve')
        require(time.time() < grant['expires_at_epoch'], 'Root grant expired before local commit')
        fd, temporary = tempfile.mkstemp(prefix='.sln491-acknowledgement-', dir=state.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(after)
                stream.flush()
                os.fsync(stream.fileno())
            unchanged_state(state, before, info)
            require(time.monotonic() - second['finished_monotonic'] <= 10 and time.monotonic() + 5 < deadline,
                'Latest read stale or insufficient commit reserve after temporary fsync')
            require(time.time() < grant['expires_at_epoch'], 'Root grant expired at local commit boundary')
            os.replace(temporary, state)
            fsync_directory(state.parent)
            committed, _ = read_private(state)
            require(committed == after, 'Committed ledger readback differs; STOP for root inspection')
            receipt['status'] = 'BUDGET_CREATE_ACKNOWLEDGED_CLOUD_WRITES_ZERO'
            committed_raw = canonical(receipt) + b'\n'
            exclusive_file(folder / 'committed-receipt.json', committed_raw)
            fsync_directory(folder)
            require(read_private(folder / 'committed-receipt.json')[0] == committed_raw,
                'Committed receipt readback differs; STOP for root inspection')
            return {'status': receipt['status'], 'receipt_directory': str(folder),
                    'ledger_sha256': sha(after), 'cloud_writes': 0}
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    finally:
        try:
            if store is not None:
                closing, store = store, None
                closing.close()
        finally:
            os.close(lock_fd)


def execute(args, cdn):
    """Only existing CLI calls this; source/payload approval is not execution approval."""
    require(args.acknowledge_reviewed_budget_create is True, 'Explicit acknowledgement action required')
    # 170s internal deadline leaves 10s for root's hard180s owned-process cleanup.
    deadline = time.monotonic() + 170
    previous = signal.getsignal(signal.SIGALRM)
    require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), 'Refusing an existing process alarm')
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Stop('Acknowledgement deadline expired')))
    signal.alarm(170)
    try:
        return _execute(args, cdn, deadline)
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)
