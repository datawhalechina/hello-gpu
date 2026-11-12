"""Small reusable teaching API; import once in each notebook, as with d2l."""
from importlib import import_module
from .environment import environment
from .config import settings
from .hip import HIPKernel, compile_kernel, load_ipython_extension
from .paths import artifact_root
from .measurement import Measurement, benchmark, benchmark_batch, summary, plot_times, plot_samples, launch_overhead
from .records import save_record
from .lab import (bench, check, check_card, check_env, check_mm_cost, check_timer, compare, device_card, peak, race,
                  roofline, submit, trace, warm_cold)
from . import stars

__version__ = "0.1.0"
__all__ = ["HIPKernel", "compile_kernel", "load_ipython_extension", "environment",
           "settings", "artifact_root", "Measurement", "benchmark", "benchmark_batch", "summary",
           "plot_times", "plot_samples", "launch_overhead", "save_record",
           # v2 实验室接口（课程规则）
           "device_card", "check", "bench", "peak", "compare", "submit", "stars",
           # 2-1 开工准备：一键检查环境、核对读出的三个数、矩阵乘 CPU 和 GPU 比快慢
           "check_env", "check_card", "race",
           # 2-3 测得准：核对读者写的计时函数、热缓存和冷缓存轮流测
           "check_timer", "warm_cold",
           # 2-4 性能的天花板：用实测峰值画屋顶线、核对读者写的矩阵乘工作量
           "roofline", "check_mm_cost",
           # 2-5 一行 PyTorch 背后：用 torch.profiler 记下一行代码启动的 kernel，存成档案馆收录的 trace
           "trace"]


def __getattr__(name):
    # Optional teaching modules load only when a chapter asks for them. Keeping
    # their APIs under module names also avoids one large, collision-prone facade.
    if name in {"profiling", "learning", "agentlab"}:
        module = import_module(f".{name}", __name__)
        globals()[name] = module
        return module
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
