#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -gt 1 ]]; then
    echo "Usage: $0 [PROFILE_DIR]" >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PART_DIR}/../.." && pwd)"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git -C "${REPO_ROOT}" rev-parse HEAD)}"
if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9A-Fa-f]{40}$ ]] || ! git -C "${REPO_ROOT}" rev-parse --verify "${SOURCE_COMMIT}^{commit}" >/dev/null 2>&1; then
    echo "SOURCE_COMMIT must name an existing 40-character Git commit" >&2
    exit 2
fi

GPU_ARCH="${GPU_ARCH:-gfx1201}"
WARMUP="${WARMUP:-10}"
REPEAT="${REPEAT:-50}"
SEED="${SEED:-20260726}"
BRANCH_SIZE="${BRANCH_SIZE:-16777216}"
GLOBAL_SIZE="${GLOBAL_SIZE:-16777216}"
LDS_SIZE="${LDS_SIZE:-16777216}"
MATRIX_BATCHES="${MATRIX_BATCHES:-4096}"
if [[ "$#" -eq 1 ]]; then
    PROFILE_DIR="$1"
else
    PROFILE_DIR="${PROFILE_DIR:-${SCRIPT_DIR}/profiles}"
fi
mkdir -p "$(dirname "${PROFILE_DIR}")"
PROFILE_PARENT="$(cd "$(dirname "${PROFILE_DIR}")" && pwd)"
PROFILE_NAME="$(basename "${PROFILE_DIR}")"
PROFILE_DIR="${PROFILE_PARENT}/${PROFILE_NAME}"
VERSION_ROOT="${PROFILE_PARENT}/.${PROFILE_NAME}.versions"
REPLAY_OUTPUT_ROOT="${PROFILE_PARENT}/.${PROFILE_NAME}.replay-output"

if { [[ -e "${PROFILE_DIR}" ]] || [[ -L "${PROFILE_DIR}" ]]; } && [[ ! -L "${PROFILE_DIR}" ]]; then
    echo "PROFILE_DIR exists and is not a symlink: ${PROFILE_DIR}" >&2
    exit 2
fi

hash_file() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
    else python3 -c 'import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())' "$1"; fi
}
hash_stdin() {
    python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
}
verify_source() {
    local source="$1" committed current
    current="$(hash_file "${SCRIPT_DIR}/${source}")"
    committed="$(git -C "${REPO_ROOT}" show "${SOURCE_COMMIT}:code/part0-intro/chapter2/${source}" | hash_stdin)"
    if [[ "${current}" != "${committed}" ]]; then
        echo "${source} does not match SOURCE_COMMIT" >&2
        exit 2
    fi
    printf '%s' "${current}"
}

BRANCH_SOURCE_SHA256="$(verify_source branch_divergence.hip)"
GLOBAL_SOURCE_SHA256="$(verify_source global_memory_access.hip)"
LDS_SOURCE_SHA256="$(verify_source lds_bank_conflict.hip)"
MATRIX_SOURCE_SHA256="$(verify_source rdna4_wmma.hip)"

if [[ ! -f "${PART_DIR}/activate-rocm.sh" ]]; then
    echo "missing ${PART_DIR}/activate-rocm.sh" >&2
    exit 1
fi
# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"

LLVM_OBJDUMP="${LLVM_OBJDUMP:-llvm-objdump}"
if ! command -v "${LLVM_OBJDUMP}" >/dev/null 2>&1 && [[ -x /opt/rocm/llvm/bin/llvm-objdump ]]; then
    LLVM_OBJDUMP=/opt/rocm/llvm/bin/llvm-objdump
fi
if ! command -v "${LLVM_OBJDUMP}" >/dev/null 2>&1; then
    echo "llvm-objdump is unavailable after ROCm activation: ${LLVM_OBJDUMP}" >&2
    exit 1
fi

if ! command -v rocminfo >/dev/null 2>&1; then
    echo "rocminfo is unavailable; cannot identify ${GPU_ARCH}" >&2
    exit 1
fi
if ! ROCMINFO_OUTPUT="$(rocminfo 2>&1)"; then
    echo "rocminfo failed while identifying ${GPU_ARCH}" >&2
    exit 1
