#!/usr/bin/env python3
"""One serialized Git-to-Compose update; invoked by systemd and rebuild."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def run(args, *, cwd=None, timeout=120, capture=False):
    return subprocess.run(args, cwd=cwd, timeout=timeout, check=True,
                          text=True, stdout=subprocess.PIPE if capture else None,
                          env={**os.environ, 'GIT_TERMINAL_PROMPT': '0',
                               'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes'}).stdout


def compose(source, env_file, project):
    return ['docker', 'compose', '--project-name', project, '--env-file', str(env_file),
            '-f', str(source / 'docker-compose.production.yml')]


def activate(source, env_file, project, image, health_timeout):
    # Override only the app image. Never replace the database or proxy containers.
    override = source / '.update-image.json'
    override.write_text(json.dumps({'services': {'app': {
        'image': image,
        'healthcheck': {'test': ['CMD', 'node', '-e',
            "fetch('http://127.0.0.1:8787/api/healthz').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"],
            'interval': '5s', 'timeout': '5s', 'retries': 12}
    }}}))
    run(compose(source, env_file, project) + ['-f', str(override), 'up', '-d',
        '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--wait',
        '--wait-timeout', str(health_timeout), 'app'], timeout=health_timeout + 60)


def update(config, force=False):
    repo = Path(config['repository']).resolve()
    env_file = Path(config.get('env_file', repo / '.env.production')).resolve()
    state_dir = Path(config.get('state_directory', '/var/lib/schedule-surgery-updater'))
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state_dir / 'update.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | (0 if force else fcntl.LOCK_NB))
        except BlockingIOError:
            print('Another update is active; checking again on the next tick.', flush=True)
            return
        branch = config.get('branch', 'main')
        remote = config.get('remote', 'origin')
        run(['git', 'check-ref-format', '--branch', branch], cwd=repo, capture=True)
        if remote.startswith('-'):
            raise ValueError('remote cannot start with a dash')
        run(['git', 'fetch', '--no-tags', remote, f'refs/heads/{branch}'], cwd=repo)
        sha = run(['git', 'rev-parse', 'FETCH_HEAD^{commit}'], cwd=repo, capture=True).strip()
        state_file = state_dir / 'deployed.json'
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
        if state.get('sha') == sha and not force:
            return
        if not env_file.is_file():
            raise ValueError(f'Missing production environment file: {env_file}')
        # Resolve the original Compose project to keep the existing named volumes/network.
        project = config.get('project_name')
        if not project:
            project = json.loads(run(['docker', 'compose', '--env-file', str(env_file),
                '-f', str(repo / 'docker-compose.production.yml'), 'config', '--format', 'json'],
                capture=True))['name']
        if state.get('project') and state['project'] != project:
            raise ValueError('Compose project changed; refusing to switch persistent volumes')
        previous_source = Path(state.get('source', repo))
        container = run(compose(previous_source, env_file, project) + ['ps', '-q', 'app'], capture=True).strip()
        if not container or '\n' in container:
            raise ValueError('Expected one existing app container; start production before enabling updates')
        previous_image = run(['docker', 'inspect', '--format', '{{.Image}}', container], capture=True).strip()
        # Bound source disk usage even while a bad commit is retried.
        retained = {str(previous_source), state.get('previous_source')}
        for old in state_dir.glob('release-*'):
            if old.is_dir() and str(old) not in retained:
                shutil.rmtree(old)
        release = Path(tempfile.mkdtemp(prefix='release-', dir=state_dir))
        image = f'schedule-surgery-update:{sha}'
        try:
            archive = release / 'source.tar'
            run(['git', 'archive', '--format=tar', f'--output={archive}', sha], cwd=repo)
            run(['tar', '-xf', str(archive), '-C', str(release)])
            archive.unlink()
            print(f'Building {remote}/{branch} at {sha}', flush=True)
            # The override gives each candidate a tag; a failed build cannot replace the live image.
            override = release / '.update-image.json'
            override.write_text(json.dumps({'services': {'app': {'image': image}}}))
            run(compose(release, env_file, project) + ['-f', str(override), 'build', 'app'],
                timeout=config.get('build_timeout', 900))
            health_timeout = config.get('health_timeout', 180)
            try:
                activate(release, env_file, project, image, health_timeout)
            except Exception:
                print('Activation failed; restoring the previous app image/configuration.', flush=True)
                activate(previous_source, env_file, project, previous_image, health_timeout)
                raise
            pending = state_dir / 'deployed.json.tmp'
            pending.write_text(json.dumps({'sha': sha, 'source': str(release), 'project': project,
                                           'previous_source': str(previous_source)}) + '\n')
            pending.replace(state_file)
            print(f'Deployed and health-verified {sha}', flush=True)
        except Exception:
            # Retain failed releases for diagnosis/recovery, particularly if rollback also failed.
            print(f'Update failed; candidate retained at {release}', flush=True)
            raise
        for old in state_dir.glob('release-*'):
            if old.is_dir() and old not in (release, previous_source):
                shutil.rmtree(old)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='/etc/schedule-surgery-updater.json')
    parser.add_argument('--force', action='store_true', help='Wait for lock and rebuild even if unchanged')
    args = parser.parse_args()
    try:
        update(json.loads(Path(args.config).read_text()), args.force)
    except Exception as error:
        # Compose output may contain interpolated secrets, so do not print captured stdout.
        print(f'Update failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
