"""Keep generated files away from authored notebooks and installed package files."""

from __future__ import annotations

import os
from pathlib import Path


def artifact_root() -> Path:
    """Resolve the output directory without creating it.

    An editable checkout uses notebooks/.artifacts independently of the notebook's
    current directory. HELLO_GPU_ARTIFACTS may override this with an absolute path.
    A wheel installation falls back to the user's XDG cache directory.
    """
    configured = os.environ.get("HELLO_GPU_ARTIFACTS")
    if configured:
        root = Path(configured).expanduser()
        if not root.is_absolute():
            raise ValueError("HELLO_GPU_ARTIFACTS must be an absolute path")
        return root.resolve()
    for parent in Path(__file__).resolve().parents:
        if parent.name == "notebooks" and (parent / "common").is_dir():
            return parent / ".artifacts"
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")).expanduser()
    if not cache.is_absolute():
        cache = Path.home() / ".cache"
    return cache / "hello-gpu"
