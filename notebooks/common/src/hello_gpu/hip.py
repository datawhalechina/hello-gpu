"""Compile explicitly contracted HIP kernels and call them with PyTorch tensors.

Only the binary_f32 preset is supported: two contiguous, same-shape FP32 GPU
inputs, an equally shaped output and an int32 element count. The caller authors
``kernel(const float*, const float*, float*, int)`` (or specify ``entry``) and must write every output
exactly as intended. There is no source parser, implicit copy or autograd rule.
"""

from __future__ import annotations

import argparse
import contextlib
from functools import partial
import hashlib
from importlib.resources import files
import io
import json
import keyword
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import threading
import time
from typing import Callable

import torch

from .environment import require_rocm
from .paths import artifact_root

_MODULES: dict[str, object] = {}
_TORCH_OPS: dict[str, object] = {}
_BUILD_LOCK = threading.RLock()
_FLAGS = ["-O3", "-std=c++17"]


def _template(name: str) -> str:
    return files("hello_gpu").joinpath("templates", name).read_text(encoding="utf-8")


def _compiler_identity(rocm_home: str | None) -> str:
    if not rocm_home:
        raise RuntimeError("PyTorch could not find ROCm; check the current HIP SDK paths and ROCm PyTorch installation.")
    compiler = Path(rocm_home) / "bin" / "hipcc"
    try:
        completed = subprocess.run(
            [str(compiler), "--version"], capture_output=True, text=True, timeout=15, check=True
        )
        return completed.stdout + completed.stderr
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f"Cannot run HIP compiler {compiler}; check the current HIP SDK and compiler paths.") from error


def _write_if_changed(path: Path, contents: str) -> None:
    # Preserve mtimes so a fresh interpreter can reuse ninja's existing build.
    if not path.exists() or path.read_text(encoding="utf-8") != contents:
        path.write_text(contents, encoding="utf-8")


def _grid_limit(value: int | None) -> int:
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError("grid_limit must be an integer or None")
    if value <= 0 or value > 2**31 - 1:
        raise ValueError("grid_limit must be a positive int32 or None")
    return value


def _target_architecture() -> str:
    override = os.environ.get("PYTORCH_ROCM_ARCH", "").strip()
    if override:
        return override
    return torch.cuda.get_device_properties(torch.cuda.current_device()).gcnArchName.split(":")[0]


def _arguments(a: torch.Tensor, b: torch.Tensor, block: int,
               out: torch.Tensor | None) -> torch.Tensor:
    if isinstance(block, bool) or not isinstance(block, int):
        raise TypeError("block must be an integer")
    if block <= 0 or block > 2**31 - 1:
        raise ValueError("block must be a positive int32; the device limit is checked before launch")
    if not isinstance(a, torch.Tensor) or not isinstance(b, torch.Tensor):
        raise TypeError("a and b must be torch.Tensor objects")
    # Reject invalid input before any output allocation.
    for name, tensor in (("a", a), ("b", b)):
        if tensor.device.type != "cuda" or tensor.dtype != torch.float32:
            raise ValueError(f"{name} must be a ROCm GPU Tensor with dtype torch.float32")
        if tensor.layout != torch.strided or not tensor.is_contiguous():
            raise ValueError(f"{name} must be a contiguous strided Tensor")
        if tensor.requires_grad:
            raise ValueError(f"{name} must not require gradients: this adapter is forward-only")
        if tensor.is_neg() or tensor.is_conj():
            raise ValueError(f"{name} must not have unresolved view bits")
    if a.device != b.device or a.shape != b.shape:
        raise ValueError("a and b must have the same shape and GPU device")
    if a.numel() > 2**31 - 1:
        raise ValueError("n exceeds the int32 kernel ABI")
    if out is None:
        out = torch.empty_like(a)
    elif not isinstance(out, torch.Tensor):
        raise TypeError("out must be a torch.Tensor")
    # C++ checks out's metadata and storage overlap before launching, including
    # when the tensors are modified after prepare(). No silent repair/copy.
    return out


