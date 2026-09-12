# Chapter 10 visuals

- `../softmax-journey.vue` is the editable source for the interactive stable Softmax example. Values are computed from `[1000,1001,1002]` using max, subtraction, exponentiation, sum and division. Display values are rounded to four decimals; playback duration is not GPU time.
- `plot_softmax.py` reads `code/part2-kernels/chapter10/evidence/summary.csv` and redraws `softmax-performance.png`. Bars are medians of three process medians; error bars show their range. The figure explicitly identifies the historical source revision, so it does not imply that later code fixes have the same measured performance.
- `softmax-performance.webp` is derived from the PNG for the documentation image pipeline.

To regenerate the chart from the repository root, use Python with Matplotlib and run `python3 docs/part2-kernels/chapter10/images/plot_softmax.py`. This is chart rendering only. The measurements remain the archived 2026-07-19 RX 9070 XT / ROCm 7.13 / native Ubuntu results.
