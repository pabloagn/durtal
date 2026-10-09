"""SLN-577: read only the existing owner .env.local into a scoped memory env.

Uses Node22's built-in dotenv parser. No shell evaluation, Keychain, AWS login,
credential file copy, secret stdout or new dependency. File data never enters a
release, service plist or operator receipt.
"""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
from mac_release import ACCOUNT, Refusal, REQUIRED_NAMES, SECRET_NAMES, executable, owned_path

PARSE = '''const fs=require('node:fs'),{parseEnv}=require('node:util');
const parsed=parseEnv(fs.readFileSync(0,'utf8'));
const names=JSON.parse(process.argv[1]),out={};
for(const name of names) if(Object.hasOwn(parsed,name)) out[name]=parsed[name];
process.stdout.write(JSON.stringify(out));'''


def verify_identity(values, aws, run=subprocess.run):
    executable(aws['path'], aws['sha256'])
    path = Path(__file__).with_name('macos-secrets.py')
    spec = importlib.util.spec_from_file_location('approved_durtal_app_identity', path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    def bounded(args, **kwargs):
        supplied = kwargs['env']
        # The approved helper's IAM checks are reused unchanged; never inherit
        # its ambient non-AWS environment or default executable resolution.
        kwargs['env'] = {name: supplied[name] for name in (
            'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_CONFIG_FILE',
            'AWS_SHARED_CREDENTIALS_FILE', 'AWS_EC2_METADATA_DISABLED')}
        kwargs['env'].update(PATH='/usr/bin:/bin', AWS_PAGER='', AWS_CLI_AUTO_PROMPT='off')
        kwargs['timeout'] = 15
        return run([aws['path'], *args[1:]], **kwargs)
    helper.runtime_identity(values, ACCOUNT, run=bounded)


def runtime_environment(names, source, node, aws, run=subprocess.run):
    if not REQUIRED_NAMES.issubset(names) or not set(names).issubset(SECRET_NAMES):
        raise Refusal('Invalid runtime secret allowlist')
    source = owned_path(source)
    if source != Path.home() / 'personal/durtal/.env.local':
        raise Refusal('Unexpected owner environment source')
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_mode & (stat.S_IWGRP | stat.S_IWOTH) or info.st_size > 131072):
            raise Refusal('Unsafe owner environment source')
        with os.fdopen(fd, 'rb', closefd=False) as f:
            data = f.read(131073)
        if len(data) > 131072:
            raise Refusal('Owner environment source exceeds bound')
    finally:
        os.close(fd)
    result = run([node, '-e', PARSE, json.dumps(names)], input=data, capture_output=True,
                 timeout=15, env={'PATH': '/usr/bin:/bin'})
    if result.returncode or len(result.stdout) > 131072:
        raise Refusal('Scoped environment parsing failed; output withheld')
    values = json.loads(result.stdout)
    if (not isinstance(values, dict) or not set(values).issubset(names)
            or any(not isinstance(v, str) or '\x00' in v or len(v.encode()) > 65536 for v in values.values())
            or any(not values.get(name) for name in REQUIRED_NAMES)):
        raise Refusal('Required scoped runtime values unavailable; contents withheld')
    verify_identity(values, aws)
    return values
