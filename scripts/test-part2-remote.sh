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
cleanup() {
    rm -rf "${test_tmp}"
}
trap cleanup EXIT

fake_bin="${test_tmp}/bin"
fake_ssh_command="${test_tmp}/ssh-command"
fake_rsync_called="${test_tmp}/rsync-called"
remote_root="${test_tmp}/remote root"
outside_root="${test_tmp}/outside"
mkdir -p "${fake_bin}" "${remote_root}/code/part2-kernels/chapter7"

cat > "${fake_bin}/ssh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

[[ "$1" == "-o" ]]
[[ "$2" == "BatchMode=yes" ]]
shift 3
[[ "$#" == "1" ]]
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

: > "${PART2_FAKE_RSYNC_CALLED}"
EOF
chmod +x "${fake_bin}/rsync"

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
    PART2_FAKE_RSYNC_CALLED="${fake_rsync_called}" \
    PART2_FAKE_SSH_COMMAND="${fake_ssh_command}" \
    PATH="${fake_bin}:${PATH}" \
    bash "${TARGET}" sync > "${escaped_sync_output}" 2>&1; then
    echo "escaped sync path unexpectedly accepted" >&2
    exit 1
fi
grep -Fq "remote target escapes remote root" "${escaped_sync_output}"
[[ ! -e "${outside_root}/part2-kernels" ]]
[[ ! -e "${fake_rsync_called}" ]]

echo "part2 remote wrapper contract: PASS"
