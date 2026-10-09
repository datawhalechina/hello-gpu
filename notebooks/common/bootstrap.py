"""Make this checkout's teaching helpers available to an existing notebook kernel.

Run with ``%run ../../common/bootstrap.py`` from a chapter directory. The path is
anchored to this file; dependencies and the active Python environment are kept
as configured by the notebook platform. No package or GPU is imported here.
"""

import sys as _sys
from pathlib import Path as _Path

_source = _Path(__file__).resolve().parent / "src"
if not (_source / "hello_gpu" / "__init__.py").is_file():
    raise FileNotFoundError(f"The teaching helper source directory is missing: {_source}")
_source_path = str(_source)
_sys.path[:] = [_source_path] + [entry for entry in _sys.path if entry != _source_path]

del _sys, _Path, _source, _source_path
