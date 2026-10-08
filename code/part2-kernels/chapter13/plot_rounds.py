"""Plot verified RMSNorm rounds; never execute experiments or infer missing data."""
from __future__ import annotations

import argparse
import math
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from common.round_evidence import measurement_matrix, read_evidence
from common.round_plot import Measurement, Panel, render_panels
from summarize_rounds import expected_meta, matches

DEFAULT_OUTPUT = HERE.parents[2] / 'docs/part2-kernels/chapter13/images'
MAIN_SHAPE = '4096x1024'
SHORT_SHAPE = '4096x128'
OTHER_SHAPES = ('128x1024', '4096x1025')
SERIAL = 'hip-serial-b256'
BASE_HIP = 'hip-block-b256'
BASE_TRITON = 'triton-r1-w4'
HIP_BLOCKS = (BASE_HIP, 'hip-block-b128', 'hip-block-b64')
TRITON_WARPS = (BASE_TRITON, 'triton-r1-w8')
TRITON_ROWS = (BASE_TRITON, 'triton-r2-w4', 'triton-r4-w4')
MAIN_IDS = (SERIAL, *HIP_BLOCKS, *TRITON_WARPS)
ALL_IDS = (*MAIN_IDS, 'triton-r2-w4', 'triton-r4-w4')
ROUNDS = ('cooperative', 'block', 'warps', 'rows', 'shapes', 'confirmation')


def check_protocol(manifest: dict, data: dict, *, kind: str = 'scan',
                   rounds: set[str] | None = None) -> None:
    """Keep the figure labels tied to the measured launch and numeric contract."""
    benchmark = manifest['benchmark']
    if (benchmark['input'] != 'rmsnorm-dyadic-v1'
            or benchmark['input_mode'] != 'normal'
            or benchmark['reference'] != 'cpu-fp64-to-fp32'
            or float(benchmark['epsilon']) != 9.999999747378752e-06
            or float(benchmark['atol']) != 2e-5
            or float(benchmark['rtol']) != 2e-5):
        raise ValueError('RMSNorm comparisons require the common input/FP64 reference/epsilon contract')
    for name in ('rmsnorm_hip.hip', 'rmsnorm_triton.py'):
        if not re.fullmatch(r'[0-9a-f]{64}', manifest.get('source_sha256', {}).get(name, '')):
            raise ValueError(f'Missing frozen source identity: {name}')
    if not re.fullmatch(r'[0-9a-f]{64}', manifest.get('build', {}).get('binary_sha256', '')):
        raise ValueError('Missing frozen HIP binary identity')
    configs = {config['id']: config for config in manifest['configurations']}
    matrix = measurement_matrix(manifest)
    if kind == 'scan':
        planned = {MAIN_SHAPE: set(MAIN_IDS), SHORT_SHAPE: set(TRITON_ROWS),
                   **{shape: set((*HIP_BLOCKS, *TRITON_WARPS)) for shape in OTHER_SHAPES}}
        if (not set(configs) <= set(ALL_IDS) or benchmark['shape'] != MAIN_SHAPE
                or any(shape not in planned or not ids <= planned[shape]
                       for shape, ids in matrix.items())):
            raise ValueError('Unexpected RMSNorm configuration/shape matrix')
        required = {
            'cooperative': {MAIN_SHAPE: (SERIAL, BASE_HIP)},
            'block': {MAIN_SHAPE: HIP_BLOCKS},
            'warps': {MAIN_SHAPE: TRITON_WARPS},
            'rows': {SHORT_SHAPE: TRITON_ROWS},
            'shapes': {shape: (*HIP_BLOCKS, *TRITON_WARPS) for shape in OTHER_SHAPES},
            'confirmation': {},  # Its independent matrices are checked below.
        }
        for name in sorted(set(ROUNDS) if rounds is None else rounds):
            for shape, ids in required[name].items():
                missing = set(ids) - matrix.get(shape, set())
                if missing:
                    raise ValueError(f'{name}: missing measured configurations for {shape}: {sorted(missing)}')
    elif kind == 'main-confirmation':
        required = {BASE_HIP, *TRITON_WARPS}
        allowed = {*HIP_BLOCKS, *TRITON_WARPS}
        if not required <= set(configs) <= allowed or matrix != {MAIN_SHAPE: set(configs)}:
            raise ValueError('Main confirmation must preserve block256 and both single-row warp configurations')
    elif kind == 'short-confirmation':
        if set(configs) != set(TRITON_ROWS) or matrix != {SHORT_SHAPE: set(TRITON_ROWS)}:
            raise ValueError('Short-row confirmation must retain one/two/four rows at four warps')
    else:
        raise ValueError(f'Unknown publication kind: {kind}')
    for cid, config in configs.items():
        if cid.startswith('hip-'):
            version = 'serial' if cid == SERIAL else 'block'
            block = int(cid.rsplit('b', 1)[1])
            if config['runtime'] != 'hip' or config['version'] != version or int(config['block']) != block:
                raise ValueError(f'{cid}: incorrect HIP configuration')
            kernel = f'rmsnorm_{version}_kernel'
        else:
            match = re.fullmatch(r'triton-r(1|2|4)-w(4|8)', cid)
            if match is None:
                raise ValueError(f'Unknown Triton configuration: {cid}')
            rows_per_program, warps = map(int, match.groups())
            if (config['runtime'] != 'triton' or config['version'] != 'configured'
                    or int(config['rows_per_program']) != rows_per_program
                    or int(config['num_warps']) != warps
                    or (rows_per_program > 1 and warps != 4)):
                raise ValueError(f'{cid}: incorrect row/warp configuration')
            kernel = 'rmsnorm_kernel' if rows_per_program == 1 else 'rmsnorm_rows_kernel'
        if config['kernels'] != [kernel]:
            raise ValueError(f'{cid}: expected one complete RMSNorm kernel')
    for (shape, cid), row in data.items():
        if not re.fullmatch(r'[1-9][0-9]*x[1-9][0-9]*', shape):
            raise ValueError(f'Invalid rows/columns shape: {shape}')
        if row['input_precision'] != 'fp32':
            raise ValueError('The comparison requires FP32 arithmetic')
        for field in ('max_abs_error', 'max_rel_error'):
            value = float(row[field])
            if not math.isfinite(value) or value < 0:
                raise ValueError(f'{cid}/{shape}: invalid correctness diagnostic')


