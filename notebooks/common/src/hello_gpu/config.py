"""Small shared experiment settings, loaded explicitly rather than at import."""

from __future__ import annotations

import os
from pathlib import Path
import tomllib


_DEFAULTS = {"n": 1 << 20, "block": 256, "warmup": 5, "repeat": 30, "seed": 0}


def configuration() -> dict:
    """Read the complete TOML configuration, supplying experiment defaults.

    HELLO_GPU_CONFIG selects another TOML file. Unspecified keys keep defaults;
    an explicitly selected missing file, typo or invalid value raises an error.
    The result is a new dictionary and can be adjusted for a single experiment.
    Other sections are preserved for their owning modules to validate.
    No GPU or random-number generator is touched by this function.
    """
    override = os.environ.get("HELLO_GPU_CONFIG")
    path = Path(override).expanduser().resolve() if override else None
    if path is None:
        for parent in Path(__file__).resolve().parents:
            if parent.name == "notebooks" and (parent / "common").is_dir():
                path = parent / "config.toml"
                break
    complete = {}
    if path is not None and (override or path.exists()):
        with path.open("rb") as source:
            complete = tomllib.load(source)
    data = complete.get("experiment", {})
    if not isinstance(data, dict):
        raise ValueError("[experiment] must be a TOML table")
    unknown = data.keys() - _DEFAULTS.keys()
    if unknown:
        raise ValueError(f"Unknown experiment settings: {', '.join(sorted(unknown))}")
    result = dict(_DEFAULTS) | data
    for key, value in result.items():
        minimum = 0 if key in ("warmup", "seed") else 1
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise ValueError(f"experiment.{key} must be an integer >= {minimum}")
    if result["n"] > 2**31 - 1 or result["block"] > 2**31 - 1:
        raise ValueError("experiment.n and experiment.block must fit the int32 HIP contract")
    if result["seed"] > 2**63 - 1:
        raise ValueError("experiment.seed must fit a nonnegative int64")
    complete["experiment"] = result
    return complete


def settings() -> dict[str, int]:
    """Return the shared n/block/warmup/repeat/seed experiment settings."""
    return configuration()["experiment"]
