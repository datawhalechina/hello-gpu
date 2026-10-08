#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-mapping.XXXXXX")"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
LOG_DIR="${SCRIPT_DIR}/logs/mapping-${RUN_ID}"
trap 'rm -rf "${BUILD_DIR}"' EXIT

# Uses this part's existing ROCm environment; no dependency installation here.
source "${PART_DIR}/activate-rocm.sh"
mkdir -p "${LOG_DIR}"
hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
    "${SCRIPT_DIR}/reduction_mapping.hip" -o "${BUILD_DIR}/reduction_mapping"
"${BUILD_DIR}/reduction_mapping" --samples "${LOG_DIR}/samples.csv" "$@" \
    2>&1 | tee "${LOG_DIR}/run.txt"
printf 'Run log: %s\n' "${LOG_DIR}/run.txt"
