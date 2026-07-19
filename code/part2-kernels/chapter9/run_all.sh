#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${PART_DIR}/.venv"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
ROWS="${ROWS:-4096}"
COLS="${COLS:-1024}"
HIP_BLOCK="${HIP_BLOCK:-256}"
WARMUP="${WARMUP:-10}"
REPEAT="${REPEAT:-50}"
SEED="${SEED:-20260719}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch9.XXXXXX")"
HIP_BINARY="${BUILD_DIR}/softmax_hip"

cleanup() {
    rm -rf "${BUILD_DIR}"
}
trap cleanup EXIT

# activate-rocm.sh activates ../.venv and exposes the ROCm SDK installed in it.
if [[ ! -f "${VENV_DIR}/bin/activate" ]]; then
    echo "missing ${VENV_DIR}; run 'uv sync' in ${PART_DIR}" >&2
    exit 1
fi
if [[ ! -f "${PART_DIR}/activate-rocm.sh" ]]; then
    echo "missing ${PART_DIR}/activate-rocm.sh" >&2
    exit 1
fi
# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

hipcc \
    --offload-arch="${GPU_ARCH}" \
    -O3 \
    -std=c++17 \
    "${SCRIPT_DIR}/softmax_hip.hip" \
    -o "${HIP_BINARY}"

run_shape() {
    local rows="$1"
    local columns="$2"
    local warmup="$3"
    local repeat="$4"

    echo "RUN shape=${rows}x${columns} warmup=${warmup} repeat=${repeat}"
    "${HIP_BINARY}" \
        --version all \
        --rows "${rows}" \
        --cols "${columns}" \
        --block "${HIP_BLOCK}" \
        --warmup "${warmup}" \
        --repeat "${repeat}" \
        --seed "${SEED}"

    python "${SCRIPT_DIR}/softmax_triton.py" \
        --version all \
        --rows "${rows}" \
        --cols "${columns}" \
        --warmup "${warmup}" \
        --repeat "${repeat}" \
        --seed "${SEED}"
}

if [[ "${RUN_EDGE_CASES}" == "1" ]]; then
    # One element, wave boundaries, non-power-of-two columns, and a block tail.
    while read -r edge_rows edge_cols; do
        run_shape "${edge_rows}" "${edge_cols}" 0 1
    done <<'SHAPES'
1 1
2 31
3 32
4 33
2 255
3 257
SHAPES
fi

run_shape "${ROWS}" "${COLS}" "${WARMUP}" "${REPEAT}"
