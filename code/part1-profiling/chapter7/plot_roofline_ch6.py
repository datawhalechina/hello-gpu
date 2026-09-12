"""Chapter 7: plot Chapter 6 vector-add results against measured references.

The historical filename is kept so existing links continue to work.
No GPU benchmark is run by this script.

Recorded on Radeon RX 9070 XT / gfx1201, ROCm 7.13, native Ubuntu 24.04:
- Vector add: Chapter 6 logs/ch5_native_ubuntu_profiling.md, 2026-07-06.
  n=16777216, FP32, block=256, warmup=20, repeat=100; minimum HIP event time.
- Copy and matmul: Chapter 2 logs/micro_bench-native-ubuntu-2026-07-08.log.
  Copy uses 2048 MiB PER buffer and the average of 50 batched launches.
  Matmul is 4096 x 4096, FP32, average of 30 batched launches.

The old copy log labeled MiB/ms as GB/s. Recompute decimal GB/s from the
recorded 8.032 ms instead of reusing the incorrect 510.0 label. The figures
below are derived from rounded historical times, not new GPU measurements.
Neither reference is a specification peak or a universal performance bound.
Algorithmic bytes do not measure physical DRAM traffic or cache hits.

Usage:
    python plot_roofline_ch6.py --save
"""
import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

# Historical measurements and their workload definitions.
COPY_BUFFER_MIB = 2048
COPY_BATCH_AVG_MS = 8.032
MATMUL_SIZE = 4096
MATMUL_BATCH_AVG_MS = 12.944
N = 16_777_216
COALESCED_MIN_MS = 0.3338
LINECROSS_MIN_MS = 2.2456

# Unit conversions: MiB = 2**20 Byte; GB = 10**9 Byte; TFLOP = 10**12 FLOP.
BW_REFERENCE = 2 * COPY_BUFFER_MIB * 2**20 / (COPY_BATCH_AVG_MS * 1e-3) / 1e9
P_REFERENCE = 2 * MATMUL_SIZE**3 / (MATMUL_BATCH_AVG_MS * 1e-3) / 1e12
F = N
Q = 3 * N * 4
AI_VADD = F / Q
P_COALESCED = F / (COALESCED_MIN_MS * 1e-3) / 1e12
P_LINECROSS = F / (LINECROSS_MIN_MS * 1e-3) / 1e12
BW_COALESCED = Q / (COALESCED_MIN_MS * 1e-3) / 1e9
BW_LINECROSS = Q / (LINECROSS_MIN_MS * 1e-3) / 1e9
KNEE = P_REFERENCE * 1e3 / BW_REFERENCE


def plot(save_path=None):
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
    fig, ax = plt.subplots(figsize=(10.2, 6.6), dpi=180)
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#ffffff")

    # Draw the actual minimum of the two constraints; the sloped branch stops
    # at the knee instead of continuing above the horizontal branch.
    ai = np.unique(np.append(np.logspace(-2, 3, 600), KNEE))
    reference = np.minimum(BW_REFERENCE * ai / 1e3, P_REFERENCE)
    left = ai <= KNEE
    right = ai >= KNEE
    ax.plot(ai[left], reference[left], color="#2563eb", lw=2.5,
            label=f"Copy reference: {BW_REFERENCE:.0f} GB/s")
    ax.plot(ai[right], reference[right], color="#b45309", lw=2.5,
            label=f"FP32 matmul reference: {P_REFERENCE:.1f} TFLOPS")
    ax.scatter([KNEE], [P_REFERENCE], s=36, color="#334155", zorder=5)
    ax.axvline(KNEE, color="#94a3b8", lw=1, ls="--", alpha=0.8)
    ax.annotate(f"Knee: {KNEE:.1f} FLOP/Byte", (KNEE, P_REFERENCE),
                xytext=(8, -25), textcoords="offset points", fontsize=9,
                color="#475569")

    ax.scatter([AI_VADD], [P_COALESCED], s=100, marker="o", zorder=6,
               color="#059669", edgecolor="white", linewidth=1)
    ax.annotate(f"coalesced\n{P_COALESCED:.4f} TFLOPS | {BW_COALESCED:.0f} GB/s",
                (AI_VADD, P_COALESCED), xytext=(0.22, 0.042),
                textcoords="data", fontsize=10, color="#047857",
                arrowprops=dict(arrowstyle="-", color="#059669", lw=1))
    ax.scatter([AI_VADD], [P_LINECROSS], s=100, marker="X", zorder=6,
               color="#7c3aed", edgecolor="white", linewidth=1)
    ax.annotate(f"linecross, stride=32\n{P_LINECROSS:.5f} TFLOPS | {BW_LINECROSS:.1f} GB/s",
                (AI_VADD, P_LINECROSS), xytext=(0.19, 0.005),
                textcoords="data", fontsize=10, color="#6d28d9",
                arrowprops=dict(arrowstyle="-", color="#7c3aed", lw=1))
    ax.plot([AI_VADD, AI_VADD], [P_LINECROSS, P_COALESCED],
            ls=":", color="#94a3b8", lw=1, zorder=2)
    ax.text(0.013, 0.028, "Same AI\n1/12 FLOP/Byte",
            fontsize=9, color="#475569")

    ax.text(0.8, 0.55, "Bandwidth side", color="#2563eb", fontsize=11,
            rotation=27)
    ax.text(50, 15, "Compute side", color="#b45309", fontsize=11)
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlim(1e-2, 1e3)
    ax.set_ylim(2e-3, 30)
    ax.set_xlabel("Arithmetic intensity: F / Q  (FLOP/Byte)", labelpad=10)
    ax.set_ylabel("Performance: F / t  (TFLOPS)", labelpad=8)
    ax.set_title("Vector add on Radeon RX 9070 XT", loc="left", pad=17,
                 fontsize=15, weight="bold")
    ax.grid(True, which="major", color="#cbd5e1", alpha=0.6, lw=0.6)
    ax.grid(True, which="minor", color="#e2e8f0", alpha=0.6, lw=0.4)
    for spine in ax.spines.values():
        spine.set_color("#cbd5e1")
    ax.legend(loc="upper left", frameon=False, fontsize=9,
              title="Measured workload references, not hardware peaks",
              title_fontsize=9)
    fig.subplots_adjust(left=0.105, right=0.98, top=0.89, bottom=0.24)
    fig.text(0.105, 0.07,
             "ROCm 7.13 | native Ubuntu 24.04 | FP32 | historical measurements, July 2026\n"
             "Q = algorithmic bytes. A point above the copy reference does not prove a cache hit.",
             fontsize=9, color="#475569", linespacing=1.6)
    if save_path:
        fig.savefig(save_path, facecolor="white", bbox_inches="tight")
        print(f"saved: {save_path}")
    else:
        plt.show()
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--out", default=str(Path(__file__).with_name("roofline-ch6.png")))
    args = parser.parse_args()
    print(f"copy_reference_gbs={BW_REFERENCE:.6f}")
    print(f"fp32_reference_tflops={P_REFERENCE:.6f}")
    print(f"knee_flop_per_byte={KNEE:.6f}")
    print(f"coalesced_tflops={P_COALESCED:.8f}")
    print(f"linecross_tflops={P_LINECROSS:.8f}")
    plot(args.out if args.save else None)


if __name__ == "__main__":
    main()
