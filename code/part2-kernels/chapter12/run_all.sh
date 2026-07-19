#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
ROWS="${ROWS:-1024}"
COLS="${COLS:-4096}"
WARMUP="${WARMUP:-5}"
REPEAT="${REPEAT:-20}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch12.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
    "${SCRIPT_DIR}/rmsnorm_hip.hip" -o "${BUILD_DIR}/rmsnorm_hip"

echo "[chapter12] edge correctness"
"${BUILD_DIR}/rmsnorm_hip" --version all --rows 3 --cols 13 --warmup 0 --repeat 1
python "${SCRIPT_DIR}/rmsnorm_triton.py" --version all --rows 3 --cols 13 --warmup 0 --repeat 1

echo "[chapter12] teaching benchmark"
"${BUILD_DIR}/rmsnorm_hip" --version all --rows "${ROWS}" --cols "${COLS}" \
    --warmup "${WARMUP}" --repeat "${REPEAT}"
python "${SCRIPT_DIR}/rmsnorm_triton.py" --version all \
    --rows "${ROWS}" --cols "${COLS}" --warmup "${WARMUP}" --repeat "${REPEAT}"
