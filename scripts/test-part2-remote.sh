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
remote_root="${test_tmp}/remote root"
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
grep -Fq "'semi; printf injected'" "${fake_ssh_command}"
grep -Fq "'dollar\$(printf injected)'" "${fake_ssh_command}"

echo "part2 remote wrapper contract: PASS"
