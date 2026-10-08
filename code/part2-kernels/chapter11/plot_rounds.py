"""Plot the measured Matmul optimization rounds; no GPU execution."""
from __future__ import annotations
import argparse
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from common.round_evidence import read_evidence
from common.round_plot import Measurement, Panel, render_panels
from summarize_rounds import expected_meta, matches

DEFAULT_OUTPUT = HERE.parents[2] / 'docs/part2-kernels/chapter11/images'
BASE_HIP = 'hip-naive-t16'
BASE_TRITON = 'triton-b32x32-g1'


def measurement(row):
    cid = row['config_id']
    if row['runtime'] == 'hip':
        label = ('naive' if cid == BASE_HIP else 'LDS tiled') + f"\ntile={row['tile']}"
    else:
        label = f"tile={row['block_m']}×{row['block_n']}\ngroup={row['group_m']}"
    baseline = cid in (BASE_HIP, BASE_TRITON)
    if baseline:
        label += '（基线）'
    return Measurement(cid, label, row['runtime'], float(row['median_ms']),
                       float(row['median_ms_run_min']), float(row['median_ms_run_max']),
                       int(row['run_count']), baseline=baseline,
                       hatch='//' if row['runtime'] == 'hip' and cid != BASE_HIP else '')


def panel(title, data, shape, ids):
    return Panel(title, tuple(measurement(data[shape, cid]) for cid in dict.fromkeys(ids)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, default=HERE / 'evidence/rounds')
    parser.add_argument('--out-dir', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--formats', nargs='+', choices=('png', 'svg'), default=['png', 'svg'])
    parser.add_argument('--round', action='append', dest='rounds',
                        choices=('lds', 'hip-tile', 'triton-tile', 'group', 'shapes', 'confirmation'))
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    manifest, data = read_evidence(args.evidence, expected_meta, matches)
    needs_confirmation = not args.rounds or 'confirmation' in args.rounds
    confirmed, confirm_data = read_evidence(args.evidence, expected_meta, matches, confirmation='confirmation.json') if needs_confirmation else (None, {})
    shape = manifest['benchmark']['shape']
    triton = [r for (s, _), r in data.items() if s == shape and r['runtime'] == 'triton']
    grouped = [r for r in triton if int(r['group_m']) > 1]
    if {int(r['group_m']) for r in grouped} != {4, 8}:
        raise ValueError('Expected exactly the measured group4/group8 continuation')
    selected_tiles = {(r['block_m'], r['block_n'], r['block_k'], r['num_warps']) for r in grouped}
    if len(selected_tiles) != 1:
        raise ValueError('Group scan must retain one fixed tile and warp count')
    bm, bn, bk, warps = selected_tiles.pop()
    if int(bk) != 32 or int(warps) != 4:
        raise ValueError('Matmul comparison requires K tile32 and4 warps')
    group_ids = [f'triton-b{bm}x{bn}-g{g}' for g in (1, 4, 8)]
    specs = [
        ('lds', '块内复用：从逐输出读取到 LDS 分块',
         [panel('同为一线程一个输出 · tile=16', data, shape, [BASE_HIP, 'hip-tiled-t16'])],
         ['保持输出分工；分块增加 LDS 复用与两道 block 屏障。']),
        ('hip-tile', 'HIP：比较三种 tile 配置',
         [panel('原始基线', data, shape, [BASE_HIP]),
          panel('同一 tiled 算法 · tile=8/16/32', data, shape, ['hip-tiled-t8', 'hip-tiled-t16', 'hip-tiled-t32'])],
         ['tile 同时改变线程数、K 步长和 LDS 用量；图中采用同一刻度。']),
        ('triton-tile', 'Triton：调整输出块的形状',
         [panel('固定 K tile=32、4 warps、group=1', data, shape,
                [BASE_TRITON, 'triton-b32x64-g1', 'triton-b64x32-g1'])],
         ['输入、乘法精度与 program 映射不变；FP32，input_precision=ieee。']),
        ('group', 'Triton：固定输出块，比较 program 分组',
         [panel(f'固定 tile={bm}×{bn} · group=1/4/8', data, shape, [BASE_TRITON, *group_ids])],
         ['保留原始32×32基线；其余三项固定同一 tile，只改变 group。',
          '编号分组提供复用机会，不保证实际执行顺序或缓存命中。']),
    ]
    env = manifest['environment']
    subtitle = f"{env['gpu']} · ROCm {env['rocm_sdk']}"
    context = f"M×N×K={shape.replace('x', '×')} · FP32 · 完整算子 GPU event"
    if args.validate_only:
        print(f'Validated {len(data)} Matmul configuration/shape groups and {len(confirm_data)} independent confirmations')
        return
    for name, title, panels, notes in specs:
        if args.rounds and name not in args.rounds:
            continue
        render_panels(name=name, title=title, subtitle=subtitle, context=context,
                      panels=tuple(panels), notes=tuple(notes), output=args.out_dir, formats=args.formats)
    if confirmed:
        cshape = confirmed['benchmark']['shape']
        cp = []
        for runtime, label in [('hip', 'HIP'), ('triton', 'Triton')]:
            ids = [cid for (s, cid), r in confirm_data.items() if s == cshape and r['runtime'] == runtime]
            cp.append(panel(label, confirm_data, cshape, ids))
        render_panels(name='confirmation', title='独立复测：候选方案与路线基线', subtitle=subtitle,
                      context=f"M×N×K={cshape.replace('x','×')} · FP32 · 独立确认",
                      panels=tuple(cp), notes=('两路线分别比较；刻度不同，均从0起。', '确认组不与首次扫描合并统计。'),
                      output=args.out_dir, formats=args.formats, independent_axes=True)
    # Shape selection intentionally stays compact; all measured rows remain in CSV.
    sp = []
    for s in manifest.get('validation_selection', {}).get('shapes', []):
        for runtime, label in [('hip', 'HIP'), ('triton', 'Triton')]:
            ids = [cid for (rs, cid), r in data.items() if rs == s and r['runtime'] == runtime]
            sp.append(panel(f"{label} · M×N×K={s.replace('x', '×')}", data, s, ids))
    if sp and (not args.rounds or 'shapes' in args.rounds):
        render_panels(name='shapes', title='非方阵上的固定配置复核', subtitle=subtitle,
                      context='FP32 · 沿用已选配置 · 完整算子 GPU event', panels=tuple(sp),
                      notes=('各面板采用独立刻度；只在同形状、同路线内比较。', '这里复核配置迁移，没有在新形状上重新穷尽搜索。'),
                      output=args.out_dir, formats=args.formats, independent_axes=True)


if __name__ == '__main__':
    main()
