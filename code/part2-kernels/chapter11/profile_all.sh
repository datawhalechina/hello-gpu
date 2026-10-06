#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"; M="${M:-512}"; N="${N:-512}"; K="${K:-512}"; SEED="${SEED:-20260920}"
HIP_TILE="${HIP_TILE:-16}"; TRITON_BLOCK_M="${TRITON_BLOCK_M:-32}"; TRITON_BLOCK_N="${TRITON_BLOCK_N:-32}"; TRITON_GROUP_M="${TRITON_GROUP_M:-8}"
PROFILE_WARMUP="${PROFILE_WARMUP:-0}"; PROFILE_REPEAT="${PROFILE_REPEAT:-5}"; BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch11-profile.XXXXXX")"
STAGING_ROOT="$(mktemp -d "${SCRIPT_DIR}/.profiles-staging.XXXXXX")"; PROFILE_DIR="${STAGING_ROOT}/profiles"; PREVIOUS_PROFILES="${STAGING_ROOT}/previous-profiles"; PUBLISHED=0
cleanup() { if [[ "${PUBLISHED}" != 1 && -e "${PREVIOUS_PROFILES}" && ! -e "${SCRIPT_DIR}/profiles" ]]; then mv "${PREVIOUS_PROFILES}" "${SCRIPT_DIR}/profiles"; fi; rm -rf "${BUILD_DIR}" "${STAGING_ROOT}"; }
trap cleanup EXIT; mkdir -p "${PROFILE_DIR}"; source "${PART_DIR}/activate-rocm.sh"
hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 "${SCRIPT_DIR}/matmul_hip.hip" -o "${BUILD_DIR}/matmul_hip"
profile() { local label="$1"; shift; rocprofv3 --kernel-trace --output-directory "${PROFILE_DIR}" --output-file "${label}" --output-format csv -- "$@"; }
profile "hip-naive" "${BUILD_DIR}/matmul_hip" --version naive --tile "${HIP_TILE}" --m "${M}" --n "${N}" --k "${K}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "hip-tiled" "${BUILD_DIR}/matmul_hip" --version tiled --tile "${HIP_TILE}" --m "${M}" --n "${N}" --k "${K}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "triton-baseline" python "${SCRIPT_DIR}/matmul_triton.py" --version baseline --block-m "${TRITON_BLOCK_M}" --block-n "${TRITON_BLOCK_N}" --block-k 32 --num-warps 4 --group-m 1 --m "${M}" --n "${N}" --k "${K}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "triton-grouped" python "${SCRIPT_DIR}/matmul_triton.py" --version grouped --block-m "${TRITON_BLOCK_M}" --block-n "${TRITON_BLOCK_N}" --block-k 32 --num-warps 4 --group-m "${TRITON_GROUP_M}" --m "${M}" --n "${N}" --k "${K}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
printf 'gpu_arch=%s\nm=%s\nn=%s\nk=%s\nseed=%s\nhip_tile=%s\ntriton_block_m=%s\ntriton_block_n=%s\ntriton_block_k=32\ntriton_num_warps=4\ntriton_group_m=%s\ninput=dyadic-modular-v1\nreference=cpu-fp64-to-fp32\ninput_precision=ieee\natol=0.0001\nrtol=0.0001\nprofile_warmup=%s\nprofile_repeat=%s\n' "${GPU_ARCH}" "${M}" "${N}" "${K}" "${SEED}" "${HIP_TILE}" "${TRITON_BLOCK_M}" "${TRITON_BLOCK_N}" "${TRITON_GROUP_M}" "${PROFILE_WARMUP}" "${PROFILE_REPEAT}" > "${PROFILE_DIR}/profile_config.env"
if [[ -e "${SCRIPT_DIR}/profiles" ]]; then mv "${SCRIPT_DIR}/profiles" "${PREVIOUS_PROFILES}"; fi
mv "${PROFILE_DIR}" "${SCRIPT_DIR}/profiles"
PUBLISHED=1
