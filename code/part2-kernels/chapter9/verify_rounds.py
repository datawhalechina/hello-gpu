"""Independent confirmation; use the frozen kernels without changing main samples."""
from __future__ import annotations

import argparse
import copy
import csv
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import shutil
import subprocess
import sys

from rounds_identity import check_frozen_identity, sha
from run_rounds import command
from summarize_rounds import summarize


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--frozen-run', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    a = parser.parse_args()
    frozen, root = a.frozen_run.resolve(), a.output.resolve()
    if root.exists():
        raise FileExistsError('choose a fresh confirmation directory')
    original = json.loads((frozen / 'manifest.json').read_text())
    with open('/tmp/hello-gpu-experiment.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        identity = check_frozen_identity(frozen, original)
        for folder in ('logs', 'samples', 'verification-source'):
            (root / folder).mkdir(parents=True, exist_ok=True)
        source_hashes = {}
        for name in ('verify_rounds.py', 'rounds_identity.py', 'run_rounds.py', 'summarize_rounds.py'):
            path = Path(__file__).with_name(name)
            shutil.copy2(path, root / 'verification-source' / name)
            source_hashes[name] = sha(path)
        ids = ('hip-local-lds-g256', 'hip-local-wave-g256', 'triton-p1024', 'triton-p256')
        configs = {c['id']: c for c in original['configurations']}
        m = dict(experiment='chapter9-independent-confirmation', started_at=datetime.now(timezone.utc).isoformat(),
                 source_reference=frozen.name, identity_check=identity, environment_source='captured-before-confirmation',
                 environment={**identity['environment'], 'gpu_exclusive': False, 'profiler_during_benchmark': False},
                 hardware=identity['environment']['gpu'],
                 software={'rocm': identity['environment']['rocm_sdk'], 'hip': identity['environment']['hip'],
                           'torch': identity['environment']['torch'], 'triton': identity['environment']['triton']},
                 platform={'os_pretty_name': identity['environment']['os_pretty_name'], 'kernel': identity['environment']['kernel'], 'execution': 'native'},
                 source_sha256=original['source_sha256'], build=original['build'], benchmark=copy.deepcopy(original['benchmark']),
                 configurations=[configs[i] for i in ids], verification_sources_sha256=source_hashes, execution_order=[])
        def save():
            (root / 'manifest.json').write_text(json.dumps(m, indent=2) + '\n')
        save()
        if shutil.which('amd-smi'):
            for sub in ('metric', 'process'):
                with (root / 'logs' / f'gpu-{sub}-before.log').open('w') as file:
                    subprocess.run(['amd-smi', sub], stdout=file, stderr=subprocess.STDOUT, check=True)
        with (root / 'logs/environment.log').open('w') as file:
            subprocess.run(['bash', str(frozen / 'source/collect_environment.sh')], stdout=file, stderr=subprocess.STDOUT, check=True)
        commands = []
        b = m['benchmark']
        for process in (1, 2, 3):
            offset = process - 1
            order = ids[offset:] + ids[:offset]
            m['execution_order'].append({'shape': b['shape'], 'process': process, 'configs': order})
            save()
            for config_id in order:
                stem = f'n{b["shape"]}-{config_id}-p{process}'
                cmd = command(configs[config_id], frozen, b['shape'], b['warmup'], b['repeat'], b['seed'])
                cmd += ['--samples', str(root / 'samples' / f'{stem}.csv'), '--process', str(process)]
                print(f'running {stem}', flush=True)
                with (root / 'logs' / f'{stem}.log').open('w') as file:
                    subprocess.run(cmd, stdout=file, stderr=subprocess.STDOUT, check=True)
                commands.append({'time': datetime.now(timezone.utc).isoformat(), 'argv': cmd, 'log': f'logs/{stem}.log'})
                (root / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')
        m['finished_at'] = datetime.now(timezone.utc).isoformat()
        save()
    summary = summarize(root, root / 'summary', frozen_root=frozen)
    payload = json.loads((root / 'summary/manifest.json').read_text())
    payload['results'] = summary
    payload['process_results'] = list(csv.DictReader((root / 'summary/process-summary.csv').open()))
    payload['commands'] = [{**c, 'argv': [x.replace(str(frozen), 'FROZEN_RUN').replace(str(root), 'CONFIRMATION_RUN').replace(sys.executable, 'python') for x in c['argv']]} for c in commands]
    payload['main_matrix_unchanged'] = True
    (root / 'confirmation.json').write_text(json.dumps(payload, indent=2) + '\n')
    print('PASS: 4 configurations, 12 independent processes, 600 full-operator event samples')


if __name__ == '__main__':
    main()
