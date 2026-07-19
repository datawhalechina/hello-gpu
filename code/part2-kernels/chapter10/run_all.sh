#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
M="${M:-512}"
N="${N:-512}"
K="${K:-512}"
WARMUP="${WARMUP:-5}"
REPEAT="${REPEAT:-20}"
SEED="${SEED:-20260719}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch10.XXXXXX")"
HIP_BINARY="${BUILD_DIR}/matmul_hip"

cleanup() {
    rm -rf "${BUILD_DIR}"
}
trap cleanup EXIT

if [[ ! -f "${PART_DIR}/.venv/bin/activate" ]]; then
    echo "missing ${PART_DIR}/.venv; run 'uv sync' in ${PART_DIR} first" >&2
    exit 1
fi
if [[ ! -f "${PART_DIR}/activate-rocm.sh" ]]; then
    echo "missing ${PART_DIR}/activate-rocm.sh" >&2
    exit 1
fi

# The helper activates ../.venv and exposes the ROCm SDK binaries/libraries.
# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

echo "[build] HIP FP32 matmul for ${GPU_ARCH}"
hipcc \
    --offload-arch="${GPU_ARCH}" \
    -O3 \
    -std=c++17 \
    "${SCRIPT_DIR}/matmul_hip.hip" \
    -o "${HIP_BINARY}"

if [[ "${RUN_EDGE_CASES}" == "1" ]]; then
    echo "[check] non-square and non-divisible boundary shapes"
    edge_shapes=(
        "1 1 1"
        "3 5 7"
        "15 17 19"
        "17 19 23"
        "31 33 29"
    )
    for shape in "${edge_shapes[@]}"; do
        read -r edge_m edge_n edge_k <<< "${shape}"
        echo "[check] M=${edge_m} N=${edge_n} K=${edge_k}"
        "${HIP_BINARY}" \
            --version all \
            --m "${edge_m}" --n "${edge_n}" --k "${edge_k}" \
            --warmup 0 --repeat 1 --seed "${SEED}"
        python "${SCRIPT_DIR}/matmul_triton.py" \
            --version all \
            --m "${edge_m}" --n "${edge_n}" --k "${edge_k}" \
            --warmup 0 --repeat 1 --seed "${SEED}"
    done
fi

echo "[benchmark] HIP M=${M} N=${N} K=${K}"
"${HIP_BINARY}" \
    --version all \
    --m "${M}" --n "${N}" --k "${K}" \
    --warmup "${WARMUP}" --repeat "${REPEAT}" --seed "${SEED}"

echo "[benchmark] PyTorch/Triton M=${M} N=${N} K=${K}"
python "${SCRIPT_DIR}/matmul_triton.py" \
    --version all \
    --m "${M}" --n "${N}" --k "${K}" \
    --warmup "${WARMUP}" --repeat "${REPEAT}" --seed "${SEED}"

echo "Chapter 10 run completed. Record the output together with the machine state."
