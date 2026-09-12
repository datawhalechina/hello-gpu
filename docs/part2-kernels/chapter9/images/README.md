# Chapter 9 visuals

- `../reduction-journey.vue` is the editable source for the interactive reduction tree and two-stage partial example. It uses `[3,1,7,0,4,1,6,2]`; every intermediate sum is computed from these values. Stage duration is instructional, not measured GPU time.
- `plot_reduction.py` reads `code/part2-kernels/chapter9/evidence/summary.csv` and redraws `reduction-performance.png`. The top panel compares all five archived implementations; the lower panel enlarges the three two-stage implementations on a separate linear axis. Bars are medians of three process medians; error bars show their range.
- `reduction-performance.webp` is derived from the PNG for the documentation image pipeline.

To regenerate the chart from the repository root, use Python with Matplotlib and run `python3 docs/part2-kernels/chapter9/images/plot_reduction.py`. This is chart rendering only, not a GPU benchmark. The source measurements remain the archived 2026-07-19 RX 9070 XT / ROCm 7.13 / native Ubuntu results.
