#!/usr/bin/env bash
set -euo pipefail
NOTEBOOK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PART="${1:?missing part name}"
case "$PART" in
    part0-intro|part1-profiling|part2-kernels) ;;
    *) echo "Unknown notebook part: $PART" >&2; exit 2 ;;
esac
source "${NOTEBOOK_ROOT}/${PART}/activate-rocm.sh" >/dev/null
exec "${NOTEBOOK_ROOT}/${PART}/.venv/bin/python" -m ipykernel_launcher -f "${2:?missing connection file}"
