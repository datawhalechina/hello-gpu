#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
SEQ="${SEQ:-128}"
DIM="${DIM:-64}"
BLOCK="${BLOCK:-256}"
BLOCK_K="${BLOCK_K:-32}"
NUM_WARPS="${NUM_WARPS:-4}"
INPUT="${INPUT:-dyadic}"
SEED="${SEED:-20260920}"
PROCESS="${PROCESS:-1}"
PROFILE_WARMUP="${PROFILE_WARMUP:-0}"
PROFILE_REPEAT="${PROFILE_REPEAT:-5}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch12-profile.XXXXXX")"
STAGING_ROOT="$(mktemp -d "${SCRIPT_DIR}/.profiles-staging.XXXXXX")"
PROFILE_DIR="${STAGING_ROOT}/profiles"
PREVIOUS_PROFILES="${STAGING_ROOT}/previous-profiles"
PUBLISHED=0
cleanup() {
    if [[ "${PUBLISHED}" != 1 && -e "${PREVIOUS_PROFILES}" && ! -e "${SCRIPT_DIR}/profiles" ]]; then
        mv "${PREVIOUS_PROFILES}" "${SCRIPT_DIR}/profiles"
    fi
    rm -rf "${BUILD_DIR}" "${STAGING_ROOT}"
}
trap cleanup EXIT
mkdir -p "${PROFILE_DIR}"
# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"
hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
    "${SCRIPT_DIR}/attention_hip.hip" -o "${BUILD_DIR}/attention_hip"
profile() {
    local label="$1"
    shift
    rocprofv3 --kernel-trace --output-directory "${PROFILE_DIR}" \
        --output-file "${label}" --output-format csv -- "$@"
}
common=(--seq "${SEQ}" --dim "${DIM}" --input "${INPUT}" --seed "${SEED}"
        --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --process "${PROCESS}")
for version in materialized online; do
    label="hip-${version}-b${BLOCK}"
    profile "${label}" "${BUILD_DIR}/attention_hip" --version "${version}" \
        --block "${BLOCK}" --config-id "${label}" "${common[@]}"
done
for version in materialized online; do
    tile=32
    if [[ "${version}" == "online" ]]; then tile="${BLOCK_K}"; fi
    label="triton-${version}-k${tile}"
    profile "${label}" python "${SCRIPT_DIR}/attention_triton.py" \
        --version "${version}" --block-k "${tile}" --num-warps "${NUM_WARPS}" \
        --config-id "${label}" "${common[@]}"
done
printf 'gpu_arch=%s\nseq=%s\ndim=%s\nblock=%s\nonline_block_k=%s\nmaterialized_block_k=32\nnum_warps=%s\ninput=%s\nseed=%s\nprocess=%s\nprofile_warmup=%s\nprofile_repeat=%s\n' \
    "${GPU_ARCH}" "${SEQ}" "${DIM}" "${BLOCK}" "${BLOCK_K}" "${NUM_WARPS}" \
    "${INPUT}" "${SEED}" "${PROCESS}" "${PROFILE_WARMUP}" "${PROFILE_REPEAT}" \
    > "${PROFILE_DIR}/profile_config.env"
if [[ -e "${SCRIPT_DIR}/profiles" ]]; then
    mv "${SCRIPT_DIR}/profiles" "${PREVIOUS_PROFILES}"
fi
mv "${PROFILE_DIR}" "${SCRIPT_DIR}/profiles"
PUBLISHED=1
