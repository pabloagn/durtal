#!/usr/bin/env python3
"""SLN491: source-bound, reviewed phases. No AWS/Keychain writes in plan/verify.

Root owns each approval and serializes apply. This never starts the app, installs
Tailscale, rewrites existing storage protections, or changes app IAM credentials.
"""
import argparse
from contextlib import contextmanager
from types import SimpleNamespace
import base64
import copy
import fcntl
import datetime
from decimal import Decimal, InvalidOperation
from fractions import Fraction
import hashlib
import importlib.util
import json
import math
import os
import select
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import urllib.error
import urllib.request

PROFILE, REGION, BUCKET = 'durtal-personal', 'eu-north-1', 'durtal'
PROTECTED = ('ER3J12H1G5DI3', 'EBHF0NZU72GYA')
SID = 'EbooksCloudFrontAcceptedObjectsOnly'
EMAIL_SERVICE = 'com.durtal.aws-budget-alert-email'
KEY_SERVICE = 'com.durtal.ebooks.cloudfront-private-key'
ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = ROOT / 'infra/aws/ebooks'
TEMPLATE_FILES = ('origin-access-control.json', 'cache-policy.json', 'response-headers-policy.json',
                  'distribution.json', 'cloudfront-bucket-statement.json', 'public-key-config.json',
                  'key-group-config.json', 'function-config.json', 'viewer-request.js',
                  'resource-tags.json', 'budget.json', 'budget-notifications.json')
CREATE = {'oac': ('create-origin-access-control', 'OriginAccessControlConfig', 'OriginAccessControl'),
          'cache': ('create-cache-policy', 'CachePolicyConfig', 'CachePolicy'),
          'headers': ('create-response-headers-policy', 'ResponseHeadersPolicyConfig', 'ResponseHeadersPolicy'),
          'public_key': ('create-public-key', 'PublicKeyConfig', 'PublicKey'),
          'key_group': ('create-key-group', 'KeyGroupConfig', 'KeyGroup')}
NAMES = {'oac': 'durtal-ebooks', 'cache': 'durtal-ebooks-immutable', 'headers': 'durtal-ebooks-cors',
         'key_group': 'durtal-ebooks', 'function': 'durtal-ebooks-viewer'}
MUTATIONS = {'cloudfront': {'create-origin-access-control', 'create-cache-policy', 'create-response-headers-policy',
                          'create-public-key', 'create-key-group', 'create-function', 'publish-function',
                          'create-distribution-with-tags', 'update-distribution'},
             's3api': {'put-bucket-policy'},
             'budgets': {'create-budget', 'update-budget', 'create-notification', 'update-notification',
                         'create-subscriber', 'update-subscriber'}}
ABSENT = {'NoSuchBucketPolicy', 'NotFoundException', 'NoSuchFunctionExists'}
ENDPOINTS = {'sts': 'https://sts.eu-north-1.amazonaws.com', 's3api': 'https://s3.eu-north-1.amazonaws.com',
             'cloudfront': None, 'iam': None, 'budgets': None}


class Refusal(RuntimeError):
    pass


class AwsError(Refusal):
    def __init__(self, code, operation):
        self.code = code
        super().__init__('AWS %s failed (%s); provider output withheld' % (operation, code))


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def aws_environment():
    env = {k: v for k, v in os.environ.items() if not k.startswith('AWS_')}
    env.update(AWS_CONFIG_FILE=str(Path.home() / '.aws/config'),
               AWS_SHARED_CREDENTIALS_FILE=str(Path.home() / '.aws/credentials'), AWS_EC2_METADATA_DISABLED='true', AWS_IGNORE_CONFIGURED_ENDPOINT_URLS='true',
               AWS_USE_FIPS_ENDPOINT='false', AWS_USE_DUALSTACK_ENDPOINT='false')
    return env


def private_directory(path, create=False):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise Refusal('Symlink in private artifact/state path')
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        info = path.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise Refusal('Private directory must be owned by caller with mode 0700')
    return path


def private_read(path):
    if path.is_symlink():
        raise Refusal('Refusing symlink file')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise Refusal('Private artifact must be an owned regular mode 0600 file')
    return path.read_bytes()