fi
OBSERVED_HARDWARE="$(printf '%s\n' "${ROCMINFO_OUTPUT}" | awk -F: -v arch="${GPU_ARCH}" '
    /^[[:space:]]*Name[[:space:]]*:/ {
        value=$2; gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); matching=(value == arch); next
    }
    matching && /^[[:space:]]*Marketing Name[[:space:]]*:/ {
        value=$2; gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value; exit
    }
')"
if [[ -z "${OBSERVED_HARDWARE}" ]]; then
    echo "rocminfo did not report a Marketing Name for ${GPU_ARCH}" >&2
    exit 1
fi
HARDWARE_OVERRIDE="${HARDWARE:-}"
if [[ -n "${HARDWARE_OVERRIDE}" && "${HARDWARE_OVERRIDE}" != "${OBSERVED_HARDWARE}" ]]; then
    echo "HARDWARE override does not match rocminfo for ${GPU_ARCH}" >&2
    exit 1
fi
HARDWARE="${OBSERVED_HARDWARE}"
ROCM_VERSION="$(rocprofv3 --version 2>&1 | tr '\n' ' ')"

BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch2-profile.XXXXXX")"
mkdir -p "${VERSION_ROOT}"
VERSION_DIR="$(mktemp -d "${VERSION_ROOT}/${SOURCE_COMMIT}.XXXXXX")"
cleanup() {
    rm -rf "${BUILD_DIR}"
    if [[ -n "${VERSION_DIR:-}" && -d "${VERSION_DIR}" ]]; then rm -rf "${VERSION_DIR}"; fi
}
trap cleanup EXIT

BRANCH_BINARY_SHA256=""; GLOBAL_BINARY_SHA256=""; LDS_BINARY_SHA256=""; MATRIX_BINARY_SHA256=""
BRANCH_BINARY_TARGET=""; GLOBAL_BINARY_TARGET=""; LDS_BINARY_TARGET=""; MATRIX_BINARY_TARGET=""
BRANCH_COMPILE_ARGV=""; GLOBAL_COMPILE_ARGV=""; LDS_COMPILE_ARGV=""; MATRIX_COMPILE_ARGV=""
BRANCH_COMPILE_REPLAY_ARGV=""; GLOBAL_COMPILE_REPLAY_ARGV=""; LDS_COMPILE_REPLAY_ARGV=""; MATRIX_COMPILE_REPLAY_ARGV=""
read_binary_target() {
    local binary="$1" dump targets count
    if ! dump="$("${LLVM_OBJDUMP}" --offloading "${binary}" 2>&1)"; then
        echo "llvm-objdump failed for ${binary}: ${dump}" >&2
        exit 1
    fi
    targets="$(printf '%s\n' "${dump}" | sed -n -E \
        -e 's/.*hipv4-amdgcn-amd-amdhsa--(gfx[[:alnum:]_]+).*/\1/p' \
        -e 's/^[[:space:]]*arch[[:space:]]+(gfx[[:alnum:]_]+)[[:space:]]*$/\1/p' | sort -u)"
    count="$(printf '%s\n' "${targets}" | sed '/^$/d' | wc -l | tr -d ' ')"
    if [[ "${count}" != "1" || "${targets}" != "${GPU_ARCH}" ]]; then
        echo "${binary} has invalid offload target(s): ${targets:-missing}; expected exactly ${GPU_ARCH}" >&2
        exit 1
    fi
    printf '%s' "${targets}"
}
compile() {
    local source="$1" binary="$2" argv replay_argv target replay_binary
    local -a args=(hipcc "--offload-arch=${GPU_ARCH}" -O3 -std=c++17 "-DCHAPTER2_SOURCE_COMMIT=\"${SOURCE_COMMIT}\"" "${SCRIPT_DIR}/${source}" -o "${BUILD_DIR}/${binary}")
    "${args[@]}"
    printf -v argv '%q ' "${args[@]}"
    target="$(read_binary_target "${BUILD_DIR}/${binary}")"
    replay_binary="${PROFILE_PARENT}/.${PROFILE_NAME}.replay-${binary}"
    local -a replay_args=(hipcc "--offload-arch=${GPU_ARCH}" -O3 -std=c++17 "-DCHAPTER2_SOURCE_COMMIT=\"${SOURCE_COMMIT}\"" "${SCRIPT_DIR}/${source}" -o "${replay_binary}")
    printf -v replay_argv '%q ' "${replay_args[@]}"
    case "${binary}" in
        branch_divergence) BRANCH_COMPILE_ARGV="${argv% }"; BRANCH_COMPILE_REPLAY_ARGV="${replay_argv% }"; BRANCH_BINARY_SHA256="$(hash_file "${BUILD_DIR}/${binary}")"; BRANCH_BINARY_TARGET="${target}" ;;
        global_memory_access) GLOBAL_COMPILE_ARGV="${argv% }"; GLOBAL_COMPILE_REPLAY_ARGV="${replay_argv% }"; GLOBAL_BINARY_SHA256="$(hash_file "${BUILD_DIR}/${binary}")"; GLOBAL_BINARY_TARGET="${target}" ;;
        lds_bank_conflict) LDS_COMPILE_ARGV="${argv% }"; LDS_COMPILE_REPLAY_ARGV="${replay_argv% }"; LDS_BINARY_SHA256="$(hash_file "${BUILD_DIR}/${binary}")"; LDS_BINARY_TARGET="${target}" ;;
        rdna4_wmma) MATRIX_COMPILE_ARGV="${argv% }"; MATRIX_COMPILE_REPLAY_ARGV="${replay_argv% }"; MATRIX_BINARY_SHA256="$(hash_file "${BUILD_DIR}/${binary}")"; MATRIX_BINARY_TARGET="${target}" ;;
    esac
}
compile branch_divergence.hip branch_divergence
compile global_memory_access.hip global_memory_access
compile lds_bank_conflict.hip lds_bank_conflict
compile rdna4_wmma.hip rdna4_wmma

