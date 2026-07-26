#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PART_DIR}/../.." && pwd)"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git -C "${REPO_ROOT}" rev-parse HEAD)}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9A-Fa-f]{40}$ ]]; then
    echo "SOURCE_COMMIT must be exactly 40 hexadecimal characters" >&2
    exit 2
fi

GPU_ARCH="${GPU_ARCH:-gfx1201}"
WARMUP="${WARMUP:-10}"
REPEAT="${REPEAT:-50}"
SEED="${SEED:-20260726}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
BRANCH_SIZE="${BRANCH_SIZE:-16777216}"
GLOBAL_SIZE="${GLOBAL_SIZE:-16777216}"
LDS_SIZE="${LDS_SIZE:-16777216}"
MATRIX_BATCHES="${MATRIX_BATCHES:-4096}"

if [[ "${RUN_EDGE_CASES}" != "0" && "${RUN_EDGE_CASES}" != "1" ]]; then
    echo "RUN_EDGE_CASES must be 0 or 1" >&2
    exit 2
fi

hash_file() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
    else python3 -c 'import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$1"; fi
}
hash_stdin() { python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'; }
if ! git -C "${REPO_ROOT}" rev-parse --verify "${SOURCE_COMMIT}^{commit}" >/dev/null 2>&1; then
    echo "SOURCE_COMMIT must name an existing Git commit" >&2
    exit 2
fi
for source in branch_divergence.hip global_memory_access.hip lds_bank_conflict.hip rdna4_wmma.hip; do
    if [[ "$(hash_file "${SCRIPT_DIR}/${source}")" != "$(git -C "${REPO_ROOT}" show "${SOURCE_COMMIT}:code/part0-intro/chapter2/${source}" | hash_stdin)" ]]; then
        echo "${source} does not match SOURCE_COMMIT" >&2
        exit 2
    fi
done

if [[ ! -f "${PART_DIR}/activate-rocm.sh" ]]; then
    echo "missing ${PART_DIR}/activate-rocm.sh" >&2
    exit 1
fi
# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch2.XXXXXX")"
cleanup() {
    rm -rf "${BUILD_DIR}"
}
trap cleanup EXIT

compile() {
    local source_name="$1"
    local binary_name="$2"
    local binary="${BUILD_DIR}/${binary_name}"
    hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
        -DCHAPTER2_SOURCE_COMMIT="\"${SOURCE_COMMIT}\"" \
        "${SCRIPT_DIR}/${source_name}" -o "${binary}"
    printf 'BINARY source_commit=%s source=%s binary=%s\n' \
        "${SOURCE_COMMIT}" "${source_name}" "${binary_name}" >&2
}

binary_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        python3 -c 'import hashlib, pathlib, sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$1"
    fi
}

compile branch_divergence.hip branch_divergence
compile global_memory_access.hip global_memory_access
compile lds_bank_conflict.hip lds_bank_conflict
compile rdna4_wmma.hip rdna4_wmma
for binary in branch_divergence global_memory_access lds_bank_conflict rdna4_wmma; do
    printf 'BINARY source_commit=%s gpu_target=%s binary=%s sha256=%s\n' \
        "${SOURCE_COMMIT}" "${GPU_ARCH}" "${binary}" \
        "$(binary_sha256 "${BUILD_DIR}/${binary}")" >&2
done

if [[ "${RUN_EDGE_CASES}" == "1" ]]; then
    "${BUILD_DIR}/branch_divergence" --implementation all --size 257 \
        --warmup 0 --repeat 1 --seed "${SEED}" >/dev/null
    "${BUILD_DIR}/global_memory_access" --implementation all --size 256 \
        --warmup 0 --repeat 1 --seed "${SEED}" >/dev/null
    "${BUILD_DIR}/lds_bank_conflict" --implementation all --size 257 \
        --warmup 0 --repeat 1 --seed "${SEED}" >/dev/null
    "${BUILD_DIR}/rdna4_wmma" --implementation all --size 1 \
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
run_formal global_memory_access stride-1 "${GLOBAL_SIZE}"
run_formal global_memory_access stride-17 "${GLOBAL_SIZE}"
run_formal global_memory_access stride-257 "${GLOBAL_SIZE}"
run_formal lds_bank_conflict stride-1 "${LDS_SIZE}"
run_formal lds_bank_conflict stride-32 "${LDS_SIZE}"
run_formal lds_bank_conflict stride-33 "${LDS_SIZE}"
run_formal rdna4_wmma valu "${MATRIX_BATCHES}"
run_formal rdna4_wmma wmma "${MATRIX_BATCHES}"
