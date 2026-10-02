"""Updater lifecycle tests with real files/locks and simulated Git/Docker failures."""
import fcntl
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('updater', Path(__file__).with_name('update.py'))
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        (self.repo / '.env.production').write_text('SECRET=keep-me\n')
        (self.repo / 'docker-compose.production.yml').write_text('services: {}\n')
        self.config = {'repository': str(self.repo), 'state_directory': str(self.root / 'state')}
        self.calls = []
        self.sha = 'a' * 40
        self.fail_fetch = False
        self.fail_build = False
        self.fail_start = False
        self.fail_rollback = False

    def command(self, args, **kwargs):
        self.calls.append(args)
        if args[:2] == ['git', 'fetch'] and self.fail_fetch:
            raise subprocess.CalledProcessError(1, args)
        if args[:2] == ['git', 'rev-parse']:
            return self.sha + '\n'
        if 'config' in args:
            return json.dumps({'name': 'existing-project'})
        if 'ps' in args:
            return 'container-id\n'
        if args[:2] == ['docker', 'inspect']:
            return 'sha256:previous\n'
        if args[:2] == ['git', 'archive']:
            Path(next(a.split('=', 1)[1] for a in args if a.startswith('--output='))).touch()
        if args[0] == 'tar':
            (Path(args[-1]) / 'docker-compose.production.yml').write_text('services: {}\n')
        if 'build' in args and self.fail_build:
            raise subprocess.CalledProcessError(1, args)
        if 'up' in args:
            image = json.loads(Path(args[args.index('up') - 1]).read_text())['services']['app']['image']
            if (image != 'sha256:previous' and self.fail_start) or (image == 'sha256:previous' and self.fail_rollback):
                raise subprocess.CalledProcessError(1, args)
        return ''

    def perform(self, force=False):
        with patch.object(updater, 'run', self.command):
            updater.update(self.config, force)

    def state(self):
        return json.loads((self.root / 'state/deployed.json').read_text())

    def test_success_preserves_secrets_and_project_and_skips_unchanged(self):
        self.perform()
        self.assertEqual(self.state()['sha'], self.sha)
        self.assertEqual((self.repo / '.env.production').read_text(), 'SECRET=keep-me\n')
        starts = [c for c in self.calls if 'up' in c]
        self.assertEqual(len(starts), 1)
        self.assertIn('--no-deps', starts[0])
        self.assertIn('--no-build', starts[0])
        self.assertEqual(starts[0][-1], 'app')
        self.assertEqual(starts[0][starts[0].index('--project-name') + 1], 'existing-project')
        self.calls.clear()
        self.perform()
        self.assertFalse(any('build' in c or 'up' in c for c in self.calls))

    def test_fetch_failure_does_not_replace_app(self):
        self.fail_fetch = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.perform()
        self.assertFalse(any('build' in c or 'up' in c for c in self.calls))

    def test_build_failure_does_not_replace_app(self):
        self.fail_build = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.perform()
        self.assertFalse(any('up' in c for c in self.calls))
        self.assertFalse((self.root / 'state/deployed.json').exists())

    def test_health_failure_rolls_back_and_retries(self):
        self.perform()
        old = self.state()
        self.sha = 'b' * 40
        self.fail_start = True
        self.calls.clear()
        with self.assertRaises(subprocess.CalledProcessError):
            self.perform()
        self.assertEqual(self.state(), old)
        starts = [c for c in self.calls if 'up' in c]
        self.assertEqual(len(starts), 2)
        self.assertEqual(json.loads(Path(starts[-1][starts[-1].index('up') - 1]).read_text())['services']['app']['image'], 'sha256:previous')
        self.fail_start = False
        self.perform()
        self.assertEqual(self.state()['sha'], self.sha)

    def test_rollback_failure_retains_candidate_and_old_state(self):
        self.perform()
        old = self.state()
        self.sha = 'b' * 40
        self.fail_start = self.fail_rollback = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.perform()
        self.assertEqual(self.state(), old)
        self.assertEqual(len(list((self.root / 'state').glob('release-*'))), 2)

    def test_overlapping_tick_skips_without_fetch(self):
        state_dir = self.root / 'state'
        state_dir.mkdir()
        with (state_dir / 'update.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.perform()
        self.assertEqual(self.calls, [])

    def test_new_push_and_force_rebuild(self):
        self.perform()
        self.sha = 'b' * 40
        self.perform()
        self.assertEqual(self.state()['sha'], self.sha)
        self.calls.clear()
        self.perform(force=True)
        self.assertTrue(any('build' in c for c in self.calls))
        self.assertEqual(len(list((self.root / 'state').glob('release-*'))), 2)

    def test_project_change_refused(self):
        self.perform()
        self.sha = 'b' * 40
        self.config['project_name'] = 'wrong-project'
        self.calls.clear()
        with self.assertRaisesRegex(ValueError, 'project changed'):
            self.perform()
        self.assertFalse(any('up' in c for c in self.calls))


if __name__ == '__main__':
    unittest.main()
