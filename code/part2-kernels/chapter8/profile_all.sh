#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
requested_gpu_arch="${GPU_ARCH:-}"
requested_hello_gpu_arch="${HELLO_GPU_ARCH:-}"
if [[ "${HELLO_GPU_SKIP_ACTIVATE:-0}" == "1" ]]; then
    command -v hipcc >/dev/null 2>&1 || { echo "HELLO_GPU_SKIP_ACTIVATE=1 requires hipcc on PATH" >&2; exit 1; }
    command -v python >/dev/null 2>&1 || { echo "HELLO_GPU_SKIP_ACTIVATE=1 requires python on PATH" >&2; exit 1; }
else
    if [[ ! -f "${PART_DIR}/activate-rocm.sh" ]]; then
        echo "missing ${PART_DIR}/activate-rocm.sh" >&2
        exit 1
    fi
    # shellcheck source=/dev/null
    source "${PART_DIR}/activate-rocm.sh"
fi

if [[ -n "${requested_gpu_arch}" && -n "${requested_hello_gpu_arch}" && "${requested_gpu_arch}" != "${requested_hello_gpu_arch}" ]]; then
    echo "GPU_ARCH (${requested_gpu_arch}) and HELLO_GPU_ARCH (${requested_hello_gpu_arch}) must match" >&2
    exit 2
fi
if [[ -n "${requested_gpu_arch}" ]]; then
    GPU_ARCH="${requested_gpu_arch}"
elif [[ -n "${requested_hello_gpu_arch}" ]]; then
    GPU_ARCH="${requested_hello_gpu_arch}"
else
    if ! rocminfo_output="$(rocminfo)"; then
        echo "rocminfo failed; set GPU_ARCH or HELLO_GPU_ARCH explicitly" >&2
        exit 1
    fi
    mapfile -t detected_arches < <(printf '%s\n' "${rocminfo_output}" | sed -nE 's/^[[:space:]]*Name:[[:space:]]*(gfx[0-9]+)[[:space:]]*$/\1/p' | sort -u)
    if (( ${#detected_arches[@]} != 1 )); then
        echo "rocminfo must contain exactly one unique Name: gfx...; found ${detected_arches[*]:-none}" >&2
        exit 1
    fi
    GPU_ARCH="${detected_arches[0]}"
fi
case "${GPU_ARCH}" in
    gfx1100|gfx1151|gfx1201) ;;
    *)
        echo "GPU_ARCH/HELLO_GPU_ARCH must resolve to gfx1100, gfx1151, or gfx1201; got ${GPU_ARCH}" >&2
        exit 2
        ;;
esac
HELLO_GPU_ARCH="${GPU_ARCH}"
export GPU_ARCH HELLO_GPU_ARCH

SOURCE_SHA256="$(python "${SCRIPT_DIR}/summarize_results.py" --chapter-dir "${SCRIPT_DIR}" --print-source-sha256)"
LOG_DIR="${SCRIPT_DIR}/logs"
PROFILE_DIR="${SCRIPT_DIR}/profiles"
SIZE="${SIZE:-16777216}"
HIP_BLOCK="${HIP_BLOCK:-256}"
TRITON_BLOCK="${TRITON_BLOCK:-1024}"
PROFILE_WARMUP="${PROFILE_WARMUP:-0}"
PROFILE_REPEAT="${PROFILE_REPEAT:-10}"
TRITON_PROFILE_MODE="${TRITON_PROFILE_MODE:-skip}"
SEED="${SEED:-20260716}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-chapter8-profile.XXXXXX")"
HIP_BINARY="${BUILD_DIR}/vector_add_hip"

