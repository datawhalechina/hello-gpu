#!/usr/bin/env bash
set -euo pipefail

SOURCE_COMMIT="${SOURCE_COMMIT:-}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]]; then echo "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA" >&2; exit 2; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"; SEQ="${SEQ:-128}"; DIM="${DIM:-64}"; BLOCK="${BLOCK:-256}"; SEED="${SEED:-20260719}"
PROFILE_WARMUP="${PROFILE_WARMUP:-0}"; PROFILE_REPEAT="${PROFILE_REPEAT:-5}"; BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch11-profile.XXXXXX")"
STAGING_ROOT="$(mktemp -d "${SCRIPT_DIR}/.profiles-staging.XXXXXX")"; PROFILE_DIR="${STAGING_ROOT}/profiles"; PREVIOUS_PROFILES="${STAGING_ROOT}/previous-profiles"; PUBLISHED=0
cleanup() { if [[ "${PUBLISHED}" != 1 && -e "${PREVIOUS_PROFILES}" && ! -e "${SCRIPT_DIR}/profiles" ]]; then mv "${PREVIOUS_PROFILES}" "${SCRIPT_DIR}/profiles"; fi; rm -rf "${BUILD_DIR}" "${STAGING_ROOT}"; }
trap cleanup EXIT; mkdir -p "${PROFILE_DIR}"; source "${PART_DIR}/activate-rocm.sh"
hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 "${SCRIPT_DIR}/attention_hip.hip" -o "${BUILD_DIR}/attention_hip"
profile() { local label="$1"; shift; rocprofv3 --kernel-trace --output-directory "${PROFILE_DIR}" --output-file "${label}" --output-format csv -- "$@"; }
for version in materialized online; do profile "hip-${version}" "${BUILD_DIR}/attention_hip" --version "${version}" --seq "${SEQ}" --dim "${DIM}" --block "${BLOCK}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"; done
for version in t0 t1; do profile "triton-${version}" python "${SCRIPT_DIR}/attention_triton.py" --version "${version}" --seq "${SEQ}" --dim "${DIM}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"; done
printf 'source_commit=%s\ngpu_arch=%s\nseq=%s\ndim=%s\nblock=%s\nseed=%s\nprofile_warmup=%s\nprofile_repeat=%s\n' "${SOURCE_COMMIT}" "${GPU_ARCH}" "${SEQ}" "${DIM}" "${BLOCK}" "${SEED}" "${PROFILE_WARMUP}" "${PROFILE_REPEAT}" > "${PROFILE_DIR}/profile_config.env"
if [[ -e "${SCRIPT_DIR}/profiles" ]]; then mv "${SCRIPT_DIR}/profiles" "${PREVIOUS_PROFILES}"; fi
mv "${PROFILE_DIR}" "${SCRIPT_DIR}/profiles"
PUBLISHED=1
