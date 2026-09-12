"""Render historical evidence; this script does not benchmark a GPU."""
from pathlib import Path
import csv
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
image_dir = Path(__file__).resolve().parent
repo = image_dir.parents[3]
with (repo / 'code/part2-kernels/chapter12/evidence/summary.csv').open() as f:
    rows = list(csv.DictReader(f))
rows.sort(key=lambda r: ['hip-materialized','hip-online','hip-serial','hip-block','triton-t0','triton-t1'].index(r['implementation']))
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'svg.fonttype':'none'})
fig, axes = plt.subplots(1, 1, figsize=(10.5,5.8), squeeze=False)
fig.subplots_adjust(left=.16, right=.97, top=.72, bottom=.22, wspace=.5)
for panel, ax in enumerate(axes[0]):
    selected = rows if panel == 0 else [r for r in rows if r['implementation'] != 'hip-serial']
    for i,r in enumerate(selected):
        med,lo,hi = (float(r[k]) for k in ['median_ms','median_ms_run_min','median_ms_run_max'])
        ax.barh(i, med, height=.55, color='#0891b2' if r['runtime']=='hip' else '#d97706', alpha=.85)
        ax.errorbar(med,i,xerr=[[med-lo],[hi-med]],color='#0f172a',capsize=4,lw=1.5)
        ax.text(hi+(0.35,)[panel]*.025,i,f'{med:.5f}',va='center',fontsize=10,color='#0f172a')
    ax.set_yticks(range(len(selected)),[r['implementation'] for r in selected])
    ax.invert_yaxis(); ax.set_xlim(0,(0.35,)[panel]); ax.grid(axis='x',color='#e2e8f0');ax.set_axisbelow(True)
    ax.set_xlabel('GPU event time (ms)');ax.set_title('All implementations' if panel==0 else 'Detail · independent linear scale',fontsize=11,pad=12)
    for side in ('top','right','left'): ax.spines[side].set_visible(False)
    ax.spines['bottom'].set_color('#cbd5e1');ax.tick_params(length=0,pad=7)
fig.text(.16,.945,'Chapter 12 · Attention',fontsize=19,weight='bold',color='#0f172a')
fig.text(.16,.895,'RX 9070 XT · ROCm 7.13 · Ubuntu 24.04 · S=128, D=64 FP32',fontsize=11,color='#475569')
fig.text(.16,.85,'Historical measurement 2026-07-19 · warmup 10 / repeat 50 · 3 processes',fontsize=10,color='#64748b')
fig.text(.16,.09,'Bar: median of process medians. Whisker: range of process medians.',fontsize=10,color='#475569')
fig.text(.16,.05,'Historical pre-fix source; this chart does not measure the 2026-09-11 synchronization fix.',fontsize=10,color='#64748b')
fig.savefig(image_dir/'attention-performance.svg',facecolor='white');plt.close(fig)
