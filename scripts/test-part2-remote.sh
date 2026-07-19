#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/part2-remote.sh"

help_output="$(bash "${TARGET}" --help)"
grep -Fq "status|sync|run|fetch" <<<"${help_output}"

if bash "${TARGET}" run ../chapter7 true 2>/dev/null; then
    echo "unsafe chapter path unexpectedly accepted" >&2
    exit 1
fi

if bash "${TARGET}" unknown 2>/dev/null; then
    echo "unknown command unexpectedly accepted" >&2
    exit 1
fi

test_tmp="$(mktemp -d "${TMPDIR:-/tmp}/part2-remote-test.XXXXXX")"
local_evidence_dir="$(cd "${SCRIPT_DIR}/.." && pwd)/code/part2-kernels/chapter7/evidence"
local_evidence_created=0
if [[ ! -e "${local_evidence_dir}" ]]; then
    local_evidence_created=1
fi
cleanup() {
    rm -rf "${test_tmp}"
    if ((local_evidence_created)); then
        rmdir "${local_evidence_dir}" 2>/dev/null || true
    fi
}
trap cleanup EXIT

fake_bin="${test_tmp}/bin"
fake_ssh_command="${test_tmp}/ssh-command"
fake_ssh_called="${test_tmp}/ssh-called"
fake_rsync_called="${test_tmp}/rsync-called"
fake_rsync_args="${test_tmp}/rsync-args"
fake_remote_rsync_called="${test_tmp}/remote-rsync-called"
pwned_marker="${test_tmp}/pwned"
remote_root="${test_tmp}/remote root' ;\$(touch \"${pwned_marker}\");#"
outside_root="${test_tmp}/outside"
mkdir -p "${fake_bin}" "${remote_root}/code/part2-kernels/chapter7"

cat > "${fake_bin}/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ "$1" == "-o" ]]
[[ "$2" == "BatchMode=yes" ]]
shift 3
[[ "$#" == "1" ]]
: >> "${PART2_FAKE_SSH_CALLED}"
printf '%s' "$1" > "${PART2_FAKE_SSH_COMMAND}"
bash -c "$1"
EOF
chmod +x "${fake_bin}/ssh"

cat > "${fake_bin}/realpath" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
[[ "${2:-}" == "--" ]]
path="${3:-}"
if [[ "${mode}" == "-e" && ! -e "${path}" ]]; then
    exit 1
fi
python3 - "${path}" <<'PY'
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
EOF
chmod +x "${fake_bin}/realpath"

cat > "${fake_bin}/rsync" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--server" ]]; then
    : > "${PART2_FAKE_REMOTE_RSYNC_CALLED}"
    exit 0
fi

: > "${PART2_FAKE_RSYNC_ARGS}"
remote_command=""
for argument in "$@"; do
    printf '<%s>\n' "${argument}" >> "${PART2_FAKE_RSYNC_ARGS}"
    case "${argument}" in
        --protect-args|--delete|--delete-*)
            echo "forbidden rsync option: ${argument}" >&2
            exit 1
            ;;
        --rsync-path=*)
            remote_command="${argument#--rsync-path=}"
            ;;
    esac
done

[[ -n "${remote_command}" ]]
[[ "$*" == *"${PART2_REMOTE_HOST}:."* ]]
bash -c "${remote_command} --server"
: > "${PART2_FAKE_RSYNC_CALLED}"
EOF
chmod +x "${fake_bin}/rsync"

PART2_REMOTE_ROOT="${remote_root}" \
PART2_REMOTE_HOST="fake-host" \
PART2_FAKE_RSYNC_CALLED="${fake_rsync_called}" \
PART2_FAKE_RSYNC_ARGS="${fake_rsync_args}" \
PART2_FAKE_REMOTE_RSYNC_CALLED="${fake_remote_rsync_called}" \
PART2_FAKE_SSH_COMMAND="${fake_ssh_command}" \
PART2_FAKE_SSH_CALLED="${fake_ssh_called}" \
PATH="${fake_bin}:${PATH}" \
    bash "${TARGET}" sync
[[ ! -e "${fake_ssh_called}" ]]
[[ -e "${fake_remote_rsync_called}" ]]
grep -Fxq '<fake-host:.>' "${fake_rsync_args}"
grep -Fq '<--rsync-path=' "${fake_rsync_args}"
[[ ! -e "${pwned_marker}" ]]
rm -f "${fake_rsync_called}"
rm -f "${fake_remote_rsync_called}"

mkdir -p "${remote_root}/code/part2-kernels/chapter7/evidence"
PART2_REMOTE_ROOT="${remote_root}" \
PART2_REMOTE_HOST="fake-host" \
PART2_FAKE_RSYNC_CALLED="${fake_rsync_called}" \
PART2_FAKE_RSYNC_ARGS="${fake_rsync_args}" \
PART2_FAKE_REMOTE_RSYNC_CALLED="${fake_remote_rsync_called}" \
PART2_FAKE_SSH_COMMAND="${fake_ssh_command}" \
PART2_FAKE_SSH_CALLED="${fake_ssh_called}" \
PATH="${fake_bin}:${PATH}" \
    bash "${TARGET}" fetch chapter7