def check_confirmation(parent: dict, confirmation: dict) -> None:
    """Common reader binds source, samples and shape; add RMSNorm-specific fields."""
    for field in ('epsilon', 'atol', 'rtol'):
        if float(parent['benchmark'][field]) != float(confirmation['benchmark'][field]):
            raise ValueError(f'Confirmation changed {field}')
    if parent['benchmark']['input_mode'] != confirmation['benchmark']['input_mode']:
        raise ValueError('Confirmation changed input mode')
    for field in ('rocm', 'hip', 'torch', 'triton'):
        if parent['software'][field] != confirmation['software'][field]:
            raise ValueError(f'Confirmation changed software: {field}')
    for field in ('os_pretty_name', 'kernel', 'execution'):
        if parent['platform'][field] != confirmation['platform'][field]:
            raise ValueError(f'Confirmation changed platform: {field}')


def measurement(row: dict) -> Measurement:
    cid = row['config_id']
    baseline = cid in (BASE_HIP, BASE_TRITON)
    if cid == SERIAL:
        label = 'serial · 一线程一行\n公式桥接'
    elif row['runtime'] == 'hip':
        label = f"block={row['block']}\n" + ('协作基线' if baseline else '一 block 一行')
    else:
        label = f"每 program {row['rows_per_program']} 行\n{row['num_warps']} warps"
        if baseline:
            label += '（基线）'
    return Measurement(
        config=cid, label=label, runtime=row['runtime'],
        center_ms=float(row['median_ms']), low_ms=float(row['median_ms_run_min']),
        high_ms=float(row['median_ms_run_max']), runs=int(row['run_count']),
        baseline=baseline, hatch='' if baseline else '//',
    )


