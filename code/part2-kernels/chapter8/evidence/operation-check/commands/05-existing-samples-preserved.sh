#!/usr/bin/env bash
set -e
cd code/part2-kernels
uv sync --locked
source ./activate-rocm.sh
RUN=chapter8/results/walkthrough-bW89n8
test -d "$RUN/build" && printf '继续使用结果目录：%s
' "$RUN"
mkdir -p "$RUN/configs/hip-v0-smoke"
if test -e "$RUN/configs/hip-v0-smoke/benchmark-p1.samples.csv"; then
  printf '已有结果，保留文件：%s
' "$RUN/configs/hip-v0-smoke/benchmark-p1.samples.csv"
else
  "$RUN/build/vector_add_hip" --version v0 --size 17 --block 256 \
    --warmup 0 --repeat 1 --seed 20260920 \
    --samples "$RUN/configs/hip-v0-smoke/benchmark-p1.samples.csv" \
    --config-id hip-v0-smoke --process 1
fi
