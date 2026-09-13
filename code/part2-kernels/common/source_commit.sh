#!/usr/bin/env bash
# Resolve optional source provenance without requiring Git on experiment hosts.
set -euo pipefail

if [[ -n "${SOURCE_COMMIT:-}" ]]; then
    if [[ ! "${SOURCE_COMMIT}" =~ ^[0-9a-f]{7,40}$ ]]; then
        echo "SOURCE_COMMIT must be a 7-40 character lowercase Git SHA when provided" >&2
        exit 2
    fi
    # Maintainers provide this when copying source to a host where Git is not used.
    printf '%s\n' "${SOURCE_COMMIT}"
    exit 0
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
# Check the expected checkout itself: an extracted archive can live inside an
# unrelated repository. A worktree uses a .git file rather than a directory.
if [[ -e "${repo_root}/.git" ]] && command -v git >/dev/null 2>&1; then
    # Caller-specific Git environment must not select another repository.
    unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE
    if checkout_root="$(git -C "${repo_root}" rev-parse --show-toplevel 2>/dev/null)" \
        && [[ "${checkout_root}" == "${repo_root}" ]] \
        && head="$(git -C "${repo_root}" rev-parse --verify HEAD 2>/dev/null)" \
        && [[ "${head}" =~ ^[0-9a-f]{40}$ ]]; then
        printf '%s\n' "${head}"
        exit 0
    fi
fi

echo "Source checkout has no readable Git HEAD; recording source_commit=unknown." >&2
printf '%s\n' unknown