def panel(title: str, data: dict, shape: str, ids: tuple[str, ...]) -> Panel:
    missing = [cid for cid in ids if (shape, cid) not in data]
    if missing:
        raise ValueError(f'{shape}: missing configurations required by this contrast: {missing}')
    return Panel(title, tuple(measurement(data[shape, cid]) for cid in ids))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, default=HERE / 'evidence/rounds')
    parser.add_argument('--out-dir', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--formats', nargs='+', choices=('png', 'svg'), default=['png', 'svg'])
    parser.add_argument('--round', action='append', dest='rounds', choices=ROUNDS)
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    selected = set(args.rounds or ROUNDS)
    manifest, data = read_evidence(args.evidence, expected_meta, matches)
    check_protocol(manifest, data, rounds=selected)
    specs = []
    if 'cooperative' in selected:
        specs.append(('cooperative', 'HIP：从公式实现到行内协作',
         'rows×cols=4096×1024 · FP32 · 完整算子 GPU event',
         (panel('serial 桥接 → block256 性能基线', data, MAIN_SHAPE, (SERIAL, BASE_HIP)),),
         ('两版都是一个 kernel；比较的是分工变化，不是融合前后。',
          '后续 HIP 配置轮以 block256 为基线，不以 serial 计算增益。'), False))
    if 'block' in selected:
        specs.append(('block', 'HIP：比较每行的协作线程数',
         'rows×cols=4096×1024 · FP32 · 完整算子 GPU event',
         (panel('同一个 LDS 算法 · 一 block 一行', data, MAIN_SHAPE, HIP_BLOCKS),),
         ('固定输入与算法；线程数同时影响局部累加、树轮数和 LDS。',
          '保留 block256 原始性能基线；不预设更大的 block 更快。'), False))
    if 'warps' in selected:
        specs.append(('warps', 'Triton：固定逻辑宽度，比较 warps',
         'rows×cols=4096×1024 · FP32 · 完整算子 GPU event',
         (panel('每 program 一行 · 固定 B=1024', data, MAIN_SHAPE, TRITON_WARPS),),
         ('4 warps 为原始基线；输入、逻辑宽度、行数与算法不变。',
          'num_warps 改变执行配置，不增加有效数据列。'), False))
    if 'rows' in selected:
        specs.append(('rows', 'Triton：短行的一行、两行与四行',
         'rows×cols=4096×128 · FP32 · 完整算子 GPU event',
         (panel('固定 B=128、4 warps · 每行独立归约', data, SHORT_SHAPE, TRITON_ROWS),),
         ('短行独立建立一行基线，不混入 4096×1024 的时间。',
          '三个配置均为一次 kernel；多行改变 program 数和内部布局。'), False))
    if 'shapes' in selected:
        shape_panels = tuple(
            panel(f'{label} · rows×cols={shape.replace("x", "×")}', data, shape, ids)
            for shape in OTHER_SHAPES
            for label, ids in (('HIP', HIP_BLOCKS), ('Triton', TRITON_WARPS))
        )
        specs.append(('shapes', '行数与列尾变化后的配置比较',
                      'FP32 · 完整算子 GPU event · 分形状比较', shape_panels,
                      ('每个面板只比较同一形状、同一路线；独立刻度从 0 起。',
                       '保留各形状的 block256 或单行 4-warps 基线。'), True))
    main_confirm_data, short_confirm_data = {}, {}
    if 'confirmation' in selected:
        confirmed, main_confirm_data = read_evidence(
            args.evidence, expected_meta, matches, confirmation='confirmation.json')
        short_confirmed, short_confirm_data = read_evidence(
            args.evidence, expected_meta, matches, confirmation='short-row-confirmation.json')
        check_protocol(confirmed, main_confirm_data, kind='main-confirmation')
        check_protocol(short_confirmed, short_confirm_data, kind='short-confirmation')
        check_confirmation(manifest, confirmed)
        check_confirmation(manifest, short_confirmed)
        hip_ids = tuple(cid for cid in HIP_BLOCKS if (MAIN_SHAPE, cid) in main_confirm_data)
        specs.append(('confirmation', '独立复测：主形状与短行配置',
                      'FP32 · 独立确认的完整算子 GPU event',
                      (panel('HIP · 4096×1024', main_confirm_data, MAIN_SHAPE, hip_ids),
                       panel('Triton · 4096×1024', main_confirm_data, MAIN_SHAPE, TRITON_WARPS),
                       panel('Triton 短行 · 4096×128', short_confirm_data, SHORT_SHAPE, TRITON_ROWS)),
                      ('各面板独立刻度从 0 起；只在同一形状和路线内比较。',
                       '确认来自新的独立运行，不与首次扫描混合统计。'), True))
    if args.validate_only:
        print(f'Validated {len(data)} RMSNorm configuration/shape groups, '
              f'{len(main_confirm_data)} main confirmations and {len(short_confirm_data)} '
              f'short-row confirmations for {len(selected)} figures')
        return
    env = manifest['environment']
    subtitle = f"{env['gpu']} · ROCm {env['rocm_sdk']}"
    for name, title, context, panels, notes, independent_axes in specs:
        if name in selected:
            render_panels(name=name, title=title, subtitle=subtitle, context=context,
                          panels=panels, notes=notes, output=args.out_dir,
                          formats=args.formats, independent_axes=independent_axes)


if __name__ == '__main__':
    main()
