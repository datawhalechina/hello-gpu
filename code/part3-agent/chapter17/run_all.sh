#!/usr/bin/env bash
# 第 17 章：基线检查、Agent 搜索、独立配对复测与绘图。
set -euo pipefail
PART3_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export MAX_STEPS="${MAX_STEPS:-25}"
exec bash "${PART3_DIR}/chapter16/run_and_visualize.sh" "$@"
