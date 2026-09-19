#!/usr/bin/env bash
set -euo pipefail

redact_identifiers() {
    sed -E \
        -e 's/(Uuid:[[:space:]]+).*/\1[redacted]/' \
        -e 's/(ASIC_SERIAL:[[:space:]]+).*/\1[redacted]/' \
        -e 's/(PRODUCT_SERIAL:[[:space:]]+).*/\1[redacted]/'
}

print_command() {
    local label="$1"
    shift
    echo "[${label}]"
    if "$@" 2>&1 | redact_identifiers; then
        :
    else
        echo "unavailable (exit=$?)"
    fi
}

echo "[timestamp]"
date -Iseconds

print_command hostname hostname

echo "[os-release]"
if [[ -r /etc/os-release ]]; then
    cat /etc/os-release
else
    echo "unavailable"
fi

print_command uname uname -a

echo "[virtualization]"
if command -v systemd-detect-virt >/dev/null 2>&1; then
    systemd-detect-virt 2>&1 || true
else
    echo "unavailable"
fi

echo "[gpu-device-nodes]"
shopt -s nullglob
gpu_paths=(/dev/kfd /sys/class/kfd/kfd /dev/dri/card* /dev/dri/renderD*)
if ((${#gpu_paths[@]} == 0)); then
    echo "no GPU device nodes found"
fi
for path in "${gpu_paths[@]}"; do
    if [[ -e "${path}" ]]; then
        ls -ld "${path}"
    else
        echo "missing ${path}"
    fi
done

print_command rocminfo rocminfo
print_command amd-smi amd-smi static --asic --board --driver --vram
print_command rocm-smi rocm-smi --showproductname --showdriverversion --showmeminfo vram
print_command hipcc hipcc --version
print_command rocprofv3 rocprofv3 --version
print_command python python --version
print_command uv uv --version

echo "[python-packages]"
python - <<'PY'
from __future__ import annotations

import importlib

for name in ("torch", "triton", "numpy"):
    try:
        module = importlib.import_module(name)
    except Exception as error:  # environment evidence should keep going
        print(f"{name}=unavailable ({type(error).__name__}: {error})")
        continue
    print(f"{name}={getattr(module, '__version__', 'unknown')}")

try:
    import torch

    print(f"torch.version.hip={torch.version.hip}")
    print(f"torch.cuda.is_available={torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"torch.cuda.device_name={torch.cuda.get_device_name(0)}")
except Exception as error:
    print(f"torch-runtime=unavailable ({type(error).__name__}: {error})")
PY
