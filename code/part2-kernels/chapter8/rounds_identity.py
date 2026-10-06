"""Read-only identity checks before adding work to a frozen experiment.

The current analysis/runner scripts may evolve. Their copies in ``source/``
and the measured HIP binary must still match the original manifest, and the
current device/software must match the environment used for those samples.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import platform


REQUIRED_ENVIRONMENT_FIELDS = (
    "gpu", "architecture", "rocm_sdk", "hip", "torch", "triton", "os",
    "kernel", "python",
)


class FrozenIdentityError(ValueError):
    """The requested continuation would mix experiment identities."""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def capture_environment() -> dict:
    """Query the active runtime without running a benchmark or changing it."""
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("no available GPU in the active Python environment")
    properties = torch.cuda.get_device_properties(0)
    return {
        "gpu": torch.cuda.get_device_name(0),
        "architecture": properties.gcnArchName,
        "rocm_sdk": version("rocm"),
        "hip": torch.version.hip,
        "torch": str(torch.__version__),
        "triton": version("triton"),
        "os": platform.freedesktop_os_release().get("PRETTY_NAME"),
        "kernel": platform.release(),
        "python": platform.python_version(),
    }


def _reject(reason: str) -> None:
    raise FrozenIdentityError(
        f"{reason}; refusing to continue this frozen run. "
        "Start a new experiment with a new --output directory."
    )


def check_frozen_identity(root: Path, manifest: dict | None = None) -> dict:
    """Verify stored inputs first, then capture and compare the live environment.

    Nothing is written here. The caller persists the returned check alongside
    its phase or confirmation only after every required comparison passes.
    Python bytecode caches are not measurement sources and are ignored.
    """
    root = Path(root).resolve()
    if manifest is None:
        manifest = json.loads((root / "manifest.json").read_text())
    expected_sources = manifest.get("source_sha256")
    if not isinstance(expected_sources, dict) or not expected_sources:
        _reject("frozen manifest has no source hashes")
    for name in expected_sources:
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts:
            _reject(f"invalid frozen source path: {name}")
    actual_names = {
        str(path.relative_to(root / "source"))
        for path in (root / "source").rglob("*")
        if path.is_file() and "__pycache__" not in path.relative_to(root / "source").parts
    }
    if actual_names != set(expected_sources):
        _reject(f"frozen source inventory changed: missing={sorted(set(expected_sources) - actual_names)}, "
                f"unexpected={sorted(actual_names - set(expected_sources))}")
    actual_sources = {name: sha256(root / "source" / name) for name in expected_sources}
    for name, expected in expected_sources.items():
        if actual_sources[name] != expected:
            _reject(f"frozen source hash mismatch: {name}")
    binary = root / "build/vector_add_hip"
    expected_binary = manifest.get("build", {}).get("binary_sha256")
    if not expected_binary or not binary.is_file() or sha256(binary) != expected_binary:
        _reject("frozen HIP binary hash mismatch")

    expected_environment = manifest.get("environment", {})
    missing = [name for name in REQUIRED_ENVIRONMENT_FIELDS if not expected_environment.get(name)]
    if missing:
        _reject(f"frozen manifest lacks required environment fields: {', '.join(missing)}")
    try:
        live = capture_environment()
    except Exception as exc:
        _reject(f"cannot capture active GPU/software environment: {exc}")
    for name in REQUIRED_ENVIRONMENT_FIELDS:
        if live.get(name) != expected_environment[name]:
            _reject(f"active environment mismatch for {name}: "
                    f"frozen={expected_environment[name]!r}, active={live.get(name)!r}")
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "source_reference": {
            "experiment": manifest.get("experiment"),
            "started_at": manifest.get("started_at"),
            "manifest_sha256": sha256(root / "manifest.json"),
        },
        "source_sha256": actual_sources,
        "binary_sha256": expected_binary,
        "environment": live,
        "compared_environment_fields": list(REQUIRED_ENVIRONMENT_FIELDS),
    }
