"""Read already-published round evidence, with identity and process checks.

Chapter-specific expected_meta supplies the actual launch and numeric contract.
This reader never runs an experiment or repairs a missing record.
"""
from __future__ import annotations
import csv
import hashlib
import io
import json
import math
from pathlib import Path
from statistics import median


def bound_bytes(path: Path, manifest: dict) -> bytes:
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != manifest.get('artifacts_sha256', {}).get(path.name):
        raise ValueError(f'{path.name}: file is not bound to this experiment')
    return data


def measurement_matrix(manifest: dict) -> dict[str, set[str]]:
    """Some rounds vary different parameters on different input shapes."""
    configs = {c['id'] for c in manifest['configurations']}
    explicit = manifest.get('measurement_matrix')
    if explicit is not None:
        if not isinstance(explicit, dict) or manifest['benchmark']['shape'] not in explicit:
            raise ValueError('Missing primary shape in measurement matrix')
        matrix = {}
        for shape, ids in explicit.items():
            if not isinstance(ids, list) or not ids or len(ids) != len(set(ids)) or not set(ids) <= configs:
                raise ValueError(f'{shape}: invalid configuration subset')
            matrix[shape] = set(ids)
        # The configuration catalog may include later phases. Only the explicit
        # matrix declares measurements that must exist in this publication;
        # read_evidence still requires its exact row and process sets below.
        return matrix
    matrix = {manifest['benchmark']['shape']: configs}
    selection = manifest.get('validation_selection', {})
    for shape in selection.get('shapes', []):
        matrix[shape] = set(selection['config_ids'])
    return matrix


def read_evidence(directory: Path, expected_meta, matches, *, confirmation=None):
    parent = json.loads((directory / 'manifest.json').read_text())
    manifest = parent
    if confirmation:
        manifest = json.loads(bound_bytes(directory / confirmation, parent))
        if not manifest.get('main_matrix_unchanged'):
            raise ValueError('Expected an independent confirmation')
        if manifest['source_sha256'] != parent['source_sha256'] or manifest['build']['binary_sha256'] != parent['build']['binary_sha256']:
            raise ValueError('Confirmation must use the same frozen kernels')
        parent_matrix = measurement_matrix(parent)
        confirm_shape = manifest['benchmark']['shape']
        if confirm_shape not in parent_matrix:
            raise ValueError('Confirmation shape was not measured in the parent experiment')
        parent_configs = {c['id']: c for c in parent['configurations']}
        if any(c['id'] not in parent_matrix[confirm_shape] or parent_configs.get(c['id']) != c for c in manifest['configurations']):
            raise ValueError('Confirmation configuration changed from parent experiment')
        for field in ('dtype', 'input', 'reference', 'seed', 'warmup', 'repeat', 'scope'):
            if manifest['benchmark'][field] != parent['benchmark'][field]:
                raise ValueError(f'Confirmation protocol changed: {field}')
        for field in ('gpu', 'architecture', 'rocm_sdk', 'hip'):
            if manifest['environment'][field] != parent['environment'][field]:
                raise ValueError(f'Confirmation environment changed: {field}')
        rows, processes = manifest['results'], manifest['process_results']
    else:
        rows, processes = [list(csv.DictReader(io.StringIO(bound_bytes(directory / name, parent).decode())))
                           for name in ('summary.csv', 'process-summary.csv')]
    benchmark = manifest['benchmark']
    if benchmark['scope'] != 'gpu-event-full-operator' or benchmark['dtype'] not in ('float32', 'fp32'):
        raise ValueError('Expected FP32 complete-operator event timing')
    if not manifest['environment'].get('gpu') or not manifest['environment'].get('rocm_sdk'):
        raise ValueError('Missing measurement identity')
    configs = {c['id']: c for c in manifest['configurations']}
    if len(configs) != len(manifest['configurations']):
        raise ValueError('Duplicate configuration IDs')
    matrix = measurement_matrix(manifest)
    planned = {(shape, cid) for shape, ids in matrix.items() for cid in ids}
    actual = [(str(r['shape']), str(r['config_id'])) for r in rows]
    if len(actual) != len(set(actual)) or set(actual) != planned:
        raise ValueError('Missing, extra or duplicate configuration/shape rows')
    count = int(benchmark['processes'])
    if count < 2:
        raise ValueError('Independent process ranges require multiple processes')
    process_keys = [(str(r['shape']), str(r['config_id']), int(r['process'])) for r in processes]
    expected_processes = {(shape, cid, p) for shape, cid in planned for p in range(1, count + 1)}
    if len(process_keys) != len(set(process_keys)) or set(process_keys) != expected_processes:
        raise ValueError('Incomplete or duplicate process matrix')
    indexed = {}
    for row in rows:
        cid, shape = str(row['config_id']), str(row['shape'])
        metadata = expected_meta(configs[cid], shape, benchmark)
        # Confirmation JSON may retain numeric types that CSV renders as strings.
        if not matches({k: str(v) for k, v in row.items()}, metadata):
            raise ValueError(f'{cid}/{shape}: configuration differs from manifest')
        if row['correct'] != 'OK' or int(row['run_count']) != count:
            raise ValueError(f'{cid}/{shape}: failed correctness or process count')
        group = [p for p in processes if str(p['shape']) == shape and str(p['config_id']) == cid]
        for p in group:
            if not matches({k: str(v) for k, v in p.items()}, metadata) or p['correct'] != 'OK' or int(p['sample_count']) != int(benchmark['repeat']):
                raise ValueError(f'{cid}/{shape}: process protocol differs')
        medians = [float(p['median_ms']) for p in group]
        if any(not math.isfinite(v) or v <= 0 for v in medians):
            raise ValueError('Nonfinite or nonpositive event time')
        for field, expected in zip(('median_ms_run_min', 'median_ms', 'median_ms_run_max'), (min(medians), median(medians), max(medians))):
            if not math.isclose(float(row[field]), expected, rel_tol=1e-12, abs_tol=1e-12):
                raise ValueError(f'{cid}/{shape}: incorrect aggregate {field}')
        indexed[shape, cid] = row
    return manifest, indexed
