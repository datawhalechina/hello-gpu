#!/usr/bin/env bash
set -e
cd code/part2-kernels
uv sync --locked
source ./activate-rocm.sh
mkdir -p chapter8/results
RUN=$(mktemp -d chapter8/results/walkthrough-XXXXXX)
mkdir "$RUN/build"
printf '本轮结果目录：%s
' "$RUN"
printf 'RUN=%s
' "$RUN"
