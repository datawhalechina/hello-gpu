#!/usr/bin/env bash
set -euo pipefail
NOTEBOOK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8895}"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT > 1024 && PORT < 65536 )) || { echo "Invalid port" >&2; exit 2; }
source "${NOTEBOOK_ROOT}/part0-intro/activate-rocm.sh" >/dev/null
PYTHON="${NOTEBOOK_ROOT}/part0-intro/.venv/bin/python"
"$PYTHON" "${NOTEBOOK_ROOT}/tools/register_kernels.py"
mkdir -p "${NOTEBOOK_ROOT}/.artifacts/jupyter/checkpoints"
exec "$PYTHON" -m jupyterlab --no-browser --ip=127.0.0.1 --port="$PORT" \
    --ServerApp.port_retries=0 --ServerApp.root_dir="$NOTEBOOK_ROOT" \
    --FileCheckpoints.checkpoint_dir="${NOTEBOOK_ROOT}/.artifacts/jupyter/checkpoints"
