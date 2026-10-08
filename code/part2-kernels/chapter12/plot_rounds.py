"""Plot verified FP32 Attention optimization rounds; never execute GPU work."""
from __future__ import annotations

import argparse
import math
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from common.round_evidence import read_evidence
from common.round_plot import Measurement, Panel, render_panels
from summarize_rounds import expected_meta, matches

DEFAULT_OUTPUT = HERE.parents[2] / 'docs/part2-kernels/chapter12/images'
BASE_HIP = 'hip-materialized-b256'
ONLINE_HIP = 'hip-online-b256'
BASE_TRITON = 'triton-materialized-k32'
ONLINE_TRITON = tuple(f'triton-online-k{tile}' for tile in (16, 32, 64))
HIP_IDS = (BASE_HIP, ONLINE_HIP)
TRITON_IDS = (BASE_TRITON, *ONLINE_TRITON)
ALL_IDS = (*HIP_IDS, *TRITON_IDS)
MIN_CONFIRMATION_IDS = (*HIP_IDS, BASE_TRITON, 'triton-online-k16')
ROUNDS = ('hip-fusion', 'triton-fusion', 'triton-tile', 'shapes', 'confirmation')


def check_protocol(manifest: dict, data: dict, *, confirmation: bool = False) -> None:
    """Bind labels and contrasts to the actual measured launch/numeric contract."""
    benchmark = manifest['benchmark']
    if (benchmark['input'] != 'dyadic'
            or benchmark['reference'] != 'fp64-attention-to-fp32'
            or float(benchmark['atol']) != 2e-5
            or float(benchmark['rtol']) != 2e-4):
        raise ValueError('Attention comparisons require the common dyadic/FP64 reference contract')
    for source in ('attention_hip.hip', 'attention_triton.py'):
        if not re.fullmatch(r'[0-9a-f]{64}', manifest.get('source_sha256', {}).get(source, '')):
            raise ValueError(f'Missing frozen source identity: {source}')
    if not re.fullmatch(r'[0-9a-f]{64}', manifest.get('build', {}).get('binary_sha256', '')):
        raise ValueError('Missing frozen HIP binary identity')
    configs = {config['id']: config for config in manifest['configurations']}
    if confirmation:
        if not set(MIN_CONFIRMATION_IDS) <= set(configs) <= set(ALL_IDS):
            raise ValueError('Attention confirmation must retain both HIP versions, '
                             'Triton materialized and online key tile16; other tiles are optional')
    elif set(configs) != set(ALL_IDS):
        raise ValueError('Attention scan must preserve both route baselines and all four online candidates')
    for cid, config in configs.items():
        runtime = 'hip' if cid in HIP_IDS else 'triton'
        version = 'materialized' if cid in (BASE_HIP, BASE_TRITON) else 'online'
        if config['runtime'] != runtime or config['version'] != version:
            raise ValueError(f'{cid}: incorrect implementation identity')
        if runtime == 'hip':
            kernels = ['scores_kernel', 'softmax_rows_kernel', 'probability_value_kernel'] if version == 'materialized' else ['online_attention_kernel']
            if int(config['block']) != 256:
                raise ValueError('HIP fusion comparison must keep block=256')
        else:
            kernels = ['materialized_scores_kernel', 'materialized_softmax_kernel', 'materialized_pv_kernel'] if version == 'materialized' else ['online_attention_kernel']
            if int(config['num_warps']) != 4 or int(config['block_k']) != int(cid.rsplit('k', 1)[1]):
                raise ValueError('Triton comparison must preserve key tile labels and four warps')
        if config['kernels'] != kernels:
            raise ValueError(f'{cid}: expected complete three-stage or one-stage Attention')
    for (shape, cid), row in data.items():
        if not re.fullmatch(r'[1-9][0-9]*x[1-9][0-9]*', shape):
            raise ValueError(f'Invalid SxD shape: {shape}')
        seq, dim = map(int, shape.split('x'))
        if seq > 4096 or dim > 256:
            raise ValueError(f'Shape is outside the implemented Attention range: {shape}')
        if row['input_precision'] != 'fp32':
            raise ValueError('This comparison must keep FP32 multiplication and reduction')
        for field in ('max_abs_error', 'max_tolerance_ratio'):
            value = float(row[field])
            if not math.isfinite(value) or value < 0 or (field == 'max_tolerance_ratio' and value > 1):
                raise ValueError(f'{cid}/{shape}: invalid output validation metric')


