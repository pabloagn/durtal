#!/usr/bin/env python3
"""The upload service's launchd agent (SLN-1326): isolated fixtures only, nothing installed."""
import contextlib
import io
import json
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1] / 'deploy'
sys.path.insert(0, str(DEPLOY))
import mac_release as release
import upload_agent as agent


class UploadAgentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        # The fixtures live in the system temp folder the agent refuses
        self.defaults = agent.VOLATILE
        self.volatile = patch.object(agent, 'VOLATILE', ())
        self.volatile.start()
        self.repo = self.root / 'durtal'
        (self.repo / 'scripts/ebooks').mkdir(parents=True)
        (self.repo / 'scripts/ebooks/upload-service.ts').write_text('// service\n')
        (self.repo / 'node_modules/tsx').mkdir(parents=True)
        (self.repo / 'node_modules/tsx/package.json').write_text('{}\n')
        (self.repo / '.env.local').write_text('DATABASE_URL=fixture\n')
        self.state = self.root / 'state'; self.state.mkdir(mode=0o700)
        (self.state / 'service.json').write_text('{}\n'); (self.state / 'service.json').chmod(0o600)
        self.logs = self.root / 'logs'; self.logs.mkdir(mode=0o700)
        self.tools = {}
        for name, folder in (('node', 'node/bin'), ('docker', 'docker/bin'), ('aws', 'aws/bin')):
            tool = self.root / folder / name
            tool.parent.mkdir(parents=True)
            tool.write_text('#!/bin/sh\n'); tool.chmod(0o755)
            self.tools[name] = str(tool)

    def tearDown(self):
        self.volatile.stop()
        self.temp.cleanup()

    def plan(self, output=None, **changes):
        args = {'repo': str(self.repo), 'state_dir': str(self.state), 'log_directory': str(self.logs), **self.tools,
                'output': str(output or self.root / 'agent.plist'), **changes}
        return agent.plan(**args)

    def test_the_agent_restarts_the_service_after_a_failure_and_stops_it_with_sigterm(self):
        result = self.plan()
        plist = plistlib.loads((self.root / 'agent.plist').read_bytes())
        self.assertEqual(result, {'installed': False, 'label': 'com.durtal.ebook-upload',
                                  'plistSha256': release.file_hash(self.root / 'agent.plist')})
        self.assertEqual(plist['Label'], 'com.durtal.ebook-upload')
        # The pinned Node runs the service itself, so launchd's SIGTERM reaches it
        self.assertEqual(plist['ProgramArguments'], [
            self.tools['node'], '--import', 'tsx', 'scripts/ebooks/upload-service.ts', 'start',
            '--aws-profile', 'durtal-personal', '--state-dir', str(self.state), '--env-dir', str(self.repo)])
        self.assertEqual(plist['WorkingDirectory'], str(self.repo))
        # Restarted after a non-zero exit (a failure, or 78 for an expired sign-in), no sooner than a minute apart
        self.assertEqual(plist['KeepAlive'], {'SuccessfulExit': False})
        self.assertTrue(plist['RunAtLoad'])
        self.assertEqual(plist['ThrottleInterval'], 60)
        # SIGTERM first; the kill only after an inspection and cleanup would have settled
        self.assertGreater(plist['ExitTimeOut'], 150)
        self.assertNotIn('AbandonProcessGroup', plist)
        self.assertEqual(plist['StandardOutPath'], str(self.logs / 'ebook-upload.log'))
        self.assertEqual(plist['StandardErrorPath'], str(self.logs / 'ebook-upload.log'))
        self.assertEqual(plist['EnvironmentVariables']['PATH'].split(':'),
                         [str(Path(self.tools[name]).parent) for name in ('node', 'docker', 'aws')] + ['/usr/bin', '/bin'])
        self.assertEqual((self.root / 'agent.plist').stat().st_mode & 0o777, 0o600)
        self.assertFalse(any('/private/tmp' in str(value) for value in plist['ProgramArguments']))
        # Nothing secret is written into it
        self.assertNotIn('DATABASE_URL', (self.root / 'agent.plist').read_text())

    def test_nothing_lives_where_macos_empties_it(self):
        self.assertTrue({Path('/tmp'), Path('/private/tmp')} <= set(self.defaults))
        with patch.object(agent, 'VOLATILE', (self.root.resolve(),)):
            with self.assertRaisesRegex(release.Refusal, 'outside /tmp'):
                self.plan()
        # Only the plist in a volatile folder: refused too, and nothing written
        elsewhere = Path(tempfile.mkdtemp(dir=self.root))
        with patch.object(agent, 'VOLATILE', (elsewhere.resolve(),)):
            with self.assertRaisesRegex(release.Refusal, 'agent plist must be outside /tmp'):
                self.plan(output=elsewhere / 'agent.plist')
        self.assertFalse((elsewhere / 'agent.plist').exists())

    def test_it_needs_an_initialised_private_state_folder_and_a_checkout(self):
        (self.state / 'service.json').unlink()
        with self.assertRaisesRegex(release.Refusal, 'init first'):
            self.plan()
        (self.state / 'service.json').write_text('{}\n'); (self.state / 'service.json').chmod(0o644)
        with self.assertRaisesRegex(release.Refusal, 'init first'):
            self.plan()
        (self.state / 'service.json').chmod(0o600); self.state.chmod(0o755)
        with self.assertRaisesRegex(release.Refusal, 'private to its owner'):
            self.plan()
        self.state.chmod(0o700); (self.repo / 'node_modules/tsx/package.json').unlink()
        with self.assertRaisesRegex(release.Refusal, 'installed packages'):
            self.plan()

    def test_it_never_overwrites_a_plist_or_takes_a_relative_tool(self):
        self.plan()
        with self.assertRaises(FileExistsError):
            self.plan()
        with self.assertRaisesRegex(release.Refusal, 'absolute executable'):
            self.plan(output=self.root / 'other.plist', node='node')

    def test_the_command_line_prints_only_the_plan_summary(self):
        output = self.root / 'cli.plist'
        argv = ['upload_agent.py', 'plan', '--repo', str(self.repo), '--state-dir', str(self.state),
                '--log-directory', str(self.logs), '--node', self.tools['node'], '--docker', self.tools['docker'],
                '--aws', self.tools['aws'], '--output', str(output)]
        printed = io.StringIO()
        with patch.object(sys, 'argv', argv), contextlib.redirect_stdout(printed):
            agent.main()
        self.assertEqual(json.loads(printed.getvalue()), {'installed': False, 'label': 'com.durtal.ebook-upload',
                                                          'plistSha256': release.file_hash(output)})


if __name__ == '__main__':
    unittest.main()
