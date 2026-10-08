"""Check frozen input identity and the environment before a continued GPU phase."""
from __future__ import annotations

from datetime import datetime, timezone
from importlib.metadata import version
import hashlib
from pathlib import Path
import platform


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_frozen_identity(root: Path, manifest: dict) -> dict:
    for name, expected in manifest['source_sha256'].items():
        if sha(root / 'source' / name) != expected:
            raise ValueError(f'frozen source hash mismatch: {name}')
    if sha(root / 'build/attention_hip') != manifest['build']['binary_sha256']:
        raise ValueError('frozen binary hash mismatch')
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('GPU is unavailable')
    environment = dict(gpu=torch.cuda.get_device_name(0), architecture=torch.cuda.get_device_properties(0).gcnArchName,
                       rocm_sdk=version('rocm'), hip=torch.version.hip, torch=torch.__version__, triton=version('triton'),
                       os_pretty_name=platform.freedesktop_os_release().get('PRETTY_NAME'), kernel=platform.release())
    expected = {'gpu': manifest['environment']['gpu'], 'rocm_sdk': manifest['software']['rocm'],
                'hip': manifest['software']['hip'], 'torch': manifest['software']['torch'],
                'triton': manifest['software']['triton'], 'os_pretty_name': manifest['platform']['os_pretty_name'],
                'kernel': manifest['platform']['kernel']}
    for key, value in expected.items():
        if environment[key] != value:
            raise RuntimeError(f'environment differs from frozen run: {key}')
    if environment['architecture'].split(':')[0] != 'gfx1201':
        raise RuntimeError('expected gfx1201')
    return dict(checked_at=datetime.now(timezone.utc).isoformat(), environment=environment,
                source_reference={'source_sha256': manifest['source_sha256'], 'binary_sha256': manifest['build']['binary_sha256']})