write_value() { printf '%s=%q\n' "$1" "$2"; }
CONFIG="${VERSION_DIR}/profile_config.env"
{
    write_value source_commit "${SOURCE_COMMIT}"
    write_value hardware "${HARDWARE}"
    write_value gpu_arch "${GPU_ARCH}"
    write_value gpu_target "${GPU_ARCH}"
    write_value observed_hardware "${OBSERVED_HARDWARE}"
    write_value profile_shapes "branch:N=${BRANCH_SIZE};global:N=${GLOBAL_SIZE};lds:N=${LDS_SIZE};matrix:batch=${MATRIX_BATCHES},M=16,N=16,K=16"
    write_value warmup 1; write_value repeat 1; write_value seed "${SEED}"
    write_value rocm_version "${ROCM_VERSION}"
    write_value source_branch_divergence_sha256 "${BRANCH_SOURCE_SHA256}"
    write_value source_global_memory_access_sha256 "${GLOBAL_SOURCE_SHA256}"
    write_value source_lds_bank_conflict_sha256 "${LDS_SOURCE_SHA256}"
    write_value source_rdna4_wmma_sha256 "${MATRIX_SOURCE_SHA256}"
    write_value binary_branch_divergence_sha256 "${BRANCH_BINARY_SHA256}"; write_value binary_branch_divergence_target "${BRANCH_BINARY_TARGET}"; write_value compile_branch_divergence_argv "${BRANCH_COMPILE_ARGV}"; write_value compile_branch_divergence_replay_argv "${BRANCH_COMPILE_REPLAY_ARGV}"
    write_value binary_global_memory_access_sha256 "${GLOBAL_BINARY_SHA256}"; write_value binary_global_memory_access_target "${GLOBAL_BINARY_TARGET}"; write_value compile_global_memory_access_argv "${GLOBAL_COMPILE_ARGV}"; write_value compile_global_memory_access_replay_argv "${GLOBAL_COMPILE_REPLAY_ARGV}"
    write_value binary_lds_bank_conflict_sha256 "${LDS_BINARY_SHA256}"; write_value binary_lds_bank_conflict_target "${LDS_BINARY_TARGET}"; write_value compile_lds_bank_conflict_argv "${LDS_COMPILE_ARGV}"; write_value compile_lds_bank_conflict_replay_argv "${LDS_COMPILE_REPLAY_ARGV}"
    write_value binary_rdna4_wmma_sha256 "${MATRIX_BINARY_SHA256}"; write_value binary_rdna4_wmma_target "${MATRIX_BINARY_TARGET}"; write_value compile_rdna4_wmma_argv "${MATRIX_COMPILE_ARGV}"; write_value compile_rdna4_wmma_replay_argv "${MATRIX_COMPILE_REPLAY_ARGV}"
} > "${CONFIG}"