class HIPKernel:
    """Compiled binary_f32 function with explicit launch size and optional output."""

    def __init__(self, name: str, source: str, module: object, build_id: str,
                 build_directory: Path, compile_seconds: float, cache_hit: bool,
                 build_config: dict | None = None):
        self.__name__ = name
        self.source = source
        self.module = module
        self.build_id = build_id
        self.module_name = f"hello_gpu_{build_id}"
        self.build_directory = build_directory
        self.compile_seconds = compile_seconds
        self.cache_hit = cache_hit
        self.build_config = dict(build_config or {})
        self.grid_limit = self.build_config.get("grid_limit")

    def __call__(self, a: torch.Tensor, b: torch.Tensor, *, block: int = 256,
                 out: torch.Tensor | None = None, grid_limit: int | None = None) -> torch.Tensor:
        grid = _grid_limit(self.grid_limit if grid_limit is None else grid_limit)
        out = _arguments(a, b, block, out)
        return self.module.launch(a, b, out, block, grid)

    def prepare(self, a: torch.Tensor, b: torch.Tensor, *, block: int = 256,
                out: torch.Tensor | None = None,
                grid_limit: int | None = None) -> Callable[[], torch.Tensor]:
        """Validate/allocate once in Python and return a zero-argument launch.

        Preparation does not execute the kernel. The returned callable holds the
        input and output tensors alive and resolves PyTorch's current stream on
        each call. C++ validation, device guard and dispatch remain in each call;
        timing this callable is NOT isolated hardware kernel latency. Metadata
        changes after preparation are rechecked, never silently copied/repaired.
        A grid cap requires a grid-stride (or equivalent coverage) kernel; this
        adapter cannot infer whether the authored kernel covers all elements.
        """
        grid = _grid_limit(self.grid_limit if grid_limit is None else grid_limit)
        out = _arguments(a, b, block, out)
        self.module.validate(a, b, out, block, grid)
        return partial(self.module.launch, a, b, out, block, grid)

    def __repr__(self) -> str:
        return f"HIPKernel({self.__name__!r}, preset='binary_f32', build='{self.build_id}')"

    @property
    def op(self):
        """Lazy content-versioned torch.ops entry for this forward-only kernel.

        No autograd, FakeTensor or torch.compile implementation is registered.
        Use the direct callable when you need a preallocated output.
        """
        with _BUILD_LOCK:
            if self.build_id not in _TORCH_OPS:
                @torch.library.custom_op(
                    f"{self.module_name}::binary_f32", mutates_args=(), device_types="cuda"
                )
                def binary_f32(a: torch.Tensor, b: torch.Tensor, block: int = 256,
                               grid_limit: int = 0) -> torch.Tensor:
                    return self(a, b, block=block, grid_limit=grid_limit or None)

                _TORCH_OPS[self.build_id] = binary_f32
        return getattr(getattr(torch.ops, self.module_name), "binary_f32").default


def compile_kernel(name: str, source: str | Path, *, preset: str = "binary_f32",
                   entry: str = "kernel", grid_limit: int | None = None) -> HIPKernel:
    """Compile source text (or read a Path), reusing content-addressed builds.

    Each output element must be written by the user's kernel. The preset launches
    ceil(n / block) blocks and passes (a, b, out, n). ``name`` is only the Python
    display name; changing it does not cause an unnecessary rebuild. A string is
    always source text; use pathlib.Path explicitly to compile from a file.
    grid_limit caps the number of blocks; use it only with a kernel that covers
    remaining elements (for example a grid-stride loop). Call-time caps override
    this default; None at call time inherits the compiled object's default.
    """
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z_]\w*", name, re.ASCII) or keyword.iskeyword(name):
        raise ValueError("name must be a valid ASCII Python identifier")
    if not isinstance(entry, str) or not re.fullmatch(r"[A-Za-z_]\w*", entry, re.ASCII):
        raise ValueError("entry must be a valid ASCII C++ function identifier")
    if preset != "binary_f32":
        raise ValueError("Only --preset binary_f32 is implemented")
    if isinstance(source, Path):
        source = source.read_text(encoding="utf-8")
    if not isinstance(source, str) or not source.strip():
        raise ValueError("HIP source must not be empty")
    _grid_limit(grid_limit)
    require_rocm()
    # torch's compiler configuration uses process-wide environment variables.
    # Serializing compilation also avoids races in its extension-version cache.
    with _BUILD_LOCK:
        return _compile(name, source, preset, entry, grid_limit)


