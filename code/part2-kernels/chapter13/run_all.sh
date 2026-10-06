#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
ROWS="${ROWS:-1024}"
COLS="${COLS:-4096}"
BLOCK="${BLOCK:-256}"
EPSILON="${EPSILON:-1e-5}"
INPUT_MODE="${INPUT_MODE:-normal}"
TRITON_ROWS_PER_PROGRAM="${TRITON_ROWS_PER_PROGRAM:-1}"
WARMUP="${WARMUP:-5}"
REPEAT="${REPEAT:-20}"
SEED="${SEED:-20260920}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch13.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
    "${SCRIPT_DIR}/rmsnorm_hip.hip" -o "${BUILD_DIR}/rmsnorm_hip"

# The default retains both legacy single-row variants. Grouped rows fix four warps.
triton_options=(--version all)
if [[ "${TRITON_ROWS_PER_PROGRAM}" != 1 ]]; then
    triton_options=(--version configured --num-warps 4 --rows-per-program "${TRITON_ROWS_PER_PROGRAM}")
fi

run_pair() {
    local rows="$1" cols="$2" warmup="$3" repeat="$4"
    "${BUILD_DIR}/rmsnorm_hip" --version all --rows "${rows}" --cols "${cols}" \
        --block "${BLOCK}" --epsilon "${EPSILON}" --input "${INPUT_MODE}" \
        --warmup "${warmup}" --repeat "${repeat}" --seed "${SEED}"
    python "${SCRIPT_DIR}/rmsnorm_triton.py" "${triton_options[@]}" \
        --rows "${rows}" --cols "${cols}" --epsilon "${EPSILON}" --input "${INPUT_MODE}" \
        --warmup "${warmup}" --repeat "${repeat}" --seed "${SEED}"
}

if [[ "${RUN_EDGE_CASES}" == 1 ]]; then
    echo "[chapter13] single-column and column/row-tail correctness"
    for cols in 1 129 257 4097; do
        run_pair 33 "${cols}" 0 1
    done
fi

echo "[chapter13] teaching benchmark"
run_pair "${ROWS}" "${COLS}" "${WARMUP}" "${REPEAT}"
