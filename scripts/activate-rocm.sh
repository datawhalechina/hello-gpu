#!/usr/bin/env bash
# 本文件由安装脚本复制到各篇目录；使用该篇 .venv 中的 ROCm SDK。

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "请使用 'source $0' 而不是直接执行" >&2
    exit 1
fi

ROCM_PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROCM_VENV="${ROCM_PROJECT_DIR}/.venv"

if [[ ! -x "${ROCM_VENV}/bin/rocm-sdk" ]]; then
    echo "[activate-rocm] 请先在本篇目录下执行 'uv sync'：${ROCM_PROJECT_DIR}" >&2
    return 1
fi

source "${ROCM_VENV}/bin/activate"

if ! python -c 'import importlib.util, sys; sys.exit(importlib.util.find_spec("rocm_sdk_devel") is None)'; then
    unset ROCM_PATH HIP_PATH
    echo "Activated ROCm runtime: ${ROCM_VENV}"
    echo "  ROCm SDK: $(rocm-sdk version)"
    echo "  当前使用 minimal 模式；编译 HIP 程序需要用 --full 安装 devel。"
    return 0
fi

# 每次激活都刷新设备文件链接，uv sync 切换架构后也能使用新的设备包。
if ! rocm-sdk init --quiet; then
    echo "[activate-rocm] SDK 初始化失败，请检查 pyproject.toml 中 rocm 的 devel extra" >&2
    return 1
fi
ROCM_SDK_ROOT="$(rocm-sdk path --root)" || return 1

export ROCM_PROJECT_DIR ROCM_VENV
export ROCM_PATH="${ROCM_SDK_ROOT}"
export HIP_PATH="${ROCM_SDK_ROOT}"
export PATH="${ROCM_VENV}/bin:${ROCM_PATH}/bin:${PATH}"
export LD_LIBRARY_PATH="${ROCM_PATH}/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

echo "Activated ROCm uv environment:"
echo "  PROJECT:    ${ROCM_PROJECT_DIR}"
echo "  VENV:       ${ROCM_VENV}"
echo "  ROCM_PATH:  ${ROCM_PATH}"
echo "  Python:     $(command -v python)"
echo "  ROCm SDK:   $(rocm-sdk version)"
python --version