[[ ! -e "${fake_ssh_called}" ]]
[[ -e "${fake_remote_rsync_called}" ]]
grep -Fxq '<fake-host:.>' "${fake_rsync_args}"
[[ ! -e "${pwned_marker}" ]]
rm -f "${fake_rsync_called}"
rm -f "${fake_remote_rsync_called}"

actual_output="${test_tmp}/actual"
expected_output="${test_tmp}/expected"
printf '<%s>\n' \
    '' \
    'space value' \
    'semi; printf injected' \
    'dollar$(printf injected)' \
    "quote' value" \
    '*' > "${expected_output}"

PART2_REMOTE_ROOT="${remote_root}" \
PART2_FAKE_SSH_COMMAND="${fake_ssh_command}" \
PART2_FAKE_SSH_CALLED="${fake_ssh_called}" \
PATH="${fake_bin}:${PATH}" \
    bash "${TARGET}" run chapter7 printf '<%s>\n' \
        '' \
        'space value' \
        'semi; printf injected' \
        'dollar$(printf injected)' \
        "quote' value" \
        '*' > "${actual_output}"

cmp -s "${expected_output}" "${actual_output}"
if ! grep -Fq "&& exec -- 'printf'" "${fake_ssh_command}"; then
    echo "run command is missing the exec -- boundary" >&2
    exit 1
fi
grep -Fq "'semi; printf injected'" "${fake_ssh_command}"
grep -Fq "'dollar\$(printf injected)'" "${fake_ssh_command}"

mkdir -p "${outside_root}"
rm -rf "${remote_root}/code/part2-kernels/chapter7"
ln -s "${outside_root}" "${remote_root}/code/part2-kernels/chapter7"

escaped_run_output="${test_tmp}/escaped-run"
if PART2_REMOTE_ROOT="${remote_root}" \
    PART2_FAKE_SSH_COMMAND="${fake_ssh_command}" \
    PART2_FAKE_SSH_CALLED="${fake_ssh_called}" \
    PATH="${fake_bin}:${PATH}" \
    bash "${TARGET}" run chapter7 true > "${escaped_run_output}" 2>&1; then
    echo "escaped run path unexpectedly accepted" >&2
    exit 1
fi
grep -Fq "remote target escapes remote root" "${escaped_run_output}"

rm -rf "${remote_root}/code"
ln -s "${outside_root}" "${remote_root}/code"

escaped_sync_output="${test_tmp}/escaped-sync"
if PART2_REMOTE_ROOT="${remote_root}" \
    PART2_REMOTE_HOST="fake-host" \
    PART2_FAKE_RSYNC_CALLED="${fake_rsync_called}" \
    PART2_FAKE_RSYNC_ARGS="${fake_rsync_args}" \
    PART2_FAKE_REMOTE_RSYNC_CALLED="${fake_remote_rsync_called}" \
    PART2_FAKE_SSH_COMMAND="${fake_ssh_command}" \
    PART2_FAKE_SSH_CALLED="${fake_ssh_called}" \
    PATH="${fake_bin}:${PATH}" \
    bash "${TARGET}" sync > "${escaped_sync_output}" 2>&1; then
    echo "escaped sync path unexpectedly accepted" >&2
    exit 1
fi
grep -Fq "remote target escapes remote root" "${escaped_sync_output}"
[[ ! -e "${outside_root}/part2-kernels" ]]
[[ ! -e "${fake_rsync_called}" ]]
[[ ! -e "${fake_remote_rsync_called}" ]]

escaped_fetch_output="${test_tmp}/escaped-fetch"
if PART2_REMOTE_ROOT="${remote_root}" \
    PART2_REMOTE_HOST="fake-host" \
    PART2_FAKE_RSYNC_CALLED="${fake_rsync_called}" \
    PART2_FAKE_RSYNC_ARGS="${fake_rsync_args}" \
    PART2_FAKE_REMOTE_RSYNC_CALLED="${fake_remote_rsync_called}" \
    PART2_FAKE_SSH_COMMAND="${fake_ssh_command}" \
    PART2_FAKE_SSH_CALLED="${fake_ssh_called}" \
    PATH="${fake_bin}:${PATH}" \
    bash "${TARGET}" fetch chapter7 > "${escaped_fetch_output}" 2>&1; then
    echo "escaped fetch path unexpectedly accepted" >&2
    exit 1
fi
grep -Fq "remote target escapes remote root" "${escaped_fetch_output}"
[[ ! -e "${fake_rsync_called}" ]]
[[ ! -e "${fake_remote_rsync_called}" ]]

echo "part2 remote wrapper contract: PASS"
