#!/usr/bin/env bash
set -euo pipefail

SOURCE_COMMIT="${SOURCE_COMMIT:-}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]]; then echo "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA" >&2; exit 2; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"; M="${M:-512}"; N="${N:-512}"; K="${K:-512}"; SEED="${SEED:-20260719}"
PROFILE_WARMUP="${PROFILE_WARMUP:-0}"; PROFILE_REPEAT="${PROFILE_REPEAT:-5}"; PROFILE_DIR="${SCRIPT_DIR}/profiles"; BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch10-profile.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT; mkdir -p "${PROFILE_DIR}"; source "${PART_DIR}/activate-rocm.sh"
hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 "${SCRIPT_DIR}/matmul_hip.hip" -o "${BUILD_DIR}/matmul_hip"
profile() { local label="$1"; shift; rocprofv3 --kernel-trace --output-directory "${PROFILE_DIR}" --output-file "${label}" --output-format csv -- "$@"; }
profile "hip-naive" "${BUILD_DIR}/matmul_hip" --version naive --m "${M}" --n "${N}" --k "${K}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "hip-tiled" "${BUILD_DIR}/matmul_hip" --version tiled --m "${M}" --n "${N}" --k "${K}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "triton-baseline" python "${SCRIPT_DIR}/matmul_triton.py" --version baseline --m "${M}" --n "${N}" --k "${K}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
profile "triton-grouped" python "${SCRIPT_DIR}/matmul_triton.py" --version grouped --m "${M}" --n "${N}" --k "${K}" --warmup "${PROFILE_WARMUP}" --repeat "${PROFILE_REPEAT}" --seed "${SEED}"
printf 'source_commit=%s\nm=%s\nn=%s\nk=%s\nseed=%s\n' "${SOURCE_COMMIT}" "${M}" "${N}" "${K}" "${SEED}" > "${PROFILE_DIR}/profile_config.env"
