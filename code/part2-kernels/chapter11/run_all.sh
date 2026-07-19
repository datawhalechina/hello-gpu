#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
SEQ="${SEQ:-128}"
DIM="${DIM:-64}"
WARMUP="${WARMUP:-5}"
REPEAT="${REPEAT:-20}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch11.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
    "${SCRIPT_DIR}/attention_hip.hip" -o "${BUILD_DIR}/attention_hip"

echo "[chapter11] edge correctness"
"${BUILD_DIR}/attention_hip" --version all --seq 7 --dim 13 --warmup 0 --repeat 1
python "${SCRIPT_DIR}/attention_triton.py" --version all --seq 7 --dim 13 --warmup 0 --repeat 1

echo "[chapter11] teaching benchmark"
"${BUILD_DIR}/attention_hip" --version all --seq "${SEQ}" --dim "${DIM}" \
    --warmup "${WARMUP}" --repeat "${REPEAT}"
python "${SCRIPT_DIR}/attention_triton.py" --version all \
    --seq "${SEQ}" --dim "${DIM}" --warmup "${WARMUP}" --repeat "${REPEAT}"