def _compile(name: str, source: str, preset: str, entry: str,
             grid_limit: int | None) -> HIPKernel:
    from torch.utils.cpp_extension import ROCM_HOME, load

    previous_arch = os.environ.get("PYTORCH_ROCM_ARCH")
    target_arch = _target_architecture()
    binding = _template("binding.cpp")
    generated = _template("header.hip") + '#line 1 "notebook_kernel.hip"\n' + source + "\n" + _template("binary_f32.hip").replace("__HELLO_GPU_KERNEL_ENTRY__", entry)
    identity = {
        "source": generated, "binding": binding, "preset": preset,
        "torch": str(torch.__version__), "hip": torch.version.hip,
        "python": sys.version, "architecture": target_arch, "flags": _FLAGS,
        "abi": torch._C._GLIBCXX_USE_CXX11_ABI,
        "compiler": _compiler_identity(ROCM_HOME),
        "rocm_home": str(ROCM_HOME), "cxx": os.environ.get("CXX", "default"),
        "grid_limit": grid_limit,
    }
    config = {key: value for key, value in identity.items() if key not in ("source", "binding")}
    config["entry"] = entry
    build_id = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:20]
    build_directory = artifact_root() / "build" / build_id
    module_name = f"hello_gpu_{build_id}"
    if build_id in _MODULES:
        return HIPKernel(name, source, _MODULES[build_id], build_id, build_directory, 0.0, True, config)
    build_directory.mkdir(parents=True, exist_ok=True)
    _write_if_changed(build_directory / "binding.cpp", binding)
    _write_if_changed(build_directory / "kernel.hip", generated)
    _write_if_changed(build_directory / "build_identity.json", json.dumps(identity, indent=2))
    existed = any(build_directory.glob(f"{module_name}*.so"))
    captured = io.StringIO()
    started = time.perf_counter()
    os.environ["PYTORCH_ROCM_ARCH"] = target_arch
    try:
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            module = load(
                name=module_name,
                sources=[str(build_directory / "binding.cpp"), str(build_directory / "kernel.hip")],
                extra_cflags=_FLAGS,
                extra_cuda_cflags=_FLAGS,
                build_directory=str(build_directory),
                with_cuda=True,
                verbose=False,
            )
    except Exception as error:
        log_path = build_directory / "build.log"
        log_path.write_text(captured.getvalue() + "\n" + str(error), encoding="utf-8")
        raise RuntimeError(
            f"HIP compilation failed. Kernel lines are labelled notebook_kernel.hip. "
            f"Full output: {log_path}\n{error}"
        ) from error
    finally:
        if previous_arch is None:
            os.environ.pop("PYTORCH_ROCM_ARCH", None)
        else:
            os.environ["PYTORCH_ROCM_ARCH"] = previous_arch
    elapsed = time.perf_counter() - started
    (build_directory / "build.log").write_text(captured.getvalue(), encoding="utf-8")
    _MODULES[build_id] = module
    return HIPKernel(name, source, module, build_id, build_directory, elapsed, existed, config)


def load_ipython_extension(ipython) -> None:
    """Register %%hip and publish a callable only after successful compilation."""
    from IPython.core.error import UsageError

    def hip(line: str, cell: str) -> None:
        parser = argparse.ArgumentParser(prog="%%hip", add_help=False)
        parser.add_argument("name")
        parser.add_argument("--preset", default="binary_f32")
        parser.add_argument("--entry", default="kernel")
        parser.add_argument("--grid-limit", type=int)
        try:
            arguments = parser.parse_args(shlex.split(line))
        except (SystemExit, ValueError) as error:
            raise UsageError("Usage: %%hip vector_add [--preset binary_f32] [--entry kernel] [--grid-limit N]") from error
        kernel = compile_kernel(arguments.name, cell, preset=arguments.preset,
                                entry=arguments.entry, grid_limit=arguments.grid_limit)
        ipython.user_ns[arguments.name] = kernel
        action = "缓存已复用" if kernel.cache_hit else "编译完成"
        print(f"{arguments.name} · {action} · {kernel.compile_seconds:.2f} s · "
              f"现在可以用 {arguments.name}(a, b) 调用")

    ipython.register_magic_function(hip, magic_kind="cell", magic_name="hip")