def private_write(path, data):
    private_directory(path.parent, True)
    if path.exists():
        private_read(path)
    fd, temporary = tempfile.mkstemp(prefix='.pending-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        if path.is_symlink():
            raise Refusal('Refusing replaced symlink')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def public_json(path, value):
    private_write(path, json.dumps(value, indent=2, sort_keys=True).encode() + b'\n')


def keychain():
    spec = importlib.util.spec_from_file_location('durtal_macos_secrets', Path(__file__).with_name('macos-secrets.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Keychain()


def source_binding():
    paths = [TEMPLATES / name for name in TEMPLATE_FILES]
    paths += [Path(__file__), Path(__file__).with_name('macos-secrets.py'),
              Path(__file__).with_name('budget-acknowledgement.py')]
    return {str(p.relative_to(ROOT)): file_hash(p) for p in paths}


def substitute(value, mapping):
    text = json.dumps(value)
    for name, replacement in mapping.items():
        text = text.replace('__' + name + '__', json.dumps(str(replacement))[1:-1])
    return json.loads(text)


def template(name, mapping):
    return substitute(json.loads((TEMPLATES / name).read_text()), mapping)


def equivalent(want, have):
    """Exact configuration comparison; normalize only empty AWS quantity lists."""
    if isinstance(want, dict):
        if not isinstance(have, dict):
            return False
        want, have = copy.deepcopy(want), copy.deepcopy(have)
        for item in (want, have):
            if item.get('Quantity') == 0 and item.get('Items') == []:
                item.pop('Items')
        return want.keys() == have.keys() and all(equivalent(v, have[k]) for k, v in want.items())
    if isinstance(want, list):
        return (isinstance(have, list) and len(want) == len(have) and
                (sorted(want) == sorted(have) if all(isinstance(x, str) for x in want + have) else
                 all(equivalent(a, b) for a, b in zip(want, have))))
    return want == have


def distribution_config(config):
    """Allowlisted AWS defaults only; unknown/nondefault fields remain and fail.

    AWS CLI get-distribution-config documents these empty/disabled settings and
    the TLSv1/cloudfront defaults for the default CloudFront certificate.
    """
    result = copy.deepcopy(config)
    def trim(obj, defaults):
        for key, value in defaults.items():
            if key in obj and equivalent(value, obj[key]):
                obj.pop(key)
    trim(result, {'OriginGroups': {'Quantity': 0}, 'ContinuousDeploymentPolicyId': '',
                  'Staging': False, 'AnycastIpListId': ''})
    certificate = result.get('ViewerCertificate', {})
    # AWS returns vip even for its default certificate. Accept only that exact
    # no-alias/no-custom-certificate shape; custom certificate choices stay exact.
    if (certificate.get('CloudFrontDefaultCertificate') is True and
            equivalent({'Quantity': 0}, result.get('Aliases')) and
            certificate.get('CertificateSource') in (None, 'cloudfront') and
            not any(certificate.get(key) for key in ('Certificate', 'IAMCertificateId', 'ACMCertificateArn')) and
            certificate.get('SSLSupportMethod') == 'vip'):
        certificate.pop('SSLSupportMethod')
    trim(certificate, {'MinimumProtocolVersion': 'TLSv1',
        'CertificateSource': 'cloudfront', 'Certificate': '', 'IAMCertificateId': '',
        'ACMCertificateArn': '', 'SSLSupportMethod': ''})
    trim(result.get('DefaultCacheBehavior', {}), {'SmoothStreaming': False,
        'FieldLevelEncryptionId': '', 'OriginRequestPolicyId': '', 'RealtimeLogConfigArn': '',
        'GrpcConfig': {'Enabled': False}})
    for error in result.get('CustomErrorResponses', {}).get('Items', []):
        trim(error, {'ResponseCode': '', 'ResponsePagePath': ''})
    for origin in result.get('Origins', {}).get('Items', []):
        trim(origin, {'OriginShield': {'Enabled': False}})
        trim(origin.get('S3OriginConfig', {}), {'OriginReadTimeout': 30})
    return result


def distribution_matches(want, have):
    return equivalent(distribution_config(want), distribution_config(have))


def headers_config(config):
    """AWS returns empty optional security structures for unset header controls.

    Only these five exactly-empty objects are equivalent to their omission.
    Values, unknown fields, CORS and ContentTypeOptions remain exact.
    """
    result = copy.deepcopy(config)
    security = result.get('SecurityHeadersConfig', {})
    for field in ('XSSProtection', 'FrameOptions', 'ReferrerPolicy',
                  'ContentSecurityPolicy', 'StrictTransportSecurity'):
        if field in security and security[field] == {}:
            security.pop(field)
    return result


def headers_matches(want, have):
    return equivalent(headers_config(want), headers_config(have))


def budget_amount(value):
    """Exact schema-valid decimal text; never round through Decimal context."""
    if (not isinstance(value, str) or len(value) > 256 or
            not re.fullmatch(r'([0-9]*\.)?[0-9]+', value)):
        raise Refusal('Invalid budget amount representation')
    try:
        amount = Decimal(value)
    except InvalidOperation:
        raise Refusal('Invalid budget amount representation') from None
    if not amount.is_finite():
        raise Refusal('Nonfinite budget amount')
    whole, _, fraction = format(amount, 'f').partition('.')
    whole, fraction = whole.lstrip('0') or '0', fraction.rstrip('0')
    return whole + ('.' + fraction if fraction else '')


def budget_time(value):
    """Exact UTC ISO representation of aware ISO/finite numeric epoch instants."""
    epoch = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
    if isinstance(value, bool):
        raise Refusal('Boolean budget timestamp')
    if isinstance(value, (int, float, Decimal)):
        if len(str(value)) > 256:
            raise Refusal('Unbounded budget timestamp')
        try:
            number = Decimal(str(value))
            if not number.is_finite():
                raise Refusal('Nonfinite budget timestamp')
            if len(number.as_tuple().digits) > 256 or abs(number.as_tuple().exponent) > 256:
                raise Refusal('Unbounded budget timestamp precision')
            instant = Fraction(number)
        except (InvalidOperation, ValueError):
            raise Refusal('Invalid budget timestamp') from None
    elif isinstance(value, str) and len(value) <= 256:
        match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})', value)
        if not match:
            raise Refusal('Budget timestamp requires explicit timezone')
        if match[3] != 'Z' and (int(match[3][1:3]) > 23 or int(match[3][4:6]) > 59):
            raise Refusal('Invalid budget timezone offset')
        try:
            date = datetime.datetime.fromisoformat(match[1] + ('+00:00' if match[3] == 'Z' else match[3]))
            delta = date.astimezone(datetime.timezone.utc) - epoch
            instant = Fraction(delta.days * 86400 + delta.seconds)
            if match[2]:
                instant += Fraction(int(match[2]), 10 ** len(match[2]))
        except (ValueError, OverflowError):
            raise Refusal('Invalid aware budget timestamp') from None
    else:
        raise Refusal('Invalid budget timestamp type')
    seconds = instant.numerator // instant.denominator
    try:
        date = epoch + datetime.timedelta(seconds=seconds)
    except (OverflowError, ValueError):
        raise Refusal('Budget timestamp out of range') from None
    remainder = instant - seconds
    digits = []
    while remainder:
        remainder *= 10
        digit = remainder.numerator // remainder.denominator
        digits.append(str(digit))
        remainder -= digit
        if len(digits) > 256:
            raise Refusal('Unbounded fractional budget timestamp')
    base = date.isoformat(timespec='seconds').replace('+00:00', '')
    normalized = base + ('.' + ''.join(digits) if digits else '') + 'Z'
    if len(normalized) > 256:
        raise Refusal('Unbounded canonical budget timestamp')
    return normalized


def budget_health(config):
    """Keep operational diagnostics separate from configuration/preimages."""
    raw = copy.deepcopy(config.get('HealthStatus'))
    if raw is None and 'HealthStatus' not in config:
        return {'accepted': False, 'status': 'UNAVAILABLE', 'raw': None}
    if not isinstance(raw, dict) or set(raw) - {'Status', 'StatusReason', 'LastUpdatedTime'}:
        raise Refusal('Unknown budget health reporting shape')
    status = raw.get('Status', 'UNAVAILABLE')
    if 'Status' in raw and status not in ('HEALTHY', 'UNHEALTHY'):
        raise Refusal('Unknown budget operational status')
    if 'StatusReason' in raw and raw['StatusReason'] not in (
            'BILLING_VIEW_NO_ACCESS', 'BILLING_VIEW_UNHEALTHY', 'FILTER_INVALID',
            'MULTI_YEAR_HISTORICAL_DATA_DISABLED'):
        raise Refusal('Unknown budget operational reason')
    if 'LastUpdatedTime' in raw:
        budget_time(raw['LastUpdatedTime'])
    return {'accepted': status == 'HEALTHY' and 'StatusReason' not in raw,
            'status': status, 'raw': raw}


def budget_config(config):
    """Budget-specific idempotent normalization; all other fields stay exact."""
    if not isinstance(config, dict):
        raise Refusal('Budget must be an object')
    result = copy.deepcopy(config)
    budget_health(result)
    for key in ('CalculatedSpend', 'LastUpdatedTime', 'HealthStatus'):
        result.pop(key, None)
    result.setdefault('CostFilters', {})
    limit = result.get('BudgetLimit')
    if not isinstance(limit, dict) or limit.get('Unit') != 'USD':
        raise Refusal('Exact USD budget limit required')
    limit['Amount'] = budget_amount(limit.get('Amount'))
    period = result.get('TimePeriod')
    if not isinstance(period, dict) or 'Start' not in period:
        raise Refusal('Pinned budget period start required')
    period.setdefault('End', 3706473600)
    for key in ('Start', 'End'):
        period[key] = budget_time(period[key])
    if not isinstance(result.get('CostTypes'), dict) or any(
            not isinstance(value, bool) for value in result['CostTypes'].values()):
        raise Refusal('Budget cost types require exact booleans')
    return result


def budget_matches(want, have):
    return isinstance(have, dict) and budget_config(want) == budget_config(have)


def notification_config(note, *, percentage_identity=None):
    """No omitted-type default: require the exact independently resolved identity."""
    if not isinstance(note, dict):
        raise Refusal('Invalid budget notification')
    result = copy.deepcopy(note)
    if set(result) - {'NotificationType', 'ComparisonOperator', 'Threshold', 'ThresholdType', 'NotificationState'}:
        raise Refusal('Unknown budget notification field')
    state = result.pop('NotificationState', None)
    if state is not None and state not in ('OK', 'ALARM'):
        raise Refusal('Unknown notification reporting state')
    if 'NotificationState' in note and state is None:
        raise Refusal('Invalid notification reporting state')
    if result.get('NotificationType') not in ('ACTUAL', 'FORECASTED') or result.get('ComparisonOperator') not in (
            'GREATER_THAN', 'LESS_THAN', 'EQUAL_TO'):
        raise Refusal('Invalid notification identity')
    threshold = result.get('Threshold')
    if (isinstance(threshold, bool) or not isinstance(threshold, (int, float)) or
            not 0 <= threshold <= 15000000000000 or not math.isfinite(threshold)):
        raise Refusal('Invalid notification threshold')
    if 'ThresholdType' not in result:
        if not isinstance(percentage_identity, dict) or percentage_identity.get('ThresholdType') != 'PERCENTAGE':
            raise Refusal('Missing threshold type requires exact percentage lookup evidence')
        approved_identity = notification_config(percentage_identity)
        candidate = {**result, 'ThresholdType': 'PERCENTAGE'}
        if notification_identity(candidate) != notification_identity(approved_identity):
            raise Refusal('Missing threshold type differs from resolved percentage identity')
        result['ThresholdType'] = 'PERCENTAGE'
    elif result['ThresholdType'] not in ('PERCENTAGE', 'ABSOLUTE_VALUE'):
        raise Refusal('Invalid explicit threshold type')
    return result


def notification_identity(note):
    """Shared semantic identity; exact Decimal values, never serialized numerals.

    Decimal.from_float preserves the exact already-parsed binary numeric value.
    Equal int/float values share a key; no string coercion or rounding occurs.
    The original threshold representation remains untouched in public records.
    """
    note = notification_config(note)
    value = note['Threshold']
    threshold = Decimal(value) if isinstance(value, int) else Decimal.from_float(value)
    return (note['NotificationType'], note['ComparisonOperator'], threshold, note['ThresholdType'])


def notification_preimage(notes):
    """Canonicalize copies, reject duplicate identities; never infer missing type."""
    result, seen = copy.deepcopy(notes), set()
    for entry in result:
        entry['Notification'] = notification_config(entry['Notification'])
        identity = notification_identity(entry['Notification'])
        if identity in seen:
            raise Refusal('Duplicate budget notification identity')
        seen.add(identity)
    return sorted(result, key=lambda entry: notification_identity(entry['Notification']))


def edge_test_output_matches(output, request, status):
    """TestFunction wraps the returned request/response; validate the full value.

    AWS adds empty cookies to responses. Require that exact default and the
    reviewed status/description/headers; never ignore altered request fields.
    """
    kind = 'request' if status == 0 else 'response'
    if not isinstance(output, dict) or output.keys() != {kind}:
        return False
    payload = output[kind]
    if status == 0:
        return payload == request
    headers = {'cache-control': {'value': 'no-store'},
               'x-content-type-options': {'value': 'nosniff'}}
    if status == 204:
        headers.update({'access-control-allow-origin': {'value': '*'},
            'access-control-allow-methods': {'value': 'GET, HEAD, OPTIONS'},
            'access-control-allow-headers': {'value': 'Range'},
            'access-control-max-age': {'value': '86400'}})
    elif status != 403:
        return False
    expected = {'statusCode': status, 'statusDescription': 'No Content' if status == 204 else 'Forbidden',
                'headers': headers, 'cookies': {}}
    return payload == expected


@contextmanager
def json_pipe(data):
    """Serve at most two bounded memory-only reads for AWS CLI's two loaders.

    Wait for bytes to drain before replacing the first inode and issuing EOF.
    A read-only descriptor queries queued bytes without consuming any payload.
    The second CLI open therefore cannot race onto the first reader's FIFO.
    No payload bytes enter argv, environment, or any regular filesystem file.
    """
    if not isinstance(data, bytes) or not 0 < len(data) <= 256 * 1024:
        raise Refusal('Bounded JSON payload required')
    with tempfile.TemporaryDirectory(prefix='durtal-aws-json-',
                                     dir='/private/tmp' if sys.platform == 'darwin' else None) as temp:
        folder = Path(temp)
        folder.chmod(0o700)
        current, next_pipe = folder / 'input.json', folder / 'next.json'
        os.mkfifo(current, 0o600)
        os.mkfifo(next_pipe, 0o600)
        stop, failures = threading.Event(), []
        deadline = time.monotonic() + 15

        def serve():
            fd = observer = None
            try:
                for index in range(2):
                    while not stop.is_set():
                        if time.monotonic() >= deadline:
                            return
                        try:
                            fd = os.open(current, os.O_WRONLY | os.O_NONBLOCK)
                            break
                        except OSError as error:
                            import errno
                            if error.errno != errno.ENXIO:
                                raise
                            stop.wait(0.005)
                    if fd is None or stop.is_set():
                        return
                    observer = os.open(current, os.O_RDONLY | os.O_NONBLOCK)
                    if os.fstat(observer).st_ino != os.fstat(fd).st_ino:
                        raise Refusal('Private FIFO reader/writer inode mismatch')
                    sent = 0
                    while sent < len(data):
                        if stop.is_set() or time.monotonic() >= deadline:
                            raise Refusal('Bounded FIFO write expired')
                        if not select.select([], [fd], [], 0.05)[1]:
                            continue
                        try:
                            sent += os.write(fd, data[sent:])
                        except BlockingIOError:
                            continue
                    # On macOS, unlinking the first FIFO before its reader has
                    # consumed data can leave read-all waiting after writer EOF.
                    # FIONREAD works on the read descriptor (not the write one).
                    while struct.unpack('i', fcntl.ioctl(observer, termios.FIONREAD, struct.pack('i', 0)))[0]:
                        if stop.is_set():
                            return
                        if time.monotonic() >= deadline:
                            raise Refusal('Bounded FIFO drain expired')
                        stop.wait(0.005)
                    if index == 0:
                        os.replace(next_pipe, current)
                    os.close(fd)
                    fd = None
                    os.close(observer)
                    observer = None
            except Exception:
                failures.append(True)
            finally:
                if fd is not None:
                    os.close(fd)
                if observer is not None:
                    os.close(observer)

        worker = threading.Thread(target=serve, daemon=True)
        worker.start()
        try:
            yield 'file://' + str(current)
            if failures:
                raise Refusal('Private FIFO transport failed; payload withheld')
        finally:
            stop.set()
            worker.join(timeout=1)
            if worker.is_alive():
                raise Refusal('Private FIFO writer did not stop')

class Aws:
    def __init__(self, account, admin, run=subprocess.run):
        if not re.fullmatch(r'\d{12}', account) or not re.fullmatch(r'arn:aws:iam::' + account + r':role/[A-Za-z0-9_+=,.@/-]+', admin):
            raise Refusal('Expected personal account and exact IAM administrator role required')
        self.account, self.admin, self.run = account, admin, run
        self.allow_writes = False
        self.mutation_guard = None

    def call(self, service, operation, arguments=(), document=None, missing=None):
        if service not in ENDPOINTS:
            raise Refusal('Unsupported AWS service')
        mutable = operation in MUTATIONS.get(service, set())
        if not mutable and not operation.startswith(('get-', 'list-', 'describe-', 'head-', 'test-')):
            raise Refusal('Operation is outside the read/write allowlist')
        if mutable:
            if not self.allow_writes:
                raise Refusal('Writes require an approved phase')
            if '--id' in arguments and arguments[list(arguments).index('--id') + 1] in PROTECTED:
                raise Refusal('Protected distribution cannot be mutated')
            if not self.mutation_guard:
                raise Refusal('Mutation requires source-bound phase guard')
            self.mutation_guard()
            self.identity()
        args = ['aws', service, operation, *arguments, '--profile', PROFILE, '--region', REGION,
                '--no-cli-pager', '--no-cli-auto-prompt', '--cli-binary-format', 'base64', '--output', 'json']
        # Global services must keep AWS's canonical signing-region resolution.
        if ENDPOINTS[service]:
            args += ['--endpoint-url', ENDPOINTS[service]]
        if document is not None:
            # CLI v2 loads this reference twice; a stdin stream cannot replay.
            # FIFO bytes stay in kernel/process memory, never argv or disk.
            with json_pipe(canonical(document)) as reference:
                result = self.run([*args, '--cli-input-json', reference], env=aws_environment(),
                                  input=None, capture_output=True, timeout=120)
        else:
            result = self.run(args, env=aws_environment(), input=None, capture_output=True)
        if result.returncode:
            error = result.stderr.decode(errors='replace') if isinstance(result.stderr, bytes) else result.stderr
            match = re.search(r'An error occurred \(([A-Za-z0-9]+)\)', error or '')
            code = match[1] if match else 'Unavailable'
            if code == missing and code in ABSENT:
                return None
            raise AwsError(code, service + '/' + operation)
        try:
            output = result.stdout.decode() if isinstance(result.stdout, bytes) else result.stdout
            return json.loads(output) if output.strip() else {}
        except (ValueError, UnicodeError):
            raise Refusal('Unexpected AWS response; output withheld') from None

    def identity(self):
        identity = self.call('sts', 'get-caller-identity')
        role = self.admin.rsplit('/', 1)[-1]
        assumed = 'arn:aws:sts::%s:assumed-role/%s/' % (self.account, role)
        arn = identity.get('Arn', '')
        if identity.get('Account') != self.account or not (arn == self.admin or arn.startswith(assumed)):
            raise Refusal('Exact personal account/administrator identity guard failed')

    def guard(self):
        self.identity()
        result = self.call('s3api', 'get-bucket-location', self.owner_args())
        if result.get('LocationConstraint') != REGION:
            raise Refusal('Expected bucket owner/region guard failed')

    def owner_args(self):
        return ['--bucket', BUCKET, '--expected-bucket-owner', self.account]


class Control:
    def __init__(self, aws, state_dir, secrets=None):
        self.aws, self.secrets = aws, secrets
        self._approved = None
        self._approved_package = None
        self.state_dir = private_directory(state_dir)
        if self.state_dir.resolve().is_relative_to(ROOT):
            raise Refusal('Operation state must live outside repository')
        self.state_path = self.state_dir / 'state.json'
        self.binding = {'account': aws.account, 'admin': aws.admin, 'profile': PROFILE, 'region': REGION, 'bucket': BUCKET}
        self.state = json.loads(private_read(self.state_path)) if self.state_path.exists() else {'binding': self.binding, 'resources': {}, 'pending': []}
        if self.state.get('binding') != self.binding:
            raise Refusal('State storage/credential binding changed')

    def persist(self):
        public_json(self.state_path, self.state)

    def secret_store(self):
        if self.secrets is None:
            self.secrets = keychain()
        return self.secrets

    def mapping(self):
        ids = self.state['resources']
        fingerprint = self.state.get('fingerprint', '__PUBLIC_KEY_SHA256__')
        return {'ACCOUNT': self.aws.account, 'BUCKET': BUCKET, 'REGION': REGION,
                'NEW_OAC_ID': ids.get('oac', '__NEW_OAC_ID__'),
                'NEW_CACHE_POLICY_ID': ids.get('cache', '__NEW_CACHE_POLICY_ID__'),
                'NEW_RESPONSE_HEADERS_POLICY_ID': ids.get('headers', '__NEW_RESPONSE_HEADERS_POLICY_ID__'),
                'NEW_PUBLIC_KEY_ID': ids.get('public_key', '__NEW_PUBLIC_KEY_ID__'),
                'NEW_KEY_GROUP_ID': ids.get('key_group', '__NEW_KEY_GROUP_ID__'),
                'NEW_DISTRIBUTION_ID': ids.get('distribution', '__NEW_DISTRIBUTION_ID__'),
                'PUBLIC_KEY_SHA256': fingerprint, 'PUBLIC_KEY_SHA256_12': fingerprint[:12] if self.state.get('fingerprint') else '__PUBLIC_KEY_SHA256_12__',
                'PUBLIC_RSA_2048_PEM': self.state.get('public_pem', '__PUBLIC_RSA_2048_PEM__')}

    def documents(self):
        mapping = self.mapping()
        docs = {name: template(name, mapping) for name in TEMPLATE_FILES if name.endswith('.json')}
        now = datetime.datetime.now(datetime.timezone.utc)
        month_start = int(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp())
        # Pin the AWS monthly start default in the review and recovery state.
        docs['budget.json']['TimePeriod'] = {'Start': self.state.get('budget_start', month_start)}
        return docs

    def inventory(self):
        result = {}
        calls = [('oac', 'list-origin-access-controls', 'OriginAccessControlList', 'Items', None, 'Name'),
                 ('cache', 'list-cache-policies', 'CachePolicyList', 'Items', 'CachePolicy', 'CachePolicyConfig'),
                 ('headers', 'list-response-headers-policies', 'ResponseHeadersPolicyList', 'Items', 'ResponseHeadersPolicy', 'ResponseHeadersPolicyConfig'),
                 ('public_key', 'list-public-keys', 'PublicKeyList', 'Items', None, 'Name'),
                 ('key_group', 'list-key-groups', 'KeyGroupList', 'Items', 'KeyGroup', 'KeyGroupConfig'),
                 ('function', 'list-functions', 'FunctionList', 'Items', None, 'Name'),
                 ('distribution', 'list-distributions', 'DistributionList', 'Items', None, 'Comment')]
        for kind, op, outer, items, wrapper, name_field in calls:
            args = (['--type', 'custom'] if kind in ('cache', 'headers') else
                    ['--stage', 'DEVELOPMENT'] if kind == 'function' else [])
            entries = self.aws.call('cloudfront', op, args).get(outer, {}).get(items, [])
            found = []
            for entry in entries:
                obj = entry[wrapper] if wrapper else entry
                label = obj.get(name_field)
                if isinstance(label, dict):
                    label = label.get('Name')
                if (kind == 'public_key' and str(label or '').startswith('durtal-ebooks-')) or label == ('durtal-ebooks' if kind == 'distribution' else NAMES.get(kind)):
                    found.append(obj)
            if kind == 'public_key' and self.state.get('fingerprint'):
                expected = 'durtal-ebooks-' + self.state['fingerprint'][:12]
                if any(x.get('Name') != expected for x in found):
                    raise Refusal('Unexpected public key in owned namespace; rotation needs review')
            if len(found) > 1:
                raise Refusal('Ambiguous resource namespace')
            obj = found[0] if found else None
            if kind == 'function' and obj:
                self.validate_function_identity(obj, 'DEVELOPMENT')
            identifier = (obj.get('Name') if kind == 'function' else obj.get('Id')) if obj else None
            if identifier in PROTECTED:
                raise Refusal('Protected distribution cannot be adopted')
            owned = self.state['resources'].get(kind)
            if obj and identifier != owned and kind not in self.state.get('pending', []):
                raise Refusal('Unowned resource/name collision; refusing adoption')
            if owned and identifier != owned:
                raise Refusal('Previously owned resource is missing or changed')
            result[kind] = obj
        return result

    def validate_function_identity(self, summary, stage):
        metadata = summary.get('FunctionMetadata', {})
        expected = 'arn:aws:cloudfront::%s:function/%s' % (self.aws.account, NAMES['function'])
        if (summary.get('Name') != NAMES['function'] or metadata.get('FunctionARN') != expected or
                metadata.get('Stage') != stage):
            raise Refusal('Owned function identity/stage changed')

    def function_code(self, stage='LIVE'):
        with tempfile.TemporaryDirectory(prefix='durtal-function-') as temp:
            path = Path(temp) / 'public.js'
            result = self.aws.call('cloudfront', 'get-function', ['--name', NAMES['function'], '--stage', stage, str(path)])
            return file_hash(path), result

    def validate_inventory(self, inventory):
        docs = self.documents()
        filenames = {'oac': 'origin-access-control.json', 'cache': 'cache-policy.json',
                     'headers': 'response-headers-policy.json', 'public_key': 'public-key-config.json',
                     'key_group': 'key-group-config.json'}
        for kind, filename in filenames.items():
            obj = inventory.get(kind)
            if not obj:
                continue
            config = {k: v for k, v in obj.items() if k != 'Id'} if kind == 'oac' else obj.get(CREATE[kind][1], obj)
            # ListPublicKeys omits CallerReference; fetch the complete config.
            if kind == 'public_key':
                config = self.aws.call('cloudfront', 'get-public-key', ['--id', obj['Id']])['PublicKey']['PublicKeyConfig']
            matches = headers_matches if kind == 'headers' else equivalent
            if not matches(docs[filename], config):
                raise Refusal('Owned %s configuration drifted' % kind)
        if inventory.get('function'):
            stages = {}
            for stage in ('DEVELOPMENT', 'LIVE'):
                obj = self.aws.call('cloudfront', 'describe-function', ['--name', NAMES['function'], '--stage', stage],
                                    missing='NoSuchFunctionExists' if stage == 'LIVE' else None)
                if obj is None:
                    if inventory.get('distribution'):
                        raise Refusal('Owned distribution requires a LIVE function')
                    stages[stage] = None
                    continue
                self.validate_function_identity(obj['FunctionSummary'], stage)
                config = copy.deepcopy(obj['FunctionSummary']['FunctionConfig'])
                if equivalent({'Quantity': 0}, config.get('KeyValueStoreAssociations')):
                    config.pop('KeyValueStoreAssociations')
                if not equivalent(docs['function-config.json'], config):
                    raise Refusal('Owned %s function configuration drifted' % stage)
                code_hash, code = self.function_code(stage)
                if code_hash != file_hash(TEMPLATES / 'viewer-request.js') or code['ETag'] != obj['ETag']:
                    raise Refusal('Owned %s function code/version drifted' % stage)
                stages[stage] = {'sha256': code_hash, 'ETag': obj['ETag'], 'FunctionConfig': config}
            inventory['function_stages'] = stages
        if inventory.get('distribution'):
            distribution = self.aws.call('cloudfront', 'get-distribution-config', ['--id', inventory['distribution']['Id']])
            want = docs['distribution.json']
            want['Enabled'] = distribution['DistributionConfig'].get('Enabled')
            if not distribution_matches(want, distribution['DistributionConfig']):
                raise Refusal('Owned distribution topology drifted')
            tags = self.aws.call('cloudfront', 'list-tags-for-resource', ['--resource', 'arn:aws:cloudfront::%s:distribution/%s' % (self.aws.account, inventory['distribution']['Id'])])
            if sorted(tags.get('Tags', {}).get('Items', []), key=lambda x: x['Key']) != sorted(docs['resource-tags.json']['Items'], key=lambda x: x['Key']):
                raise Refusal('Owned distribution tags drifted')
            inventory['distribution_config'] = distribution

    def snapshot(self):
        self.aws.guard()
        bucket = self.aws.call('s3api', 'get-bucket-policy', self.aws.owner_args(), missing='NoSuchBucketPolicy')
        bucket = json.loads(bucket['Policy']) if bucket else {'Version': '2012-10-17', 'Statement': []}
        shared = {}
        for label, operation in [('lifecycle', 'get-bucket-lifecycle-configuration'), ('versioning', 'get-bucket-versioning'),
                                 ('encryption', 'get-bucket-encryption'), ('ownership', 'get-bucket-ownership-controls'),
                                 ('public_access', 'get-public-access-block'), ('cors', 'get-bucket-cors')]:
            shared[label] = self.aws.call('s3api', operation, self.aws.owner_args())
        protected = {id: self.aws.call('cloudfront', 'get-distribution-config', ['--id', id]) for id in PROTECTED}
        app = self.aws.call('iam', 'get-user-policy', ['--user-name', 'durtal-app', '--policy-name', 'durtal-ebooks-multipart'])
        managed = self.aws.call('iam', 'list-attached-user-policies', ['--user-name', 'durtal-app'])
        managed['Documents'] = {}
        for policy in managed.get('AttachedPolicies', []):
            arn = policy['PolicyArn']
            metadata = self.aws.call('iam', 'get-policy', ['--policy-arn', arn])['Policy']
            managed['Documents'][arn] = self.aws.call('iam', 'get-policy-version', ['--policy-arn', arn,
                '--version-id', metadata['DefaultVersionId']])['PolicyVersion']
        inventory = self.inventory()
        self.validate_inventory(inventory)
        budget_read, _ = self.read_budget()
        if budget_read['budget'] and not self.state.get('budget_owned') and 'budget' not in self.state.get('pending', []):
            raise Refusal('Existing budget is unowned; refusing adoption')
        result = {'binding': self.binding, 'bucket_policy': bucket, 'shared_bucket': shared, 'protected': protected,
                  'app_inline': app, 'app_managed': managed, 'inventory': inventory,
                  **budget_read}
        return result

    def expected(self, phase, snapshot):
        docs = self.documents()
        if phase == 'publish':
            if not snapshot['inventory'].get('function_stages', {}).get('LIVE'):
                raise Refusal('Publish requires validated LIVE function code/configuration')
            ids = self.state['resources']
            if any(not ids.get(kind) for kind in (*CREATE, 'function', 'distribution')):
                raise Refusal('Bootstrap must finish before concrete publish plan')
            statement = docs['cloudfront-bucket-statement.json']
            current = snapshot['bucket_policy']
            old = [s for s in current['Statement'] if s.get('Sid') == SID]
            if old and old != [statement]:
                raise Refusal('Existing ebook CloudFront grant drifted')
            docs['bucket-policy.after.json'] = {**current, 'Statement': [s for s in current['Statement'] if s.get('Sid') != SID] + [statement]}
            # UpdateDistribution replaces the entire config; preserve every
            # validated returned field, including required nested defaults.
            docs['distribution.json'] = copy.deepcopy(snapshot['inventory']['distribution_config']['DistributionConfig'])
            docs['distribution.json']['Enabled'] = True
        return docs

    def plan(self, phase, output):
        snapshot = self.snapshot()
        documents = self.expected(phase, snapshot)
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        package = {'version': 1, 'phase': phase, 'binding': self.binding, 'source_head': head,
                   'source_files': source_binding(), 'state': copy.deepcopy(self.state), 'before': snapshot,
                   'documents': documents, 'viewer_sha256': file_hash(TEMPLATES / 'viewer-request.js')}
        # The artifact hash supplied by the coordinator is the approval anchor.
        public_json(private_directory(output, True) / 'plan.json', package)
        return digest(package)

    def approved(self, directory, expected_hash, phase):
        package = json.loads(private_read(private_directory(directory) / 'plan.json'))
        if not re.fullmatch(r'[a-f0-9]{64}', expected_hash or '') or digest(package) != expected_hash:
            raise Refusal('Approved artifact hash mismatch')
        if package['phase'] != phase or package['binding'] != self.binding or package['source_files'] != source_binding():
            raise Refusal('Approved source/phase/storage binding changed')
        current_head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        if current_head != package['source_head']:
            raise Refusal('Approved source commit changed')
        # Only owned bootstrap resources created by this operation may differ on resumption.
        before, current = package['before'], self.snapshot()
        for field in ('binding', 'shared_bucket', 'protected', 'app_inline', 'app_managed', 'bucket_policy'):
            if current[field] != before[field]:
                if phase == 'publish' and field == 'bucket_policy' and current[field] == package['documents']['bucket-policy.after.json']:
                    continue
                raise Refusal('Reviewed baseline drifted: ' + field)
        if phase != 'bootstrap' and self.state != package['state']:
            before_state, after_state = copy.deepcopy(package['state']), copy.deepcopy(self.state)
            if phase == 'budget':
                for item in (before_state, after_state):
                    item.pop('budget_owned', None)
                    item.pop('budget_progress', None)
                    item.pop('budget_start', None)
                    item['pending'] = [k for k in item['pending'] if k != 'budget']
            if before_state != after_state:
                raise Refusal('Reviewed operation state changed; make fresh phase plan')
        if phase == 'bootstrap':
            for field in ('budget', 'notifications'):
                if current[field] != before[field]:
                    raise Refusal('Reviewed budget baseline drifted')
        elif phase == 'budget':
            if self.state.get('budget_start', package['documents']['budget.json']['TimePeriod']['Start']) != package['documents']['budget.json']['TimePeriod']['Start']:
                raise Refusal('Reviewed budget start changed')
            self.check_budget_preimage(package, current)
        if phase != 'bootstrap' and current['inventory'].get('function_stages') != before['inventory'].get('function_stages'):
            raise Refusal('Reviewed function stage code/configuration/ETag drifted')
        self.aws.allow_writes = True
        self._approved = (phase, digest(package))
        self._approved_package = copy.deepcopy(package)
        self.aws.mutation_guard = self.ensure_source
        return package

    def ensure_source(self):
        if not self._approved_package or source_binding() != self._approved_package['source_files']:
            raise Refusal('Reviewed source changed during operation')
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        if head != self._approved_package['source_head']:
            raise Refusal('Reviewed source commit changed during operation')

    def require_phase(self, package, phase):
        if self._approved != (phase, digest(package)) or not self.aws.allow_writes:
            raise Refusal('This exact phase has not been approved')
        self.ensure_source()

    def pending(self, kind):
        if kind not in self.state['pending']:
            self.state['pending'].append(kind)
            self.persist()

    def completed(self, kind, identifier):
        self.state['resources'][kind] = identifier
        self.state['pending'] = [k for k in self.state['pending'] if k != kind]
        self.persist()

    def generate_key(self):
        if not self._approved or self._approved[0] != 'bootstrap' or not self.aws.allow_writes:
            raise Refusal('Signing-key provisioning requires approved bootstrap')
        self.ensure_source()
        if self.state.get('fingerprint'):
            secret = self.secret_store().get(KEY_SERVICE, self.aws.account + ':' + self.state['fingerprint'])
            if not secret:
                raise Refusal('Recorded signing secret is missing; explicit recovery review required')
            public = openssl(['pkey', '-pubout'], secret).decode()
            if public != self.state['public_pem']:
                raise Refusal('Recorded public/private signing key mismatch')
            return
        private = openssl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048'])
        public = openssl(['pkey', '-pubout'], private).decode()
        fingerprint = hashlib.sha256(public.encode()).hexdigest()
        self.state.update(public_pem=public, fingerprint=fingerprint)
        self.persist()  # Write public identity before any secret/AWS write.
        self.secret_store().put_once(KEY_SERVICE, self.aws.account + ':' + fingerprint, private)

    def bootstrap(self, package, email=None):
        self.require_phase(package, 'bootstrap')
        store = self.secret_store()
        current = store.get(EMAIL_SERVICE, self.aws.account)
        if email is not None:
            value = checked_email(email)
            store.put_once(EMAIL_SERVICE, self.aws.account, value)
        elif not current:
            raise Refusal('Reusable budget recipient missing; supply private stdin during approved bootstrap')
        self.generate_key()
        docs = self.documents()
        for kind in ('oac', 'public_key', 'key_group', 'cache', 'headers'):
            inventory = self.inventory()
            if inventory[kind]:
                self.validate_inventory(inventory)
                self.completed(kind, inventory[kind]['Id'])
                continue
            operation, field, response = CREATE[kind]
            self.pending(kind)
            docs = self.documents()
            filename = {'oac': 'origin-access-control.json', 'public_key': 'public-key-config.json',
                        'key_group': 'key-group-config.json', 'cache': 'cache-policy.json',
                        'headers': 'response-headers-policy.json'}[kind]
            obj = self.aws.call('cloudfront', operation, document={field: docs[filename]})[response]
            self.completed(kind, obj['Id'])
        inventory = self.inventory()
        if not inventory['function']:
            self.pending('function')
            result = self.aws.call('cloudfront', 'create-function', ['--name', NAMES['function'], '--function-code',
                'fileb://' + str(TEMPLATES / 'viewer-request.js')], document={'FunctionConfig': docs['function-config.json']})
            self.completed('function', result['FunctionSummary']['Name'])
        inventory = self.inventory()
        self.validate_inventory(inventory)
        if 'function' in self.state['pending'] and inventory['function']:
            self.completed('function', inventory['function']['Name'])
        description = self.aws.call('cloudfront', 'describe-function', ['--name', NAMES['function'], '--stage', 'DEVELOPMENT'])
        self.test_function(description['ETag'])
        # Publish once; resume verifies identical live code rather than publishing again.
        live = self.aws.call('cloudfront', 'describe-function', ['--name', NAMES['function'], '--stage', 'LIVE'], missing='NoSuchFunctionExists')
        if live:
            if self.function_code()[0] != file_hash(TEMPLATES / 'viewer-request.js'):
                raise Refusal('Live function drifted; explicit review required')
        else:
            self.aws.call('cloudfront', 'publish-function', ['--name', NAMES['function'], '--if-match', description['ETag']])
        inventory = self.inventory()
        if not inventory['distribution']:
            self.pending('distribution')
            docs = self.documents()
            result = self.aws.call('cloudfront', 'create-distribution-with-tags', document={
                'DistributionConfigWithTags': {'DistributionConfig': docs['distribution.json'], 'Tags': docs['resource-tags.json']}})
            obj = result['Distribution']
            if obj['Id'] in PROTECTED:
                raise Refusal('Unexpected protected distribution result')
            self.completed('distribution', obj['Id'])
        elif 'distribution' in self.state['pending']:
            self.validate_inventory(inventory)
            self.completed('distribution', inventory['distribution']['Id'])
        self.validate_inventory(self.inventory())
        domain = self.aws.call('cloudfront', 'get-distribution', ['--id', self.state['resources']['distribution']])['Distribution']['DomainName']
        if not re.fullmatch(r'[a-z0-9]+\.cloudfront\.net', domain):
            raise Refusal('Unexpected CloudFront domain')
        self.state['domain'] = domain
        self.persist()

    def test_function(self, etag):
        sha, report = 'a' * 64, 'b' * 64
        valid = '/gold/ebooks/epub/aa/%s/file.epub' % sha
        cases = [(valid, 'GET', 0), (valid, 'HEAD', 0), (valid, 'OPTIONS', 204),
                 ('/gold/media/cover.webp', 'GET', 403), ('/bronze/ebooks/epub/aa/%s/source.epub' % sha, 'GET', 403)]
        for inherited in ('constructor', '__proto__', 'toString', 'tostring'):
            cases += [('/gold/ebooks/%s/aa/%s/derived/v2/%s/cover-240.webp' % (inherited, sha, report), method, 403)
                      for method in ('GET', 'HEAD', 'OPTIONS')]
        for path, method, status in cases:
            request = {'uri': path, 'method': method, 'querystring': {}, 'cookies': {}, 'headers': {}}
            if method == 'OPTIONS':
                request['headers'] = {'origin': {'value': 'https://test.invalid'},
                    'access-control-request-method': {'value': 'GET'}, 'access-control-request-headers': {'value': 'Range'}}
            event = {'version': '1.0', 'context': {'eventType': 'viewer-request'}, 'viewer': {'ip': '192.0.2.1'}, 'request': request}
            result = self.aws.call(
                'cloudfront', 'test-function', document={'Name': NAMES['function'], 'IfMatch': etag,
                                                       'EventObject': base64.b64encode(canonical(event)).decode()})
            execution = result['TestResult']
            if execution.get('FunctionErrorMessage') or execution.get('FunctionExecutionLogs'):
                raise Refusal('Edge test failed or emitted unexpected logs')
            output = json.loads(execution['FunctionOutput'])
            if not edge_test_output_matches(output, request, status):
                raise Refusal('Edge path/preflight test failed')

    def publish(self, package):
        self.require_phase(package, 'publish')
        self.check_function_preimage(package)
        wanted_policy = package['documents']['bucket-policy.after.json']
        current = self.aws.call('s3api', 'get-bucket-policy', self.aws.owner_args())
        current = json.loads(current['Policy'])
        if current != wanted_policy:
            if current != package['before']['bucket_policy']:
                raise Refusal('Bucket policy changed immediately before put')
            self.aws.call('s3api', 'put-bucket-policy', document={'Bucket': BUCKET, 'ExpectedBucketOwner': self.aws.account,
                                                              'Policy': json.dumps(wanted_policy)})
        id = self.state['resources']['distribution']
        self.check_function_preimage(package)
        live = self.aws.call('cloudfront', 'get-distribution-config', ['--id', id])
        want = package['documents']['distribution.json']
        if not distribution_matches(want, live['DistributionConfig']):
            approved = package['before']['inventory']['distribution_config']
            if live != approved:
                raise Refusal('Distribution drift immediately before enable')
            config = copy.deepcopy(live['DistributionConfig'])
            config['Enabled'] = want['Enabled']
            self.aws.call('cloudfront', 'update-distribution', ['--id', id, '--if-match', live['ETag']],
                          document={'DistributionConfig': config})

    def check_function_preimage(self, package):
        inventory = self.inventory()
        self.validate_inventory(inventory)
        if inventory.get('function_stages') != package['before']['inventory'].get('function_stages'):
            raise Refusal('Reviewed function stage changed immediately before publish')

    def read_budget(self):
        """Complete current reads; private identities remain only in memory.

        Missing ThresholdType needs the exact reviewed three-note context,
        fresh explicit PERCENTAGE lookups and matching intended recipient.
        Public evidence is carried in source-bound snapshots for fresh review.
        """
        response = self.aws.call('budgets', 'describe-budget', ['--account-id', self.aws.account,
            '--budget-name', 'durtal-monthly'], missing='NotFoundException')
        if not response:
            return {'budget': None, 'notifications': [], 'budget_evidence': {
                'normalization_policy': 1, 'health': {'accepted': False, 'status': 'ABSENT', 'raw': None},
                'complete_notification_read': True, 'percentage_lookups': [],
                'all_present_recipients_match_intended': False}}, []
        budget = response['Budget']
        page = self.aws.call('budgets', 'describe-notifications-for-budget', ['--account-id', self.aws.account,
            '--budget-name', 'durtal-monthly'])
        if page.get('NextToken') or not isinstance(page.get('Notifications'), list):
            raise Refusal('Incomplete budget notification pagination')
        raw_notes = page['Notifications']
        if any(not isinstance(note, dict) for note in raw_notes):
            raise Refusal('Invalid budget notification list shape')
        desired = [notification_config(x['Notification']) for x in self.documents()['budget-notifications.json']]
        omissions = any(isinstance(n, dict) and 'ThresholdType' not in n for n in raw_notes)
        resolved = []
        if omissions:
            if len(raw_notes) != len(desired) or len(desired) != 3:
                raise Refusal('Omitted threshold type requires exact reviewed cardinality')
            for note in raw_notes:
                matches = []
                for want in desired:
                    if want['ThresholdType'] != 'PERCENTAGE':
                        continue
                    try:
                        candidate = notification_config(note, percentage_identity=want)
                    except Refusal:
                        continue
                    if notification_identity(candidate) == notification_identity(want):
                        matches.append(want)
                if len(matches) != 1:
                    raise Refusal('Omitted threshold list has unexpected identity/field')
                resolved.append(matches[0])
            if len({notification_identity(n) for n in resolved}) != len(desired):
                raise Refusal('Omitted threshold list contains duplicate identities')
        else:
            resolved = [notification_config(n) for n in raw_notes]
        if len({notification_identity(n) for n in resolved}) != len(resolved):
            raise Refusal('Duplicate budget notification identity')
        email = self.secret_store().get(EMAIL_SERVICE, self.aws.account) if raw_notes else None
        if raw_notes and not email:
            raise Refusal('Budget recipient unavailable for private identity check')
        intended = checked_email(email).decode() if email else None
        public, private, proofs = [], [], []
        for raw, identity in zip(raw_notes, resolved):
            lookup = self.aws.call('budgets', 'describe-subscribers-for-notification', document={
                'AccountId': self.aws.account, 'BudgetName': 'durtal-monthly', 'Notification': identity})
            if lookup.get('NextToken') or not isinstance(lookup.get('Subscribers'), list):
                raise Refusal('Incomplete budget subscriber pagination')
            subscribers = lookup['Subscribers']
            recipient_match = subscribers == [{'SubscriptionType': 'EMAIL', 'Address': intended}]
            if omissions and not recipient_match:
                raise Refusal('Omitted threshold identity lacks exact intended-recipient proof')
            normalized = notification_config(raw, percentage_identity=identity if omissions else None)
            public.append({'Notification': normalized, 'Subscribers': [
                {'SubscriptionType': x['SubscriptionType'], 'Address': '__ALERT_EMAIL_FROM_KEYCHAIN__'}
                for x in subscribers]})
            private.append({'Notification': normalized, 'Subscribers': subscribers})
            proofs.append({'identity': normalized, 'explicit_percentage_lookup': omissions,
                           'single_intended_email_recipient': recipient_match,
                           'raw_notification': copy.deepcopy(raw)})
        result = {'budget': copy.deepcopy(budget), 'notifications': notification_preimage(public),
                  'budget_evidence': {'normalization_policy': 1, 'health': budget_health(budget),
                    'complete_notification_read': True, 'percentage_lookups': proofs,
                    'all_present_recipients_match_intended': bool(private) and
                        all(x['single_intended_email_recipient'] for x in proofs)}}
        return result, private

    def budget_snapshot(self):
        current, _ = self.read_budget()
        return self.budget_preimage(current)

    @staticmethod
    def budget_preimage(snapshot):
        return {'budget': budget_config(snapshot['budget']) if snapshot['budget'] else None,
                'notifications': notification_preimage(snapshot['notifications'])}

    def check_budget_preimage(self, package, snapshot):
        before = self.budget_preimage(package['before'])
        current = self.budget_preimage(snapshot)
        progress = self.state.get('budget_progress', {})
        if progress.get('plan_sha256') == digest(package):
            steps = progress.get('steps', [])
            expected = before
            for index, step in enumerate(steps):
                if index < len(steps) - 1 and not step.get('confirmed'):
                    raise Refusal('Unconfirmed budget recovery step precedes later work')
                normalized_before = self.budget_preimage(step['before'])
                normalized_after = self.budget_preimage(step['after'])
                if normalized_before != expected:
                    raise Refusal('Budget recovery preimage chain changed')
                expected = normalized_after
            # Last step may have lost its response, or may not yet have run.
            allowed = [expected] + ([self.budget_preimage(steps[-1]['before'])] if steps and not steps[-1].get('confirmed') else [])
        else:
            allowed = [before]
        if current not in allowed:
            raise Refusal('Reviewed budget/notification/subscriber preimage drifted; fresh review required')
        return current

    def budget_write(self, package, operation, document):
        before = self.check_budget_preimage(package, self.budget_snapshot())
        after = copy.deepcopy(before)
        def sanitized(entry):
            return {'Notification': entry['Notification'], 'Subscribers': [
                {'SubscriptionType': s['SubscriptionType'], 'Address': '__ALERT_EMAIL_FROM_KEYCHAIN__'}
                for s in entry['Subscribers']]}
        if operation == 'create-budget':
            after = {'budget': budget_config(document['Budget']),
                     'notifications': notification_preimage([sanitized(e) for e in document['NotificationsWithSubscribers']])}
        elif operation == 'update-budget':
            after['budget'] = budget_config(document['NewBudget'])
        elif operation == 'create-notification':
            after['notifications'].append(sanitized(document))
        elif operation == 'create-subscriber':
            note = next(n for n in after['notifications']
                        if notification_identity(n['Notification']) == notification_identity(document['Notification']))
            note['Subscribers'].append({'SubscriptionType': document['Subscriber']['SubscriptionType'],
                                       'Address': '__ALERT_EMAIL_FROM_KEYCHAIN__'})
        else:
            raise Refusal('Unreviewed budget recovery operation')
        after['notifications'] = notification_preimage(after['notifications'])
        progress = self.state.get('budget_progress', {})
        if progress.get('plan_sha256') != digest(package):
            progress = {'plan_sha256': digest(package), 'steps': []}
        steps = progress['steps']
        step = {'before': before, 'after': after, 'confirmed': False}
        if steps and before == self.budget_preimage(steps[-1]['before']):
            prior = copy.deepcopy(steps[-1])
            prior['before'] = self.budget_preimage(prior['before'])
            prior['after'] = self.budget_preimage(prior['after'])
            if step != prior:
                raise Refusal('Pending budget recovery operation differs')
        else:
            steps.append(step)
        self.state['budget_progress'] = progress
        self.persist()  # Public exact intent before write: also covers lost responses.
        self.aws.call('budgets', operation, document=document)
        current, _ = self.read_budget()
        if self.budget_preimage(current) != after:
            raise Refusal('Budget mutation outcome differs; fresh review required')
        if (not current['budget_evidence']['all_present_recipients_match_intended'] or
                not current['budget_evidence']['health']['accepted']):
            raise Refusal('Budget outcome lacks private recipient or healthy acceptance')
        steps[-1]['confirmed'] = True
        self.persist()

    def budget(self, package):
        self.require_phase(package, 'budget')
        # Do not silently confirm an ambiguous old outcome or reset its journal.
        # Ledger-only recovery needs separate causal proof and fresh approval;
        # no such recovery capability is introduced by this source correction.
        if any(not step.get('confirmed') for step in self.state.get('budget_progress', {}).get('steps', [])):
            raise Refusal('Unconfirmed budget outcome requires separately reviewed ownership recovery')
        self.check_budget_preimage(package, self.budget_snapshot())
        email = self.secret_store().get(EMAIL_SERVICE, self.aws.account)
        if not email:
            raise Refusal('Reusable budget recipient is unavailable')
        email = checked_email(email)
        desired = substitute(package['documents']['budget-notifications.json'], {'ALERT_EMAIL_FROM_KEYCHAIN': email.decode()})
        for entry in desired:
            entry['Notification'] = notification_config(entry['Notification'])
        current, entries = self.read_budget()
        account = self.aws.account
        if current['budget'] and not current['budget_evidence']['health']['accepted']:
            raise Refusal('Existing budget operational health not accepted; no repair')
        jobs = []
        if current['budget']:
            if not self.state.get('budget_owned'):
                raise Refusal('Existing unowned budget requires causal ownership recovery')
            desired_identities = {notification_identity(d['Notification']) for d in desired}
            if any(notification_identity(n['Notification']) not in desired_identities for n in entries):
                raise Refusal('Unexpected budget notification; no deletion or replacement')
            for entry in desired:
                note = entry['Notification']
                args = {'AccountId': account, 'BudgetName': 'durtal-monthly', 'Notification': note}
                actual = next((x['Subscribers'] for x in entries
                               if notification_identity(x['Notification']) == notification_identity(note)), None)
                if actual is None:
                    jobs.append(('create-notification', {**args, 'Subscribers': entry['Subscribers']}))
                elif actual != entry['Subscribers']:
                    if actual:
                        raise Refusal('Unexpected subscriber; identity withheld, explicit review required')
                    jobs.append(('create-subscriber', {**args, 'Subscriber': entry['Subscribers'][0]}))
        self.state['budget_start'] = package['documents']['budget.json']['TimePeriod']['Start']
        self.persist()
        if not current['budget']:
            self.pending('budget')
            self.budget_write(package, 'create-budget', {'AccountId': account, 'Budget': package['documents']['budget.json'],
                                                        'NotificationsWithSubscribers': desired})
        else:
            if not budget_matches(package['documents']['budget.json'], current['budget']):
                self.budget_write(package, 'update-budget', {'AccountId': account, 'NewBudget': package['documents']['budget.json']})
            for operation, document in jobs:
                self.budget_write(package, operation, document)
        self.verify_budget()
        self.state['budget_owned'] = True
        self.state['pending'] = [k for k in self.state['pending'] if k != 'budget']
        self.persist()

    def verify_budget(self):
        docs = self.documents()
        current, private = self.read_budget()
        if not current['budget'] or not budget_matches(docs['budget.json'], current['budget']):
            raise Refusal('Budget configuration mismatch')
        if not current['budget_evidence']['health']['accepted']:
            raise Refusal('Budget operational health not accepted')
        email = self.secret_store().get(EMAIL_SERVICE, self.aws.account)
        if not email:
            raise Refusal('Budget subscriber secret unavailable')
        desired = substitute(docs['budget-notifications.json'], {'ALERT_EMAIL_FROM_KEYCHAIN': checked_email(email).decode()})
        for entry in desired:
            entry['Notification'] = notification_config(entry['Notification'])
        if len(private) != len(desired):
            raise Refusal('Budget notification count mismatch')
        actual_identities = sorted((notification_identity(e['Notification']), e['Subscribers']) for e in private)
        wanted_identities = sorted((notification_identity(e['Notification']), e['Subscribers']) for e in desired)
        if actual_identities != wanted_identities:
            raise Refusal('Budget notification/subscriber mismatch (values withheld)')

    def verify(self, objects=None):
        current = self.snapshot()
        docs = self.expected('publish', current)
        if current['bucket_policy'] != docs['bucket-policy.after.json'] or not distribution_matches(docs['distribution.json'], current['inventory']['distribution_config']['DistributionConfig']):
            raise Refusal('CDN grant/distribution not fully published')
        distribution = self.aws.call('cloudfront', 'get-distribution', ['--id', self.state['resources']['distribution']])['Distribution']
        if not re.fullmatch(r'[a-z0-9]+\.cloudfront\.net', distribution.get('DomainName', '')) or distribution['DomainName'] != self.state.get('domain'):
            raise Refusal('Runtime CDN domain differs from owned distribution')
        if distribution['Status'] != 'Deployed':
            raise Refusal('Distribution is still deploying; retry later')
        self.verify_budget()
        results = verify_objects(self, objects) if objects else []
        return {'infrastructure': 'matches', 'budget': 'matches', 'subscriber_identity': 'matches', 'objects': results}


def openssl(arguments, data=None):
    try:
        result = subprocess.run(['openssl', *arguments], input=data, capture_output=True)
    except OSError:
        raise Refusal('openssl is required; secret output withheld') from None
    if result.returncode:
        raise Refusal('openssl operation failed; secret output withheld')
    return result.stdout


def checked_email(value):
    value = value.strip()
    if not re.fullmatch(rb'[^\s@<>\x00-\x1f]+@[^\s@<>\x00-\x1f]+\.[^\s@<>\x00-\x1f]+', value) or len(value) > 254:
        raise Refusal('Budget recipient is invalid (value withheld)')
    return value


def signed_url(control, key, expires=None):
    if expires is None:
        expires = math.ceil(time.time() / 21600) * 21600 + 21600
    url = 'https://' + control.state['domain'] + '/' + key
    policy = json.dumps({'Statement': [{'Resource': url, 'Condition': {'DateLessThan': {'AWS:EpochTime': expires}}}]},
                        separators=(',', ':')).encode()
    private = control.secret_store().get(KEY_SERVICE, control.aws.account + ':' + control.state['fingerprint'])
    if not private:
        raise Refusal('Signing secret unavailable')
    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, private)
        os.close(write_fd)
        write_fd = None
        result = subprocess.run(['openssl', 'dgst', '-sha1', '-sign', '/dev/fd/%d' % read_fd], input=policy,
                                pass_fds=(read_fd,), capture_output=True)
        if result.returncode:
            raise Refusal('Private signing operation failed; output withheld')
        sig = base64.b64encode(result.stdout).decode().translate(str.maketrans('+=/', '-_~'))
        return url + '?Expires=%d&Key-Pair-Id=%s&Signature=%s' % (expires, control.state['resources']['public_key'], sig)
    finally:
        os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)


