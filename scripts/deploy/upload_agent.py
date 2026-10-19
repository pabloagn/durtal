#!/usr/bin/env python3
"""SLN-1326: the launchd agent that keeps the e-book upload service running.

`plan` writes the agent's plist and installs nothing. The service runs from a
checkout, as `pnpm ebooks:upload-service start` does, but under the pinned
Node directly, so launchd's SIGTERM reaches the service itself: it then waits
for running inspections and settles its spool before it exits. launchd starts
it again after any non-zero exit, no sooner than THROTTLE_SECONDS after the
last start: a failure, or 78 when the AWS sign-in expired (the app then says
"Uploads need the Mac to sign in to AWS again"). A clean stop stays stopped.
Installing and loading the plist is a step on the Mac (docs/11_DEPLOYMENT.md,
Browser uploads).
"""
import argparse
import json
import os
from pathlib import Path
import plistlib

from mac_release import Refusal, executable, file_hash, owned_path

LABEL = 'com.durtal.ebook-upload'
PROFILE = 'durtal-personal'
# macOS empties these; nothing the agent needs may live there
VOLATILE = (Path('/tmp'), Path('/private/tmp'), Path('/var/tmp'), Path('/private/var/tmp'))
THROTTLE_SECONDS = 60
# launchd sends SIGTERM, then SIGKILL after this: longer than an inspection
# (120 s) and the service's cleanup (30 s), so a stop never needs the kill
EXIT_SECONDS = 300


def lasting(path, what):
    path = owned_path(path)
    resolved = path.resolve()
    if any(resolved == folder or folder in resolved.parents for folder in VOLATILE):
        raise Refusal('%s must be outside /tmp and /private/tmp' % what)
    return path


def private_folder(path, what):
    path = lasting(path, what)
    if not path.is_dir() or path.stat().st_mode & 0o077:
        raise Refusal('%s must be an existing folder private to its owner' % what)
    return path


def plan(repo, state_dir, log_directory, node, docker, aws, output):
    repo = lasting(repo, 'The checkout')
    if not (repo / 'scripts/ebooks/upload-service.ts').is_file() or not (repo / 'node_modules/tsx/package.json').is_file():
        raise Refusal('The checkout needs scripts/ebooks/upload-service.ts and its installed packages')
    if not (repo / '.env.local').is_file():
        raise Refusal('The checkout needs the .env.local the service reads its database from')
    state = private_folder(state_dir, 'The state folder')
    service = state / 'service.json'
    if not service.is_file() or service.stat().st_mode & 0o077:
        raise Refusal('Run pnpm ebooks:upload-service init first: the state folder has no private service.json')
    logs = private_folder(log_directory, 'The log folder')
    tools = {name: executable(path)['path'] for name, path in (('node', node), ('docker', docker), ('aws', aws))}
    path = []
    for folder in [str(Path(tool).parent) for tool in tools.values()] + ['/usr/bin', '/bin']:
        if folder not in path:
            path.append(folder)
    log = str(logs / 'ebook-upload.log')
    agent = {
        'Label': LABEL,
        'ProgramArguments': [tools['node'], '--import', 'tsx', 'scripts/ebooks/upload-service.ts', 'start',
                             '--aws-profile', PROFILE, '--state-dir', str(state), '--env-dir', str(repo)],
        'WorkingDirectory': str(repo),
        'RunAtLoad': True,
        # Restart after a failure or an expired sign-in; a SIGTERM stop exits 0 and stays down
        'KeepAlive': {'SuccessfulExit': False},
        'ThrottleInterval': THROTTLE_SECONDS,
        'ExitTimeOut': EXIT_SECONDS,
        'Umask': 0o077,
        'ProcessType': 'Standard',
        'StandardOutPath': log,
        'StandardErrorPath': log,
        'EnvironmentVariables': {'PATH': ':'.join(path), 'NODE_ENV': 'production'},
    }
    output = lasting(output, 'The agent plist')
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        plistlib.dump(agent, f)
    return {'installed': False, 'label': LABEL, 'plistSha256': file_hash(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subs = parser.add_subparsers(dest='mode', required=True)
    p = subs.add_parser('plan')
    for name in ('repo', 'state-dir', 'log-directory', 'node', 'docker', 'aws', 'output'):
        p.add_argument('--' + name, required=True)
    args = parser.parse_args()
    result = plan(args.repo, args.state_dir, args.log_directory, args.node, args.docker, args.aws, args.output)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, Refusal) else 'Agent plan failed; details withheld', file=__import__('sys').stderr)
        raise SystemExit(1)
