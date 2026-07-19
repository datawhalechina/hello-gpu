#!/usr/bin/env bash
set -euo pipefail

SOURCE_COMMIT="${SOURCE_COMMIT:-}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_SHA256="$(python "${SCRIPT_DIR}/summarize_results.py" --chapter-dir "${SCRIPT_DIR}" --print-source-sha256)"
LOG_DIR="${SCRIPT_DIR}/logs"
PROFILE_DIR="${SCRIPT_DIR}/profiles"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
SIZE="${SIZE:-16777216}"
HIP_BLOCK="${HIP_BLOCK:-256}"
TRITON_BLOCK="${TRITON_BLOCK:-1024}"
PROFILE_WARMUP="${PROFILE_WARMUP:-0}"
PROFILE_REPEAT="${PROFILE_REPEAT:-10}"
SEED="${SEED:-20260716}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch7-profile.XXXXXX")"
HIP_BINARY="${BUILD_DIR}/vector_add_hip"

cleanup() {
    rm -rf "${BUILD_DIR}"
}
trap cleanup EXIT

mkdir -p "${LOG_DIR}" "${PROFILE_DIR}"

if [[ ! -f "${PART_DIR}/activate-rocm.sh" ]]; then
    echo "missing ${PART_DIR}/activate-rocm.sh" >&2
    exit 1
fi

# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

bash "${SCRIPT_DIR}/collect_environment.sh" \
    2>&1 | tee "${LOG_DIR}/profile_environment.log"

hipcc \
    --offload-arch="${GPU_ARCH}" \
    -O3 \
    -std=c++17 \
    "${SCRIPT_DIR}/vector_add_hip.hip" \
    -o "${HIP_BINARY}" \
    2>&1 | tee "${LOG_DIR}/profile_hip_compile.log"

profile_command() {
    local label="$1"
    shift
    echo "profiling ${label}"
    rocprofv3 \
        --kernel-trace \
        --output-directory "${PROFILE_DIR}" \
        --output-file "${label}" \
        --output-format csv \
        -- "$@" \
        2>&1 | tee "${LOG_DIR}/profile_${label}.log"
}

for version in v0 v1-contiguous v1-strided v2 v3; do
    hip_args=(
        --version "${version}"
        --size "${SIZE}"
        --block "${HIP_BLOCK}"
        --warmup "${PROFILE_WARMUP}"
        --repeat "${PROFILE_REPEAT}"
        --seed "${SEED}"
    )
    if [[ -n "${GRID:-}" ]]; then
        hip_args+=(--grid "${GRID}")
    fi
    profile_command "hip-${version}" "${HIP_BINARY}" "${hip_args[@]}"
done

# Populate Triton's compilation cache and fail early on correctness before
# starting one profiler process per version.
python "${SCRIPT_DIR}/vector_add_triton.py" \
    --version all \
    --size "${SIZE}" \
    --block "${TRITON_BLOCK}" \
    --warmup 0 \
    --repeat 1 \
    --seed "${SEED}" \
    2>&1 | tee "${LOG_DIR}/profile_triton_precheck.log"

for version in t0 t1; do
    profile_command "triton-${version}" \
        python "${SCRIPT_DIR}/vector_add_triton.py" \
        --version "${version}" \
        --size "${SIZE}" \
        --block "${TRITON_BLOCK}" \
        --warmup "${PROFILE_WARMUP}" \
        --repeat "${PROFILE_REPEAT}" \
        --seed "${SEED}"
done

{
    echo "source_commit=${SOURCE_COMMIT}"
    echo "source_sha256=${SOURCE_SHA256}"
    echo "size=${SIZE}"
    echo "hip_block=${HIP_BLOCK}"
    echo "triton_block=${TRITON_BLOCK}"
    echo "warmup=${PROFILE_WARMUP}"
    echo "repeat=${PROFILE_REPEAT}"
    echo "seed=${SEED}"
    echo "gpu_arch=${GPU_ARCH}"
    echo "grid=${GRID:-auto}"
} > "${PROFILE_DIR}/profile_config.env"

python "${SCRIPT_DIR}/summarize_results.py" \
    --chapter-dir "${SCRIPT_DIR}" \
    --git-commit "${SOURCE_COMMIT}"
echo "profiles written to ${PROFILE_DIR}"
