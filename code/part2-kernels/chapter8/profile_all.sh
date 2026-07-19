#!/usr/bin/env bash
set -euo pipefail

SOURCE_COMMIT="${SOURCE_COMMIT:-}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA" >&2
    exit 2
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"; SIZE="${SIZE:-16777216}"; BLOCK="${BLOCK:-256}"
TRITON_BLOCK="${TRITON_BLOCK:-1024}"; TRITON_PROGRAMS="${TRITON_PROGRAMS:-256}"
SEED="${SEED:-20260719}"; PROFILE_WARMUP="${PROFILE_WARMUP:-0}"; PROFILE_REPEAT="${PROFILE_REPEAT:-5}"
PROFILE_DIR="${SCRIPT_DIR}/profiles"; BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch8-profile.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT
mkdir -p "${PROFILE_DIR}"
source "${PART_DIR}/activate-rocm.sh"
hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 "${SCRIPT_DIR}/reduction_hip.hip" -o "${BUILD_DIR}/reduction_hip"
profile() { local label="$1"; shift; rocprofv3 --kernel-trace --output-directory "${PROFILE_DIR}" --output-file "${label}" --output-format csv -- "$@"; }
for version in atomic lds two-stage; do profile "hip-${version}" "${BUILD_DIR}/reduction_hip" --version "${version}" --size "${SIZE}" --block "${BLOCK}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"; done
for version in t0 t1; do profile "triton-${version}" python "${SCRIPT_DIR}/reduction_triton.py" --version "${version}" --size "${SIZE}" --block "${TRITON_BLOCK}" --programs "${TRITON_PROGRAMS}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"; done
printf 'source_commit=%s\nsize=%s\nblock=%s\ntriton_block=%s\nseed=%s\n' "${SOURCE_COMMIT}" "${SIZE}" "${BLOCK}" "${TRITON_BLOCK}" "${SEED}" > "${PROFILE_DIR}/profile_config.env"