profile_one() {
    local experiment="$1" implementation="$2" binary="$3" size="$4"
    local key output argv replay_argv variable binary_sha replay_binary
    key="${experiment}__${implementation}"
    output="${VERSION_DIR}/${key}"
    local -a args=(rocprofv3 --kernel-trace --output-format csv --output-directory "${output}" -- "${BUILD_DIR}/${binary}" --implementation "${implementation}" --size "${size}" --warmup 1 --repeat 1 --seed "${SEED}")
    mkdir -p "${output}"
    "${args[@]}"
    if ! find "${output}" -type f -name '*_kernel_trace.csv' -size +0c -print -quit | grep -q .; then
        echo "missing non-empty kernel trace for ${key}" >&2; exit 1
    fi
    printf -v argv '%q ' "${args[@]}"; argv="${argv% }"
    replay_binary="${PROFILE_PARENT}/.${PROFILE_NAME}.replay-${binary}"
    local -a replay=(rocprofv3 --kernel-trace --output-format csv --output-directory "${REPLAY_OUTPUT_ROOT}/${key}" -- "${replay_binary}" --implementation "${implementation}" --size "${size}" --warmup 1 --repeat 1 --seed "${SEED}")
    printf -v replay_argv '%q ' "${replay[@]}"; replay_argv="${replay_argv% }"
    variable="profile_${experiment//-/_}_${implementation//-/_}"
    case "${binary}" in
        branch_divergence) binary_sha="${BRANCH_BINARY_SHA256}" ;;
        global_memory_access) binary_sha="${GLOBAL_BINARY_SHA256}" ;;
        lds_bank_conflict) binary_sha="${LDS_BINARY_SHA256}" ;;
        rdna4_wmma) binary_sha="${MATRIX_BINARY_SHA256}" ;;
    esac
    { write_value "${variable}_argv" "${argv}"; write_value "${variable}_replay_argv" "${replay_argv}"; write_value "${variable}_binary_sha256" "${binary_sha}"; } >> "${CONFIG}"
}
profile_one branch-divergence wave-uniform branch_divergence "${BRANCH_SIZE}"
profile_one branch-divergence wave-divergent branch_divergence "${BRANCH_SIZE}"
profile_one global-memory stride-1 global_memory_access "${GLOBAL_SIZE}"
profile_one global-memory stride-17 global_memory_access "${GLOBAL_SIZE}"
profile_one global-memory stride-257 global_memory_access "${GLOBAL_SIZE}"
profile_one lds-banks stride-1 lds_bank_conflict "${LDS_SIZE}"
profile_one lds-banks stride-32 lds_bank_conflict "${LDS_SIZE}"
profile_one lds-banks stride-33 lds_bank_conflict "${LDS_SIZE}"
profile_one matrix-path valu rdna4_wmma "${MATRIX_BATCHES}"
profile_one matrix-path wmma rdna4_wmma "${MATRIX_BATCHES}"

python3 - "${PROFILE_PARENT}" "${PROFILE_NAME}" "${VERSION_DIR}" <<'PY'
import os
import secrets
import sys

parent, name, target = sys.argv[1:]
staged = f".{name}.pointer.{os.getpid()}.{secrets.token_hex(8)}"
os.symlink(target, os.path.join(parent, staged))
try:
    os.replace(os.path.join(parent, staged), os.path.join(parent, name))
except BaseException:
    os.unlink(os.path.join(parent, staged))
    raise
PY
VERSION_DIR=""
