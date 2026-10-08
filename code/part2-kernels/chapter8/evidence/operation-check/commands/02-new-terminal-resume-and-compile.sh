#!/usr/bin/env bash
set -e
cd code/part2-kernels
uv sync --locked
source ./activate-rocm.sh
RUN=chapter8/results/walkthrough-bW89n8
test -d "$RUN/build" && printf '继续使用结果目录：%s
' "$RUN"
if [[ ! -x "$RUN/build/vector_add_hip" ]]; then
  hipcc --offload-arch=gfx1201 -O3 -std=c++17 \
    chapter8/vector_add_hip.hip -o "$RUN/build/vector_add_hip"
  printf '编译完成：%s
' "$RUN/build/vector_add_hip"
else
  printf '复用已有程序：%s
' "$RUN/build/vector_add_hip"
fi
