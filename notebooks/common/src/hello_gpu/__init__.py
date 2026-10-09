"""Small reusable teaching API; import once in each notebook, as with d2l."""
from importlib import import_module
from .environment import environment
from .config import settings
from .hip import HIPKernel, compile_kernel, load_ipython_extension
from .paths import artifact_root
from .measurement import Measurement, benchmark, benchmark_batch, summary, plot_times, plot_samples, launch_overhead
from .records import save_record

__version__ = "0.1.0"
__all__ = ["HIPKernel", "compile_kernel", "load_ipython_extension", "environment",
           "settings", "artifact_root", "Measurement", "benchmark", "benchmark_batch", "summary",
           "plot_times", "plot_samples", "launch_overhead", "save_record"]


def __getattr__(name):
    # Optional teaching modules load only when a chapter asks for them. Keeping
    # their APIs under module names also avoids one large, collision-prone facade.
    if name in {"profiling", "learning"}:
        module = import_module(f".{name}", __name__)
        globals()[name] = module
        return module
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
