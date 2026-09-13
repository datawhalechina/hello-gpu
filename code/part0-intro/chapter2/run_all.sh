#!/usr/bin/env bash
# Branch-divergence subset of the Part 0 hardware experiments (Chapter 2 上).
# Global-memory / LDS-banks / matrix-path live in ../chapter3/run_all.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
GPU_ARCH="${GPU_ARCH:-gfx1201}"
WARMUP="${WARMUP:-10}"
REPEAT="${REPEAT:-50}"
SEED="${SEED:-20260726}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
BRANCH_SIZE="${BRANCH_SIZE:-16777216}"

if [[ "${RUN_EDGE_CASES}" != "0" && "${RUN_EDGE_CASES}" != "1" ]]; then
    echo "RUN_EDGE_CASES must be 0 or 1" >&2; exit 2
fi

if [[ ! -f "${PART_DIR}/activate-rocm.sh" ]]; then
    echo "missing ${PART_DIR}/activate-rocm.sh" >&2; exit 1
fi
# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch2.XXXXXX")"
cleanup() { rm -rf "${BUILD_DIR}"; }
trap cleanup EXIT

compile() {
    local source_name="$1"
    local binary_name="$2"
    local binary="${BUILD_DIR}/${binary_name}"
    hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
        "${SCRIPT_DIR}/${source_name}" -o "${binary}"
    printf 'BINARY source=%s binary=%s\n' \
        "${source_name}" "${binary_name}" >&2
}
binary_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
    else python3 -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$1"; fi
}

compile branch_divergence.hip branch_divergence
for binary in branch_divergence; do
    printf 'BINARY gpu_target=%s binary=%s sha256=%s\n' \
        "${GPU_ARCH}" "${binary}" \
        "$(binary_sha256 "${BUILD_DIR}/${binary}")" >&2
done

if [[ "${RUN_EDGE_CASES}" == "1" ]]; then
    "${BUILD_DIR}/branch_divergence" --implementation all --size 257 \
        --warmup 0 --repeat 1 --seed "${SEED}" >/dev/null
fi

run_formal() {
    local binary="$1"
    local implementation="$2"
    local size="$3"
    "${BUILD_DIR}/${binary}" --implementation "${implementation}" --size "${size}" \
        --warmup "${WARMUP}" --repeat "${REPEAT}" --seed "${SEED}"
}
run_formal branch_divergence wave-uniform "${BRANCH_SIZE}"
run_formal branch_divergence wave-divergent "${BRANCH_SIZE}"
