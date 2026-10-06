"""Finish direct-shell-equivalent profiles in a process without GPU initialization."""
from capture_walkthrough import RUN, CONFIGS, KERNELS, verify_sources, record, command, write_manifest, now, digest
from pathlib import Path
import fcntl
import json
import os

with open('/tmp/hello-gpu-experiment.lock', 'w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    manifest = json.loads((RUN / 'manifest.json').read_text())
    verify_sources(manifest)
    failed = RUN / 'configs/hip-v0/failed-profile-runtime-registration'
    failed.mkdir()
    entries = [json.loads(line) for line in (RUN / 'commands.jsonl').read_text().splitlines()]
    first = entries[-1]
    assert first['name'] == 'profile-hip-v0' and first['returncode'] == -6
    first['name'] = 'failed-profile-hip-v0-runtime-registration'
    first['original_output_paths'] = {key: first[key] for key in ('stdout', 'stderr')}
    for stream in ('stdout', 'stderr'):
        old = RUN / first[stream]
        target = failed / old.name
        old.rename(target)
        first[stream] = str(target.relative_to(RUN))
    first['note'] = 'Failed before kernel launch: profiler core/devel library registration conflict in GPU-initialized parent. Preserved, then profile stage restarted in a clean process.'
    (RUN / 'commands.jsonl').write_text(''.join(json.dumps(entry) + '\n' for entry in entries))
    manifest['profile_driver'] = dict(source='source/finish_profiles.py', sha256=digest(Path(__file__)),
        reason='Profile subprocesses run without initializing the GPU in the parent process; initial failed profiler logs retained separately.')
    write_manifest(manifest)
    for config in CONFIGS:
        verify_sources(manifest)
        cfgdir = RUN / 'configs' / config['id']
        profile_dir = cfgdir / 'profile'
        profile_dir.mkdir(exist_ok=True)
        if any(profile_dir.iterdir()):
            raise RuntimeError(f'refusing to overwrite profile output: {profile_dir}')
        argv = ['rocprofv3', '--kernel-trace', '--hip-trace', '--stats', '--output-format', 'csv', 'pftrace',
                '--output-directory', str(profile_dir), '--output-file', config['id'], '--', *command(config, 5, 10, 1)]
        log, _ = record('profile-' + config['id'], argv, cfgdir / 'profile')
        os.link(log, RUN / 'logs' / f"profile-{config['id']}.log")
        trace = profile_dir / f"{config['id']}_kernel_trace.csv"
        os.link(trace, RUN / 'profiles' / trace.name)
        record('inspect-' + config['id'], ['python', 'chapter8/inspect_trace.py', str(trace), '--kernel',
               KERNELS[config['version']], '--skip', '6', '--take', '10'], cfgdir / 'inspect')
    record('gpu-state-after', ['amd-smi', 'metric'], RUN / 'logs/gpu-state-after', required=False)
    record('gpu-process-after', ['amd-smi', 'process'], RUN / 'logs/gpu-process-after', required=False)
    manifest['completed_at'] = now()
    manifest['raw_sha256'] = {str(p.relative_to(RUN)): digest(p) for p in sorted(RUN.rglob('*'))
                            if p.is_file() and p.name != 'manifest.json' and '__pycache__' not in p.parts}
    write_manifest(manifest)
    print('WALKTHROUGH_COMPLETE', flush=True)
