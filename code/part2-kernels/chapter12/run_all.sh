#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
ROWS="${ROWS:-1024}"
COLS="${COLS:-4096}"
WARMUP="${WARMUP:-5}"
REPEAT="${REPEAT:-20}"
SEED="${SEED:-20260719}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch12.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
    "${SCRIPT_DIR}/rmsnorm_hip.hip" -o "${BUILD_DIR}/rmsnorm_hip"

if [[ "${RUN_EDGE_CASES}" == "1" ]]; then
    echo "[chapter12] edge correctness"
    "${BUILD_DIR}/rmsnorm_hip" --version all --rows 33 --cols 257 --warmup 0 --repeat 1 --seed "${SEED}"
    python "${SCRIPT_DIR}/rmsnorm_triton.py" --version all --rows 33 --cols 257 --warmup 0 --repeat 1 --seed "${SEED}"
fi

echo "[chapter12] teaching benchmark"
"${BUILD_DIR}/rmsnorm_hip" --version all --rows "${ROWS}" --cols "${COLS}" \
    --warmup "${WARMUP}" --repeat "${REPEAT}" --seed "${SEED}"
python "${SCRIPT_DIR}/rmsnorm_triton.py" --version all \
    --rows "${ROWS}" --cols "${COLS}" --warmup "${WARMUP}" --repeat "${REPEAT}" --seed "${SEED}"