# Triton must be profiled by a rocprofv3 compatible with the ROCm runtime
# loaded by the active Python. Prefer an environment-bundled TheRock SDK;
# otherwise accept a system tool only when its ROCm release line matches
# torch.version.hip.
TRITON_ROCPROFV3=""
TRITON_ROCM_ROOT=""
TRITON_LIBRARY_PATH=""
TRITON_ROCPROF_KIND=""
TRITON_ROCPROF_REASON=""
TRITON_TORCH_HIP=""
TRITON_ROCPROF_ROCM=""
if [[ "${TRITON_PROFILE_MODE}" == "direct" ]]; then
    mapfile -t rocprof_fields < <(
        python "${SCRIPT_DIR}/resolve_rocprofv3.py" --format lines
    )
    if (( ${#rocprof_fields[@]} != 8 )); then
        echo "rocprof resolver returned ${#rocprof_fields[@]} fields; expected 8" >&2
        exit 1
    fi
    rocprof_available="${rocprof_fields[0]}"
    TRITON_ROCPROF_KIND="${rocprof_fields[1]}"
    TRITON_ROCPROFV3="${rocprof_fields[2]}"
    TRITON_ROCM_ROOT="${rocprof_fields[3]}"
    TRITON_LIBRARY_PATH="${rocprof_fields[4]}"
    TRITON_TORCH_HIP="${rocprof_fields[5]}"
    TRITON_ROCPROF_ROCM="${rocprof_fields[6]}"
    TRITON_ROCPROF_REASON="${rocprof_fields[7]}"
    if [[ "${rocprof_available}" != "1" ]]; then
        echo "No compatible rocprofv3 for Triton: ${TRITON_ROCPROF_REASON}" >&2
        exit 1
    fi
    echo "Triton profiling resolver: kind=${TRITON_ROCPROF_KIND} tool=${TRITON_ROCPROFV3} root=${TRITON_ROCM_ROOT} torch_hip=${TRITON_TORCH_HIP} rocprof_rocm=${TRITON_ROCPROF_ROCM}"
fi

cleanup() {
    rm -rf "${BUILD_DIR}"
}
trap cleanup EXIT

mkdir -p "${LOG_DIR}" "${PROFILE_DIR}"
rm -f \
    "${PROFILE_DIR}"/*_kernel_trace.csv \
    "${PROFILE_DIR}"/*_agent_info.csv \
    "${PROFILE_DIR}/profile_config.env"
rm -f "${SCRIPT_DIR}/evidence/profile_summary.csv"
python "${SCRIPT_DIR}/summarize_results.py" \
    --chapter-dir "${SCRIPT_DIR}"
echo "profile evidence reset before trace collection"

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

profile_triton_command() {
    local label="$1"
    shift
    local -a tool=(
        "${TRITON_ROCPROFV3}"
        "--rocm-root" "${TRITON_ROCM_ROOT}"
    )
    local -a env_prefix=( )
    if [[ -n "${TRITON_LIBRARY_PATH}" ]]; then
        env_prefix=(
            env
            "LD_LIBRARY_PATH=${TRITON_LIBRARY_PATH}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
        )
    fi
    echo "profiling ${label} with ${TRITON_ROCPROF_KIND} rocprofv3"
    "${env_prefix[@]}" "${tool[@]}" \
        --kernel-trace \
        --output-directory "${PROFILE_DIR}" \
        --output-file "${label}" \
        --output-format csv \
        -- "$@" \
        2>&1 | tee "${LOG_DIR}/profile_${label}.log"
}

hip_profile_failed=0
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
    if ! profile_command "hip-${version}" "${HIP_BINARY}" "${hip_args[@]}"; then
        hip_profile_failed=1
    fi
done

# Populate Triton's compilation cache and validate correctness before profiling.
triton_profile_failed=0
triton_precheck_passed=1
if ! python "${SCRIPT_DIR}/vector_add_triton.py" \
    --version all \
    --size "${SIZE}" \
    --block "${TRITON_BLOCK}" \
    --warmup 0 \
    --repeat 1 \
    --seed "${SEED}" \
    2>&1 | tee "${LOG_DIR}/profile_triton_precheck.log"; then
    triton_precheck_passed=0
    triton_profile_failed=1
fi

if ((triton_precheck_passed != 0)); then
    if [[ "${TRITON_PROFILE_MODE}" == "direct" ]]; then
        for version in t0 t1; do
            if ! profile_triton_command "triton-${version}" \
                python "${SCRIPT_DIR}/vector_add_triton.py" \
                --version "${version}" \
                --size "${SIZE}" \
                --block "${TRITON_BLOCK}" \
                --warmup "${PROFILE_WARMUP}" \
                --repeat "${PROFILE_REPEAT}" \
                --seed "${SEED}"; then
                triton_profile_failed=1
            fi
        done
    elif [[ "${TRITON_PROFILE_MODE}" == "skip" ]]; then
        echo "Triton profiling skipped by TRITON_PROFILE_MODE=skip"
        triton_profile_failed=1
    else
        echo "TRITON_PROFILE_MODE must be direct or skip; got ${TRITON_PROFILE_MODE}" >&2
        exit 2
    fi
fi

{
    echo "source_sha256=${SOURCE_SHA256}"
    echo "size=${SIZE}"
    echo "hip_block=${HIP_BLOCK}"
    echo "triton_t0_block=256"
    echo "triton_block=${TRITON_BLOCK}"
    echo "warmup=${PROFILE_WARMUP}"
    echo "repeat=${PROFILE_REPEAT}"
    echo "seed=${SEED}"
    echo "gpu_arch=${GPU_ARCH}"
    echo "grid=${GRID:-auto}"
    echo "triton_profile_mode=${TRITON_PROFILE_MODE}"
    echo "triton_rocprof_kind=${TRITON_ROCPROF_KIND:-unavailable}"
    echo "triton_rocprof_executable=${TRITON_ROCPROFV3:-unavailable}"
    echo "triton_rocm_root=${TRITON_ROCM_ROOT:-unavailable}"
    echo "triton_torch_hip=${TRITON_TORCH_HIP:-unavailable}"
    echo "triton_rocprof_rocm=${TRITON_ROCPROF_ROCM:-unavailable}"
} > "${PROFILE_DIR}/profile_config.env"

profile_summary_incomplete=0
if ! python "${SCRIPT_DIR}/summarize_results.py" \
    --chapter-dir "${SCRIPT_DIR}" \
    --require-complete-profiles; then
    profile_summary_incomplete=1
fi
echo "profiles written to ${PROFILE_DIR}"
if ((hip_profile_failed != 0 || triton_profile_failed != 0 || profile_summary_incomplete != 0)); then
    echo "Profiling incomplete; partial profile_summary.csv was published" >&2
    exit 1
fi
