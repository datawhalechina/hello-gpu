#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENV_DIR="${PART_DIR}/.venv"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
SIZE="${SIZE:-16777216}"
BLOCK="${BLOCK:-256}"
TRITON_BLOCK="${TRITON_BLOCK:-1024}"
TRITON_PROGRAMS="${TRITON_PROGRAMS:-256}"
WARMUP="${WARMUP:-5}"
REPEAT="${REPEAT:-20}"
SEED="${SEED:-20260719}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch8.XXXXXX")"
HIP_BINARY="${BUILD_DIR}/reduction_hip"

cleanup() {
    rm -rf "${BUILD_DIR}"
}
trap cleanup EXIT

if [[ ! -f "${VENV_DIR}/bin/activate" ]]; then
    echo "missing ${VENV_DIR}/bin/activate" >&2
    echo "run: cd ${PART_DIR} && uv sync" >&2
    exit 1
fi

# activate-rocm.sh activates the same ../.venv and exposes its ROCm SDK paths.
# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

echo "== Chapter 8: compile HIP (arch=${GPU_ARCH}) =="
hipcc \
    --offload-arch="${GPU_ARCH}" \
    -O3 \
    -std=c++17 \
    "${SCRIPT_DIR}/reduction_hip.hip" \
    -o "${HIP_BINARY}"

if [[ "${RUN_EDGE_CASES}" == "1" ]]; then
    echo "== Chapter 8: boundary correctness =="
    for edge_size in 1 31 32 33 255 256 257 1027; do
        echo "-- N=${edge_size} / HIP --"
        "${HIP_BINARY}" \
            --version all \
            --size "${edge_size}" \
            --block "${BLOCK}" \
            --warmup 0 \
            --repeat 1 \
            --seed "${SEED}"

        echo "-- N=${edge_size} / Triton --"
        python "${SCRIPT_DIR}/reduction_triton.py" \
            --version all \
            --size "${edge_size}" \
            --block "${TRITON_BLOCK}" \
            --programs "${TRITON_PROGRAMS}" \
            --warmup 0 \
            --repeat 1 \
            --seed "${SEED}"
    done
fi

echo "== Chapter 8: main shape N=${SIZE} / HIP =="
"${HIP_BINARY}" \
    --version all \
    --size "${SIZE}" \
    --block "${BLOCK}" \
    --warmup "${WARMUP}" \
    --repeat "${REPEAT}" \
    --seed "${SEED}"

echo "== Chapter 8: main shape N=${SIZE} / Triton =="
python "${SCRIPT_DIR}/reduction_triton.py" \
    --version all \
    --size "${SIZE}" \
    --block "${TRITON_BLOCK}" \
    --programs "${TRITON_PROGRAMS}" \
    --warmup "${WARMUP}" \
    --repeat "${REPEAT}" \
    --seed "${SEED}"

echo "== Chapter 8 complete: inspect RESULT lines above =="
