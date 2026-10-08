#!/usr/bin/env bash
set -e
cd code/part2-kernels
uv sync --locked
source ./activate-rocm.sh
read -r -p '粘贴上次输出的结果目录：' RUN
test -d "$RUN/build" && printf '继续使用结果目录：%s\n' "$RUN"
test -x "$RUN/build/vector_add_hip" && printf '已有 HIP 程序：%s\n' "$RUN/build/vector_add_hip"