def verify_objects(control, objects):
    """Bounded coordinator-supplied sample manifest; signed URLs never leave memory."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    def fetch(url, size, headers=None, method='GET', expected=200):
        try:
            started = time.perf_counter()
            response = client.open(urllib.request.Request(url, headers=headers or {}, method=method), timeout=30)
            ttfb = time.perf_counter() - started
            with response:
                data = response.read(size + 1)
                result = (response.status, dict(response.headers.items()), data, ttfb)
        except urllib.error.HTTPError as error:
            result = (error.code, {}, b'', None)
        except (OSError, urllib.error.URLError):
            raise Refusal('CDN sample request failed; URL/output withheld') from None
        if result[0] != expected or len(result[2]) > size:
            raise Refusal('CDN sample status/size mismatch; URL/output withheld')
        return result
    results = []
    if not isinstance(objects, list) or not 1 <= len(objects) <= 12:
        raise Refusal('Verification requires 1–12 explicitly reviewed sample objects')
    for obj in objects:
        key, size, sha = obj['key'], obj['sizeBytes'], obj['sha256']
        if not re.fullmatch(r'gold/ebooks/(epub|kepub|pdf|mobi|azw|azw3|kfx|fb2|fbz|cbz|cbr|djvu|txt|rtf|docx|lit|chm|other)/[a-f0-9]{2}/[a-f0-9]{64}/(file\.[a-z0-9]+|derived/v2/[a-f0-9]{64}/(cover-(240|400|800)\.webp|manifest\.json))', key) or not isinstance(size, int) or not 0 < size <= 64 * 1024 * 1024 or not re.fullmatch(r'[a-f0-9]{64}', sha):
            raise Refusal('Invalid sample manifest')
        url = signed_url(control, key)
        origin = {'Origin': 'https://test.invalid'}
        _, headers, body, ttfb = fetch(url, size, origin)
        if len(body) != size or hashlib.sha256(body).hexdigest() != sha:
            raise Refusal('CDN full sample hash mismatch')
        h = {k.lower(): v for k, v in headers.items()}
        if h.get('content-encoding', 'identity') != 'identity' or h.get('accept-ranges') != 'bytes':
            raise Refusal('CDN identity encoding/range headers mismatch')
        _, head, _, _ = fetch(url, 0, origin, method='HEAD')
        if {k.lower(): v for k, v in head.items()}.get('content-length') != str(size):
            raise Refusal('CDN sample HEAD length mismatch')
        cors = {k.lower(): v for k, v in headers.items()}
        exposed = {x.strip().lower() for x in cors.get('access-control-expose-headers', '').split(',')}
        if cors.get('access-control-allow-origin') != '*' or cors.get('access-control-allow-credentials') == 'true' or not {'content-range', 'accept-ranges', 'content-length', 'etag'}.issubset(exposed):
            raise Refusal('CDN sample CORS/exposed headers mismatch')
        preflight = {**origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Range'}
        _, response, _, _ = fetch(url.split('?')[0], 0, preflight, method='OPTIONS', expected=204)
        if {k.lower(): v for k, v in response.items()}.get('access-control-allow-origin') != '*':
            raise Refusal('CDN preflight origin mismatch')
        fetch(url.split('?')[0], 0, {**preflight, 'Access-Control-Request-Headers': 'Authorization'}, method='OPTIONS', expected=403)
        count = min(1024, size)
        for start in (0, size - count):
            _, headers, data, _ = fetch(url, count, {**origin, 'Range': 'bytes=%d-%d' % (start, start + count - 1)}, expected=206)
            h = {k.lower(): v for k, v in headers.items()}
            if data != body[start:start + count] or h.get('content-range') != 'bytes %d-%d/%d' % (start, start + count - 1, size) or h.get('content-length') != str(count):
                raise Refusal('CDN sample range mismatch')
        _, headers, _, _ = fetch(url, count, {**origin, 'Range': 'bytes=0-%d' % (count - 1)}, expected=206)
        if 'Hit' not in headers.get('X-Cache', headers.get('x-cache', '')):
            raise Refusal('Second sample range did not demonstrate cache hit')
        fetch(url.split('?')[0], 0, expected=403)
        fetch('https://durtal.s3.eu-north-1.amazonaws.com/' + key, 0, expected=403)
        fetch(signed_url(control, key, int(time.time()) - 60), 0, expected=403)
        fetch(url + 'corrupt', 0, expected=403)
        results.append({'key': key, 'bytes': size, 'sha256': sha, 'ttfb_seconds': round(ttfb, 4), 'range': 'verified', 'cache': 'hit', 'unsigned_expired_bad_signature': 'denied'})
    for forbidden in ('bronze/ebooks/epub/aa/' + 'a' * 64 + '/source.epub',
                      'silver/ebooks/epub/aa/' + 'a' * 64 + '/v2/' + 'b' * 64 + '.json',
                      'gold/media/cover.webp', 'staging/upload.epub',
                      'gold/ebooks/constructor/aa/' + 'a' * 64 + '/derived/v2/' + 'b' * 64 + '/cover-240.webp'):
        fetch(signed_url(control, forbidden), 0, expected=403)
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['plan', 'apply', 'verify', 'acknowledge-budget'])
    parser.add_argument('--phase', choices=['bootstrap', 'publish', 'budget'], default='bootstrap')
    parser.add_argument('--expected-account', required=True)
    parser.add_argument('--admin-arn', required=True)
    parser.add_argument('--state-dir', type=Path, default=Path.home() / 'Library/Application Support/Durtal/ebooks-infra')
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--plan-dir', type=Path)
    parser.add_argument('--approved-plan-sha256')
    parser.add_argument('--apply-reviewed-plan', action='store_true')
    parser.add_argument('--alert-email-stdin', action='store_true')
    parser.add_argument('--objects', type=Path, help='Reviewed JSON sample key/sizeBytes/sha256 array; no catalogue mutation')
    parser.add_argument('--acknowledgement-payload', type=Path)
    parser.add_argument('--approved-acknowledgement-sha256')
    parser.add_argument('--root-grant', type=Path)
    parser.add_argument('--root-grant-sha256')
    parser.add_argument('--acknowledge-reviewed-budget-create', action='store_true')
    args = parser.parse_args(argv)
    ack_fields = (args.acknowledgement_payload, args.approved_acknowledgement_sha256,
                  args.root_grant, args.root_grant_sha256, args.acknowledge_reviewed_budget_create)
    if args.mode == 'acknowledge-budget':
        if not all(ack_fields) or args.apply_reviewed_plan or args.alert_email_stdin or args.objects or args.plan_dir or args.output_dir or args.approved_plan_sha256:
            parser.error('acknowledge-budget requires its exact reviewed payload/root grant only')
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location('durtal_budget_acknowledgement', Path(__file__).with_name('budget-acknowledgement.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        try:
            api = SimpleNamespace(ROOT=ROOT, PROFILE=PROFILE, REGION=REGION, BUCKET=BUCKET,
                Aws=Aws, Control=Control, source_binding=source_binding,
                private_directory=private_directory, notification_config=notification_config)
            result = module.execute(args, api)
        except Exception:
            raise Refusal('Budget acknowledgement stopped; inspect private before/prepared/committed receipts. No retry or cloud repair permitted.') from None
        print(json.dumps(result))
        return
    if any(ack_fields):
        parser.error('Acknowledgement approval fields belong only to acknowledge-budget')
    if args.mode == 'apply' and not (args.apply_reviewed_plan and args.plan_dir and args.approved_plan_sha256):
        parser.error('apply requires reviewed phase artifact and its coordinator-approved SHA-256')
    if args.mode != 'apply' and args.alert_email_stdin:
        parser.error('Secret provisioning is permitted only in approved bootstrap apply')
    if args.alert_email_stdin and args.phase != 'bootstrap':
        parser.error('Recipient provisioning belongs to bootstrap only')
    if args.mode == 'plan' and not args.output_dir:
        parser.error('plan requires a private --output-dir')
    version = subprocess.run(['aws', '--version'], capture_output=True)
    if version.returncode or not version.stdout.startswith(b'aws-cli/2.'):
        raise Refusal('AWS CLI v2 is required')
    aws = Aws(args.expected_account, args.admin_arn)
    control = Control(aws, args.state_dir)
    if args.mode == 'plan':
        print(json.dumps({'phase': args.phase, 'plan_sha256': control.plan(args.phase, args.output_dir), 'writes': False}))
    elif args.mode == 'apply':
        package = control.approved(args.plan_dir, args.approved_plan_sha256, args.phase)
        email = sys.stdin.buffer.readline(256) if args.alert_email_stdin else None
        {'bootstrap': lambda: control.bootstrap(package, email), 'publish': lambda: control.publish(package),
         'budget': lambda: control.budget(package)}[args.phase]()
        print(json.dumps({'phase': args.phase, 'applied': True, 'next_step': 'fresh reviewed phase plan/verification'}))
    else:
        objects = json.loads(args.objects.read_text()) if args.objects else None
        print(json.dumps(control.verify(objects)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not let JSON/provider/Keychain/crypto data leak in tracebacks.
        print(str(error) if isinstance(error, Refusal) else 'Infrastructure operation failed; sensitive output withheld', file=sys.stderr)
        sys.exit(1)
