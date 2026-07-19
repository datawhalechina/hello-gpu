#!/usr/bin/env bash
set -euo pipefail

SOURCE_COMMIT="${SOURCE_COMMIT:-}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]]; then echo "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA" >&2; exit 2; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"; ROWS="${ROWS:-4096}"; COLS="${COLS:-1024}"; HIP_BLOCK="${HIP_BLOCK:-256}"; SEED="${SEED:-20260719}"
PROFILE_WARMUP="${PROFILE_WARMUP:-0}"; PROFILE_REPEAT="${PROFILE_REPEAT:-5}"; BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch9-profile.XXXXXX")"
STAGING_ROOT="$(mktemp -d "${SCRIPT_DIR}/.profiles-staging.XXXXXX")"; PROFILE_DIR="${STAGING_ROOT}/profiles"; PREVIOUS_PROFILES="${STAGING_ROOT}/previous-profiles"; PUBLISHED=0
cleanup() { if [[ "${PUBLISHED}" != 1 && -e "${PREVIOUS_PROFILES}" && ! -e "${SCRIPT_DIR}/profiles" ]]; then mv "${PREVIOUS_PROFILES}" "${SCRIPT_DIR}/profiles"; fi; rm -rf "${BUILD_DIR}" "${STAGING_ROOT}"; }
trap cleanup EXIT; mkdir -p "${PROFILE_DIR}"; source "${PART_DIR}/activate-rocm.sh"
hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 "${SCRIPT_DIR}/softmax_hip.hip" -o "${BUILD_DIR}/softmax_hip"
profile() { local label="$1"; shift; rocprofv3 --kernel-trace --output-directory "${PROFILE_DIR}" --output-file "${label}" --output-format csv -- "$@"; }
profile "hip-baseline-3kernel" "${BUILD_DIR}/softmax_hip" --version baseline --rows "${ROWS}" --cols "${COLS}" --block "${HIP_BLOCK}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "hip-fused-block-lds" "${BUILD_DIR}/softmax_hip" --version fused --rows "${ROWS}" --cols "${COLS}" --block "${HIP_BLOCK}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "triton-t0-compact" python "${SCRIPT_DIR}/softmax_triton.py" --version t0 --rows "${ROWS}" --cols "${COLS}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "triton-t1-wide" python "${SCRIPT_DIR}/softmax_triton.py" --version t1 --rows "${ROWS}" --cols "${COLS}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
printf 'source_commit=%s\ngpu_arch=%s\nrows=%s\ncols=%s\nhip_block=%s\nseed=%s\nprofile_warmup=%s\nprofile_repeat=%s\n' "${SOURCE_COMMIT}" "${GPU_ARCH}" "${ROWS}" "${COLS}" "${HIP_BLOCK}" "${SEED}" "${PROFILE_WARMUP}" "${PROFILE_REPEAT}" > "${PROFILE_DIR}/profile_config.env"
if [[ -e "${SCRIPT_DIR}/profiles" ]]; then mv "${SCRIPT_DIR}/profiles" "${PREVIOUS_PROFILES}"; fi
mv "${PROFILE_DIR}" "${SCRIPT_DIR}/profiles"
PUBLISHED=1
