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
WARMUP="${WARMUP:-10}"
REPEAT="${REPEAT:-50}"
SEED="${SEED:-20260920}"
PROCESS="${PROCESS:-1}"
SAMPLES_DIR="${SAMPLES_DIR:-}"
RUN_EDGE_CASES="${RUN_EDGE_CASES:-1}"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hello-gpu-ch12.XXXXXX")"
trap 'rm -rf "${BUILD_DIR}"' EXIT

# shellcheck source=/dev/null
source "${PART_DIR}/activate-rocm.sh"
hipcc --offload-arch="${GPU_ARCH}" -O3 -std=c++17 \
    "${SCRIPT_DIR}/attention_hip.hip" -o "${BUILD_DIR}/attention_hip"

if [[ "${RUN_EDGE_CASES}" == "1" ]]; then
    echo "[chapter12] boundary correctness (not the benchmark samples)"
    # Single key, key tails, dimension tails, and repeated running-max updates.
    for specification in "1 1 dyadic" "1 65 dyadic" "17 31 dyadic" \
                         "33 65 dyadic" "65 127 dyadic" \
                         "65 64 rising-max" "129 64 rising-max"; do
        read -r edge_seq edge_dim edge_input <<< "${specification}"
        common=(--seq "${edge_seq}" --dim "${edge_dim}" --input "${edge_input}"
                --warmup 0 --repeat 1 --seed "${SEED}" --process "${PROCESS}")
        "${BUILD_DIR}/attention_hip" --version all --block "${BLOCK}" "${common[@]}"
        python "${SCRIPT_DIR}/attention_triton.py" --version materialized \
            --num-warps "${NUM_WARPS}" "${common[@]}"
        for tile in 16 32 64; do
            python "${SCRIPT_DIR}/attention_triton.py" --version online \
                --block-k "${tile}" --num-warps "${NUM_WARPS}" "${common[@]}"
        done
    done
fi

if [[ -n "${SAMPLES_DIR}" ]]; then mkdir -p "${SAMPLES_DIR}"; fi
common=(--seq "${SEQ}" --dim "${DIM}" --input "${INPUT}" --warmup "${WARMUP}"
        --repeat "${REPEAT}" --seed "${SEED}" --process "${PROCESS}")
echo "[chapter12] full Attention forward benchmark"
for version in materialized online; do
    config_id="hip-${version}-b${BLOCK}"
    sample_args=()
    if [[ -n "${SAMPLES_DIR}" ]]; then
        sample_args=(--samples "${SAMPLES_DIR}/${SEQ}x${DIM}-${INPUT}-${config_id}-p${PROCESS}.csv")
    fi
    "${BUILD_DIR}/attention_hip" --version "${version}" --block "${BLOCK}" \
        --config-id "${config_id}" "${common[@]}" "${sample_args[@]}"
done
for version in materialized online; do
    tile=32
    if [[ "${version}" == "online" ]]; then tile="${BLOCK_K}"; fi
    config_id="triton-${version}-k${tile}"
    sample_args=()
    if [[ -n "${SAMPLES_DIR}" ]]; then
        sample_args=(--samples "${SAMPLES_DIR}/${SEQ}x${DIM}-${INPUT}-${config_id}-p${PROCESS}.csv")
    fi
    python "${SCRIPT_DIR}/attention_triton.py" --version "${version}" \
        --block-k "${tile}" --num-warps "${NUM_WARPS}" --config-id "${config_id}" \
        "${common[@]}" "${sample_args[@]}"
done
