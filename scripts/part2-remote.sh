#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REMOTE_HOST="${PART2_REMOTE_HOST:-hwj-frp-9070xt-2404}"
REMOTE_ROOT="${PART2_REMOTE_ROOT:-/home/hellogpu/hdb/hello-gpu-part2}"

usage() {
    echo "usage: $0 status|sync|run|fetch [chapter] [command ...]"
}

require_chapter() {
    local chapter="${1:-}"
    if [[ ! "${chapter}" =~ ^chapter(7|8|9|10|11|12)$ ]]; then
        echo "invalid chapter: ${chapter}" >&2
        exit 2
    fi
}

quote_for_remote_shell() {
    local value=$1
    value=${value//\'/\'\\\'\'}
    printf "'%s'" "${value}"
}

remote_path_guard() {
    local target="$1"
    printf 'remote_root=$(realpath -e -- %s) || exit 2; remote_target=$(realpath -m -- %s) || exit 2; case "$remote_target" in "$remote_root"/*) ;; *) echo "remote target escapes remote root" >&2; exit 2 ;; esac' \
        "$(quote_for_remote_shell "${REMOTE_ROOT}")" \
        "$(quote_for_remote_shell "${target}")"
}

command="${1:---help}"
case "${command}" in
    --help|-h)
        usage
        ;;
    status)
        remote_status_command="test -d $(quote_for_remote_shell "${REMOTE_ROOT}") && printf 'remote_root=present\\n' || printf 'remote_root=missing\\n'; command -v hipcc; command -v rocprofv3; command -v uv || true"
        ssh -o BatchMode=yes "${REMOTE_HOST}" "${remote_status_command}"
        ;;
    sync)
        remote_kernel_root="${REMOTE_ROOT}/code/part2-kernels"
        remote_sync_command="mkdir -p -- $(quote_for_remote_shell "${REMOTE_ROOT}"); $(remote_path_guard "${remote_kernel_root}"); mkdir -p -- \"\$remote_target\"; cd -- \"\$remote_target\" && exec rsync"
        rsync -az \
            --exclude '.venv/' --exclude '__pycache__/' --exclude 'logs/' \
            --exclude 'profiles/' --exclude 'results/' \
            "--rsync-path=${remote_sync_command}" \
            "${REPO_ROOT}/code/part2-kernels/" \
            "${REMOTE_HOST}:."
        ;;
    run)
        chapter="${2:-}"
        require_chapter "${chapter}"
        shift 2
        if (($# == 0)); then
            echo "run requires a command" >&2
            exit 2
        fi

        remote_chapter_dir="${REMOTE_ROOT}/code/part2-kernels/${chapter}"
        remote_run_command="$(remote_path_guard "${remote_chapter_dir}"); cd -- \"\$remote_target\" && exec --"
        for argument in "$@"; do
            remote_run_command+=" $(quote_for_remote_shell "${argument}")"
        done
        ssh -o BatchMode=yes "${REMOTE_HOST}" "${remote_run_command}"
        ;;
    fetch)
        chapter="${2:-}"
        require_chapter "${chapter}"
        remote_evidence_dir="${REMOTE_ROOT}/code/part2-kernels/${chapter}/evidence"
        remote_fetch_command="$(remote_path_guard "${remote_evidence_dir}"); cd -- \"\$remote_target\" && exec rsync"
        mkdir -p "${REPO_ROOT}/code/part2-kernels/${chapter}/evidence"
        rsync -az \
            "--rsync-path=${remote_fetch_command}" \
            "${REMOTE_HOST}:." \
            "${REPO_ROOT}/code/part2-kernels/${chapter}/evidence/"
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac
