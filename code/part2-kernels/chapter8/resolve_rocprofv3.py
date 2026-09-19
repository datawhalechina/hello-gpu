"""Resolve a rocprofv3 installation compatible with the active Python ROCm runtime."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping, Sequence


_VERSION_LINE = re.compile(r"(?<!\d)(\d+)\.(\d+)")
_ROCPROF_ROCM_VERSION = re.compile(r"(?m)^\s*rocm_version:\s*([^\s]+)")


@dataclass(frozen=True)
class RocprofSelection:
    available: bool
    kind: str
    executable: Path | None
    root: Path | None
    library_dirs: tuple[Path, ...]
    torch_hip: str | None
    rocprof_rocm: str | None
    reason: str

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["executable"] = (
            str(self.executable) if self.executable is not None else None
        )
        payload["root"] = str(self.root) if self.root is not None else None
        payload["library_dirs"] = [str(path) for path in self.library_dirs]
        return payload


def _release_line(version: str | None) -> tuple[int, int] | None:
    if not version:
        return None
    match = _VERSION_LINE.search(version)
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2))


def _library_dirs(root: Path) -> tuple[Path, ...]:
    directories = [root / "lib"]
    lib64 = root / "lib64"
    if lib64.is_dir():
        directories.append(lib64)
    return tuple(directories)


def select_rocprofv3(
    *,
    torch_hip: str | None,
    bundled_roots: Sequence[Path],
    system_executable: Path | None,
    system_rocm_version: str | None,
    torch_rocm_version: str | None = None,
    bundled_rocm_version: str | None = None,
) -> RocprofSelection:
    """Select bundled rocprofv3 first, then a release-line-matched system tool."""
    if _release_line(torch_hip) is None:
        return RocprofSelection(
            available=False,
            kind="none",
            executable=None,
            root=None,
            library_dirs=(),
            torch_hip=torch_hip,
            rocprof_rocm=system_rocm_version,
            reason="torch.version.hip is unavailable or malformed",
        )

    if bundled_roots:
        root = Path(bundled_roots[0]).resolve()
        return RocprofSelection(
            available=True,
            kind="bundled",
            executable=root / "bin" / "rocprofv3",
            root=root,
            library_dirs=_library_dirs(root),
            torch_hip=torch_hip,
            rocprof_rocm=bundled_rocm_version,
            reason="using the active Python environment's bundled ROCm SDK",
        )

    if system_executable is None:
        return RocprofSelection(
            available=False,
            kind="none",
            executable=None,
            root=None,
            library_dirs=(),
            torch_hip=torch_hip,
            rocprof_rocm=system_rocm_version,
            reason="rocprofv3 was not found on PATH",
        )

    executable = Path(system_executable).resolve()
    # ROCm 10.0 ships HIP 7.15: SDK and HIP component versions are independent.
    expected_rocm = torch_rocm_version or torch_hip
    if _release_line(system_rocm_version) != _release_line(expected_rocm):
        return RocprofSelection(
            available=False,
            kind="none",
            executable=None,
            root=None,
            library_dirs=(),
            torch_hip=torch_hip,
            rocprof_rocm=system_rocm_version,
            reason=(
                f"system rocprofv3 ROCm {system_rocm_version or 'unknown'} does not "
                f"match torch ROCm release line {expected_rocm} (HIP {torch_hip})"
            ),
        )

    root = executable.parent.parent
    return RocprofSelection(
        available=True,
        kind="system",
        executable=executable,
        root=root,
        library_dirs=_library_dirs(root),
        torch_hip=torch_hip,
        rocprof_rocm=system_rocm_version,
        reason="system rocprofv3 matches the active torch ROCm release line",
    )


def _bundled_roots() -> tuple[Path, ...]:
    candidates: list[Path] = []
    try:
        spec = importlib.util.find_spec("rocm_sdk")
    except (ImportError, ValueError):
        spec = None
    if spec is not None and spec.origin:
        candidates.append(
            Path(spec.origin).resolve().parent.parent / "_rocm_sdk_core"
        )
    candidates.extend(
        Path(entry) / "_rocm_sdk_core" for entry in sys.path if entry
    )

    roots: list[Path] = []
    for candidate in candidates:
        root = candidate.resolve()
        if root in roots:
            continue
        if (root / "bin" / "rocprofv3").is_file() and (root / "lib").is_dir():
            roots.append(root)
    return tuple(roots)


def _torch_hip_version() -> str | None:
    try:
        import torch
    except Exception:
        return None
    version = getattr(getattr(torch, "version", None), "hip", None)
    return str(version) if version else None


def _torch_rocm_version() -> str | None:
    try:
        import torch
    except Exception:
        return None
    match = re.search(r"\+rocm(\d+\.\d+(?:\.\d+)?)", str(torch.__version__))
    return match.group(1) if match else None


def system_rocprof_candidates(
    *,
    path_executable: str | None,
    environment: Mapping[str, str],
    opt_root: Path,
) -> tuple[Path, ...]:
    """Discover system rocprofv3 tools without assuming a ROCm version."""
    raw_candidates: list[Path] = []
    if path_executable:
        raw_candidates.append(Path(path_executable))

    for variable in ("ROCM_PATH", "ROCM_HOME", "HIP_PATH"):
        root = environment.get(variable)
        if root:
            raw_candidates.append(Path(root) / "bin" / "rocprofv3")

    raw_candidates.append(opt_root / "rocm" / "bin" / "rocprofv3")
    if opt_root.is_dir():
        raw_candidates.extend(
            root / "bin" / "rocprofv3"
            for root in sorted(opt_root.glob("rocm-*"), reverse=True)
        )

    candidates: list[Path] = []
    for candidate in raw_candidates:
        try:
            executable = candidate.resolve()
        except OSError:
            continue
        if executable in candidates:
            continue
        if executable.is_file() and os.access(executable, os.X_OK):
            candidates.append(executable)
    return tuple(candidates)


def _rocprof_rocm_version(executable: Path | None) -> str | None:
    if executable is None:
        return None
    try:
        completed = subprocess.run(
            [str(executable), "--version"],
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = _ROCPROF_ROCM_VERSION.search(
        f"{completed.stdout}\n{completed.stderr}"
    )
    return match.group(1) if match is not None else None


def detect_rocprofv3() -> RocprofSelection:
    torch_hip = _torch_hip_version()
    torch_rocm_version = _torch_rocm_version()
    bundled_roots = _bundled_roots()
    if bundled_roots:
        return select_rocprofv3(
            torch_hip=torch_hip,
            bundled_roots=bundled_roots,
            system_executable=None,
            system_rocm_version=None,
            torch_rocm_version=torch_rocm_version,
            bundled_rocm_version=_rocprof_rocm_version(
                bundled_roots[0] / "bin" / "rocprofv3"
            ),
        )

    system_candidates = system_rocprof_candidates(
        path_executable=shutil.which("rocprofv3"),
        environment=os.environ,
        opt_root=Path("/opt"),
    )
    first_candidate: Path | None = None
    first_version: str | None = None
    for executable in system_candidates:
        version = _rocprof_rocm_version(executable)
        if first_candidate is None:
            first_candidate = executable
            first_version = version
        selection = select_rocprofv3(
            torch_hip=torch_hip,
            bundled_roots=(),
            system_executable=executable,
            system_rocm_version=version,
            torch_rocm_version=torch_rocm_version,
        )
        if selection.available:
            return selection

    return select_rocprofv3(
        torch_hip=torch_hip,
        bundled_roots=(),
        system_executable=first_candidate,
        system_rocm_version=first_version,
        torch_rocm_version=torch_rocm_version,
    )


def selection_json(selection: RocprofSelection) -> str:
    return json.dumps(selection.to_dict(), sort_keys=True)


def selection_lines(selection: RocprofSelection) -> str:
    values = (
        "1" if selection.available else "0",
        selection.kind,
        str(selection.executable or ""),
        str(selection.root or ""),
        os.pathsep.join(str(path) for path in selection.library_dirs),
        selection.torch_hip or "",
        selection.rocprof_rocm or "",
        selection.reason.replace("\n", " "),
    )
    return "\n".join(values)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", choices=("json", "lines"), default="json")
    args = parser.parse_args()
    selection = detect_rocprofv3()
    output = (
        selection_json(selection)
        if args.format == "json"
        else selection_lines(selection)
    )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
