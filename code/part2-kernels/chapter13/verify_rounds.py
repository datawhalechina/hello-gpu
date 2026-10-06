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
    parser.add_argument('--shape', help='one shape already measured in the parent experiment')
    parser.add_argument('--configs', nargs='+', help='explicit parent configuration IDs')
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
        publication = json.loads((frozen / 'summary/manifest.json').read_text())
        expected_summary_hash = publication['artifacts_sha256']['summary.csv']
        if sha(frozen / 'summary/summary.csv') != expected_summary_hash or publication['source_sha256'] != original['source_sha256']:
            raise ValueError('parent summary identity mismatch')
        main_rows = [r for r in csv.DictReader((frozen / 'summary/summary.csv').open()) if r['shape'] == original['benchmark']['shape']]
        hip_rows=[r for r in main_rows if r['implementation']=='hip-block']
        best=min(hip_rows,key=lambda r:float(r['median_ms']))
        near_ids=[r['config_id'] for r in hip_rows if float(r['median_ms'])<=1.05*float(best['median_ms'])]
        ids=tuple(dict.fromkeys(a.configs or ('hip-block-b256',best['config_id'],*near_ids,'triton-r1-w4','triton-r1-w8')))
        configs = {c['id']: c for c in original['configurations']}
        shape = a.shape or original['benchmark']['shape']
        allowed_shapes = set(original['measurement_matrix'])
        if shape not in allowed_shapes or not set(ids) <= set(original['measurement_matrix'].get(shape,[])):
            raise ValueError('confirmation must select measured parent shapes/configurations')
        m = dict(experiment='chapter13-independent-confirmation', started_at=datetime.now(timezone.utc).isoformat(),
                 source_reference=frozen.name, identity_check=identity, environment_source='captured-before-confirmation',
                 environment={**identity['environment'], 'gpu_exclusive': False, 'profiler_during_benchmark': False},
                 hardware=identity['environment']['gpu'],
                 software={'rocm': identity['environment']['rocm_sdk'], 'hip': identity['environment']['hip'],
                           'torch': identity['environment']['torch'], 'triton': identity['environment']['triton']},
                 platform={'os_pretty_name': identity['environment']['os_pretty_name'], 'kernel': identity['environment']['kernel'], 'execution': 'native'},
                 source_sha256=original['source_sha256'], build=original['build'], benchmark=copy.deepcopy(original['benchmark']),
                 configurations=[configs[i] for i in ids], verification_sources_sha256=source_hashes, execution_order=[])
        m['benchmark']['shape'] = shape
        m['measurement_matrix']={shape:list(ids)}
        m['parent_summary_sha256'] = expected_summary_hash
        m['selection_rule'] = ('explicit previously measured configurations' if a.configs else 'HIP block256 baseline, fastest measured block and candidates within 5%; both single-row Triton warp configurations; remove duplicates')
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
    print(f'PASS: {len(ids)} configurations, {len(ids)*3} independent processes, {len(ids)*150} full-operator event samples')


if __name__ == '__main__':
    main()