def measurement(row: dict) -> Measurement:
    cid = row['config_id']
    baseline = cid in (BASE_HIP, BASE_TRITON)
    if cid in HIP_IDS:
        label = '物化：三个阶段\nblock=256（基线）' if baseline else '在线：逐 key 累计\nblock=256'
    elif baseline:
        label = '物化：三个阶段\nkey tile=32（基线）'
    else:
        label = f"在线：key tile={row['block_k']}\n4 warps"
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
    check_protocol(manifest, data)
    shape = manifest['benchmark']['shape']
    seq, dim = map(int, shape.split('x'))
    block_d = 1 << (dim - 1).bit_length()
    specs = [
        ('hip-fusion', 'HIP：物化与在线计算',
         (panel('固定 block=256 · 完整 Attention', data, shape, HIP_IDS),),
         ('物化计入三个 kernel，在线计入一个 kernel。',
          '在线逐 key 扫描并协作；少写中间数组不保证更快。'), False),
        ('triton-fusion', 'Triton：物化与在线计算',
         (panel('固定 key tile=32、4 warps', data, shape, (BASE_TRITON, 'triton-online-k32')),),
         ('两版每个 program 处理一个 query；FP32 乘法与归约。',
          '物化计入三个 kernel，在线计入一个 kernel。'), False),
        ('triton-tile', 'Triton：比较每轮处理的 key 数',
         (panel('原始物化基线', data, shape, (BASE_TRITON,)),
          panel(f'在线算法 · 固定 4 warps、BLOCK_D={block_d}', data, shape, ONLINE_TRITON)),
         ('三个在线版本仅改变 key tile；两面板使用同一刻度。',
          'key tile=32 为上一轮对照；误差线保留所有进程的范围。'), False),
    ]
    if 'shapes' in selected:
        shapes = manifest.get('validation_selection', {}).get('shapes', [])
        if not shapes:
            raise ValueError('No declared additional shapes; cannot draw shape comparisons')
        shape_panels = tuple(
            panel(f'{label} · S×D={s.replace("x", "×")}', data, s, ids)
            for s in shapes for label, ids in (('HIP', HIP_IDS), ('Triton', TRITON_IDS))
        )
        specs.append(('shapes', '改变形状后的固定配置比较', shape_panels,
                      ('每个面板只比较同一形状和同一路线；刻度独立且从 0 起。',
                       '输入仍为 dyadic，保留相同候选；不跨形状计算加速比。'), True))
    confirmed, confirm_data = None, {}
    if 'confirmation' in selected:
        confirmed, confirm_data = read_evidence(
            args.evidence, expected_meta, matches, confirmation='confirmation.json')
        check_protocol(confirmed, confirm_data, confirmation=True)
        cshape = confirmed['benchmark']['shape']
        if cshape != shape:
            raise ValueError('Independent confirmation must revisit the scan main shape')
        # read_evidence already binds this subset to the parent's configurations
        # and requires every planned process/sample count. Never borrow a tile's
        # first-scan measurements to fill an unmeasured confirmation candidate.
        confirmed_ids = {config['id'] for config in confirmed['configurations']}
        triton_ids = tuple(cid for cid in TRITON_IDS if cid in confirmed_ids)
        online_tiles = tuple(cid.rsplit('k', 1)[1] for cid in triton_ids if cid in ONLINE_TRITON)
        tile_note = '本次确认的在线 key tile：' + ' / '.join(online_tiles) + '。'
        specs.append(('confirmation', '独立复测：基线与在线候选',
                      (panel('HIP · 物化与逐 key 在线', confirm_data, cshape, HIP_IDS),
                       panel(f'Triton · 物化与 {len(online_tiles)} 种在线配置',
                             confirm_data, cshape, triton_ids)),
                      ('两路线采用独立刻度，均从 0 起；只在同一路线内比较。',
                       tile_note,
                       '这是另一组独立运行，不与首次扫描合并统计。'), True))
    if args.validate_only:
        print(f'Validated {len(data)} Attention configuration/shape groups and '
              f'{len(confirm_data)} independent confirmations for {len(selected)} figures')
        return
    env = manifest['environment']
    subtitle = f"{env['gpu']} · ROCm {env['rocm_sdk']}"
    for name, title, panels, notes, independent_axes in specs:
        if name not in selected:
            continue
        context = (f'S×D={seq}×{dim} · FP32 · 完整前向 GPU event'
                   if name != 'shapes' else 'FP32 · 完整前向 GPU event · 分形状比较')
        if name == 'confirmation':
            context = f'S×D={seq}×{dim} · FP32 · 独立确认的完整前向 GPU event'
        render_panels(name=name, title=title, subtitle=subtitle, context=context,
                      panels=panels, notes=notes, output=args.out_dir,
                      formats=args.formats, independent_axes=independent_axes)


if __name__ == '__main__':
    main()
