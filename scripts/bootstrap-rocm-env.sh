#!/usr/bin/env bash
# 为某一篇（part）建立独立的 ROCm uv 开发环境。
#
# 设计：每开一篇就跑一次本脚本，得到 code/partN-*/.venv，篇与篇之间环境隔离。
#   - 实验机只跑实验，不在实验机上 commit
#   - 不带 --part 默认 part0-intro
#
# 用法：
#   bash scripts/bootstrap-rocm-env.sh                              # part0-intro
#   bash scripts/bootstrap-rocm-env.sh --part part1-profiling
#   bash scripts/bootstrap-rocm-env.sh --part part0-intro --region global
#   bash scripts/bootstrap-rocm-env.sh --part part1-profiling --interactive

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROCM_UV_ENV="${SCRIPT_DIR}/rocm-uv-env.sh"

# ── 当前 baseline（版本组合见 configure-rocm-env.py） ──────────────────────────────
ROCM_VERSION="10.0.0"
GPU_ARCH="gfx1201"
INSTALL_MODE_FLAG="--full"   # 或 --minimal
DEFAULT_REGION="cn"
DEFAULT_PART="part0-intro"
# ────────────────────────────────────────────────────────────

PART="$DEFAULT_PART"
REGION="$DEFAULT_REGION"
INTERACTIVE=false
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --part)
            PART="${2:-}"
            shift 2
            ;;
        --region)
            REGION="${2:-}"
            shift 2
            ;;
        --interactive)
            INTERACTIVE=true
            shift
            ;;
        --minimal)
            INSTALL_MODE_FLAG="--minimal"
            shift
            ;;
        --full)
            INSTALL_MODE_FLAG="--full"
            shift
            ;;
        --)
            shift
            EXTRA_ARGS=("$@")
            break
            ;;
        *)
            EXTRA_ARGS+=("$1")
            shift
            ;;
    esac
done

if [[ -z "$PART" ]]; then
    echo "[bootstrap] --part 不能为空" >&2
    exit 1
fi

PART_DIR="${REPO_ROOT}/code/${PART}"

if [[ ! -d "${REPO_ROOT}/code" ]]; then
    echo "[bootstrap] code/ 目录不存在：${REPO_ROOT}/code" >&2
    exit 1
fi

mkdir -p "$PART_DIR"

if [[ ! -f "$ROCM_UV_ENV" ]]; then
    echo "[bootstrap] 找不到 ${ROCM_UV_ENV}" >&2
    exit 1
fi

CMD=(
    bash "$ROCM_UV_ENV"
    --version "$ROCM_VERSION"
    --arch "$GPU_ARCH"
    "$INSTALL_MODE_FLAG"
    --project-dir "$PART_DIR"
    --region "$REGION"
)

if [[ "$INTERACTIVE" != "true" ]]; then
    CMD+=(--non-interactive)
fi

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
    CMD+=("${EXTRA_ARGS[@]}")
fi

echo "[bootstrap] 目标 part:    ${PART}"
echo "[bootstrap] venv 路径:    ${PART_DIR}/.venv"
echo "[bootstrap] 执行命令："
printf '  %q ' "${CMD[@]}"; echo
echo

exec "${CMD[@]}"
