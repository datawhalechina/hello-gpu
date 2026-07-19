#!/usr/bin/env bash
set -euo pipefail

SOURCE_COMMIT="${SOURCE_COMMIT:-}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [[ ! -f "${PART_DIR}/activate-rocm.sh" ]]; then
    echo "missing ${PART_DIR}/activate-rocm.sh" >&2
    exit 1
fi
# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"
SOURCE_SHA256="$(python "${SCRIPT_DIR}/summarize_results.py" --chapter-dir "${SCRIPT_DIR}" --print-source-sha256)"
LOG_DIR="${SCRIPT_DIR}/logs"
PROFILE_DIR="${SCRIPT_DIR}/profiles"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
SIZE="${SIZE:-16777216}"
HIP_BLOCK="${HIP_BLOCK:-256}"
TRITON_BLOCK="${TRITON_BLOCK:-1024}"
WARMUP="${WARMUP:-10}"
REPEAT="${REPEAT:-50}"
SEED="${SEED:-20260716}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
RUN_TRITON_VIZ="${RUN_TRITON_VIZ:-1}"
INDEPENDENT_RUNS="${INDEPENDENT_RUNS:-3}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch7.XXXXXX")"
HIP_BINARY="${BUILD_DIR}/vector_add_hip"

cleanup() {
    rm -rf "${BUILD_DIR}"
}
trap cleanup EXIT

mkdir -p "${LOG_DIR}/runs" "${PROFILE_DIR}"
rm -f "${LOG_DIR}/runs"/run*.log "${LOG_DIR}/runs"/hip_run*.log "${LOG_DIR}/runs"/triton_run*.log

{
    echo "timestamp=$(date -Iseconds)"
    echo "source_commit=${SOURCE_COMMIT}"
    echo "source_sha256=${SOURCE_SHA256}"
    echo "size=${SIZE}"
    echo "hip_block=${HIP_BLOCK}"
    echo "triton_t0_block=256"
    echo "triton_block=${TRITON_BLOCK}"
    echo "warmup=${WARMUP}"
    echo "repeat=${REPEAT}"
    echo "seed=${SEED}"
    echo "independent_runs=${INDEPENDENT_RUNS}"
    echo "gpu_arch=${GPU_ARCH}"
    echo "run_edge_cases=${RUN_EDGE_CASES}"
    echo "run_triton_viz=${RUN_TRITON_VIZ}"
    echo "grid=${GRID:-auto}"
} > "${LOG_DIR}/benchmark_manifest.env"

if command -v rocm-smi >/dev/null 2>&1; then
    rocm-smi --showuse --showmemuse \
        2>&1 | tee "${LOG_DIR}/pre_benchmark_gpu_state.log" || true
else
    echo "rocm-smi unavailable" | tee "${LOG_DIR}/pre_benchmark_gpu_state.log"
fi

bash "${SCRIPT_DIR}/collect_environment.sh" \
    2>&1 | tee "${LOG_DIR}/environment.log"

hipcc \
    --offload-arch="${GPU_ARCH}" \
    -O3 \
    -std=c++17 \
    "${SCRIPT_DIR}/vector_add_hip.hip" \
    -o "${HIP_BINARY}" \
    2>&1 | tee "${LOG_DIR}/hip_compile.log"

hip_common_args=(
    --version all
    --block "${HIP_BLOCK}"
    --seed "${SEED}"
)
if [[ -n "${GRID:-}" ]]; then
    hip_common_args+=(--grid "${GRID}")
fi

# Correctness comes first. These sizes cover empty masks, wave/block edges,
# and the float4 tail before any performance record is produced.
if [[ "${RUN_EDGE_CASES}" == "1" ]]; then
    : > "${LOG_DIR}/hip_correctness.log"
    : > "${LOG_DIR}/triton_correctness.log"
    for edge_size in 1 31 32 33 255 256 257 1027; do
        "${HIP_BINARY}" \
            "${hip_common_args[@]}" \
            --size "${edge_size}" \
            --warmup 0 \
            --repeat 1 \
            2>&1 | tee -a "${LOG_DIR}/hip_correctness.log"

        python "${SCRIPT_DIR}/vector_add_triton.py" \
            --version all \
            --size "${edge_size}" \
            --block "${TRITON_BLOCK}" \
            --warmup 0 \
            --repeat 1 \
            --seed "${SEED}" \
            2>&1 | tee -a "${LOG_DIR}/triton_correctness.log"
    done
fi

if [[ "${RUN_TRITON_VIZ}" == "1" ]]; then
    python "${SCRIPT_DIR}/visualize_triton.py" \
        --size 13 \
        --block 8 \
        2>&1 | tee "${LOG_DIR}/triton_viz.log"
fi

"${HIP_BINARY}" \
    "${hip_common_args[@]}" \
    --size "${SIZE}" \
    --warmup "${WARMUP}" \
    --repeat "${REPEAT}" \
    2>&1 | tee "${LOG_DIR}/hip_benchmark.log"

python "${SCRIPT_DIR}/vector_add_triton.py" \
    --version all \
    --size "${SIZE}" \
    --block "${TRITON_BLOCK}" \
    --warmup "${WARMUP}" \
    --repeat "${REPEAT}" \
    --seed "${SEED}" \
    2>&1 | tee "${LOG_DIR}/triton_benchmark.log"

if ((INDEPENDENT_RUNS > 0)); then
    for run in $(seq 1 "${INDEPENDENT_RUNS}"); do
        "${HIP_BINARY}" \
            "${hip_common_args[@]}" \
            --size "${SIZE}" \
            --warmup "${WARMUP}" \
            --repeat "${REPEAT}" \
            > "${LOG_DIR}/runs/run${run}.log" 2>&1

        python "${SCRIPT_DIR}/vector_add_triton.py" \
            --version all \
            --size "${SIZE}" \
            --block "${TRITON_BLOCK}" \
            --warmup "${WARMUP}" \
            --repeat "${REPEAT}" \
            --seed "${SEED}" \
            >> "${LOG_DIR}/runs/run${run}.log" 2>&1
    done
fi

python "${SCRIPT_DIR}/summarize_results.py" \
    --chapter-dir "${SCRIPT_DIR}" \
    --git-commit "${SOURCE_COMMIT}"
echo "logs written to ${LOG_DIR}"
echo "summary written to ${SCRIPT_DIR}/evidence"
