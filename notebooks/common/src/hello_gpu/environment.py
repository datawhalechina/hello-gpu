"""Read runtime context from the active interpreter and actual GPU."""

from __future__ import annotations

import os
import platform
import sys
from importlib.metadata import PackageNotFoundError, version

import torch


def require_rocm() -> None:
    if torch.version.hip is None:
        raise RuntimeError("hello_gpu requires ROCm PyTorch in the current Python environment.")
    if not torch.cuda.is_available():
        raise RuntimeError("No ROCm GPU is visible. Check /dev/kfd permissions and GPU driver availability.")


def environment(*, require_gpu: bool = True) -> dict:
    """Return observed hardware, software, CPU threads and device/stream context.

    ``require_gpu=False`` collects only host/package context without probing or
    initializing a GPU. This does not change thread settings or synchronize the GPU. ``hip`` is the
    HIP version reported by the active PyTorch build, not a claimed driver version.
    """
    try:
        os_release = platform.freedesktop_os_release().get("PRETTY_NAME", platform.platform())
    except OSError:
        os_release = platform.platform()
    try:
        sdk_version = version("rocm")
    except PackageNotFoundError:
        sdk_version = None
    context = {
        "gpu": None,
        "architecture": None,
        "memory_bytes": None,
        "gpu_probed": False,
        "rocm_sdk": sdk_version,
        "torch": str(torch.__version__),
        "hip": torch.version.hip,
        "python": platform.python_version(),
        "executable": sys.executable,
        "os": os_release,
        "kernel": platform.release(),
        "cpu": platform.processor() or platform.machine(),
        "cpu_logical_count": os.cpu_count(),
        "cpu_threads": torch.get_num_threads(),
        "cpu_interop_threads": torch.get_num_interop_threads(),
        "device": None,
        "stream": None,
    }
    if require_gpu:
        require_rocm()
        device = torch.cuda.current_device()
        properties = torch.cuda.get_device_properties(device)
        context.update({
            "gpu": properties.name,
            "architecture": properties.gcnArchName,
            "memory_bytes": properties.total_memory,
            "gpu_probed": True,
            "device": device,
            "stream": int(torch.cuda.current_stream(device).cuda_stream),
        })
    return context
