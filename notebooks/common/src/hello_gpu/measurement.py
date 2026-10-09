"""Small timing helpers with explicit, reproducible measurement boundaries.

Prepare inputs and outputs before passing a zero-argument callable. These helpers
never move tensors or add correctness checks inside a timed interval. Importing
this module does not initialize a GPU.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, replace
import math
import statistics
import time

import pandas as pd
import torch


CPU_BOUNDARY = (
    "CPU wall time around one prepared callable; includes Python/C++ dispatch "
    "and computation. Input/output allocation and correctness checks are outside "
    "when the caller prepares them in advance."
)
GPU_BOUNDARY = (
    "Current-stream GPU event interval around one prepared callable; event objects "
    "are reused and primed. Each end event is synchronized outside the interval. "
    "May include host submission gaps and other current-stream work; not isolated "
    "hardware kernel latency. No H2D/D2H or allocation unless fn performs it."
)


def _counts(warmup: int, repeat: int) -> None:
    for name, value, minimum in (("warmup", warmup, 0), ("repeat", repeat, 1)):
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise ValueError(f"{name} must be an integer >= {minimum}")


@dataclass(frozen=True)
class Measurement:
    """Raw milliseconds and the context needed to interpret their statistics."""

    label: str
    samples_ms: tuple[float, ...]
    method: str
    device: str
    warmup: int
    repeat: int
    cpu_threads: int
    boundary: str
    stream: int | None = None
    batch_calls: int = 1

    def __post_init__(self) -> None:
        _counts(self.warmup, self.repeat)
        if isinstance(self.batch_calls, bool) or not isinstance(self.batch_calls, int) or self.batch_calls < 1:
            raise ValueError("batch_calls must be a positive integer")
        if not self.label or len(self.samples_ms) != self.repeat:
            raise ValueError("label must be nonempty and samples must match repeat")
        if any(not math.isfinite(value) or value < 0 for value in self.samples_ms):
            raise ValueError("samples_ms must contain finite nonnegative timings")

    @property
    def mean_ms(self) -> float:
        return statistics.mean(self.samples_ms)

    @property
    def median_ms(self) -> float:
        return statistics.median(self.samples_ms)

    @property
    def min_ms(self) -> float:
        return min(self.samples_ms)

    def to_dict(self) -> dict:
        return {
            **asdict(self),
            "mean_ms": self.mean_ms,
            "median_ms": self.median_ms,
            "min_ms": self.min_ms,
        }


def _events(stream):
    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    # HIP event creation/initialization must not inflate the first real sample.
    start.record(stream)
    end.record(stream)
    end.synchronize()
    return start, end


def benchmark(fn: Callable[[], object], *, device: str = "cuda", label: str = "HIP",
              warmup: int = 5, repeat: int = 30) -> Measurement:
    """Time a prepared callable, excluding warmup and event initialization.

    CPU uses perf_counter. GPU uses per-call current-stream events and synchronizes
    after every call. The callable must submit all relevant GPU work to that stream
    (or explicitly join work from other streams before returning).
    """
    _counts(warmup, repeat)
    if not callable(fn):
        raise TypeError("fn must be a zero-argument callable")
    if not isinstance(label, str) or not label:
        raise ValueError("label must be a nonempty string")
    target = torch.device(device)
    if target.type not in ("cpu", "cuda"):
        raise ValueError("device must be 'cpu' or a PyTorch 'cuda' device (also used by ROCm)")
    cpu_threads = torch.get_num_threads()
    samples = []
    if target.type == "cpu":
        for _ in range(warmup):
            fn()
        for _ in range(repeat):
            started = time.perf_counter()
            fn()
            samples.append((time.perf_counter() - started) * 1000)
        return Measurement(label, tuple(samples), "CPU perf_counter", str(target),
                           warmup, repeat, cpu_threads, CPU_BOUNDARY)

    if not torch.cuda.is_available():
        raise RuntimeError("No GPU is available; use the remote ROCm Python kernel")
    with torch.cuda.device(target):
        stream = torch.cuda.current_stream()
        start, end = _events(stream)
        for _ in range(warmup):
            fn()
        stream.synchronize()
        for _ in range(repeat):
            start.record(stream)
            fn()
            end.record(stream)
            end.synchronize()
            samples.append(float(start.elapsed_time(end)))
        return Measurement(label, tuple(samples), "GPU current-stream events",
                           f"cuda:{torch.cuda.current_device()}", warmup, repeat,
                           cpu_threads, GPU_BOUNDARY, int(stream.cuda_stream))


def benchmark_batch(fn: Callable[[], object], *, batch: int = 20,
                    device: str = "cuda", label: str = "HIP",
                    warmup: int = 5, repeat: int = 30) -> Measurement:
    """Measure batches and retain one per-call batch average per sample.

    ``warmup`` and ``repeat`` count batches, each containing ``batch`` calls.
    The GPU uses one event interval per batch, with waiting after the end event;
    samples include host loop/submission gaps. These samples are averages of
    batches, not a distribution of individual kernel latencies. Compilation and
    first-use preparation belong outside this helper, as with benchmark().
    """
    if isinstance(batch, bool) or not isinstance(batch, int) or batch < 1:
        raise ValueError("batch must be a positive integer")
    if not callable(fn):
        raise TypeError("fn must be a zero-argument callable")

    def calls():
        for _ in range(batch):
            fn()

    measured = benchmark(calls, device=device, label=label, warmup=warmup, repeat=repeat)
    return replace(
        measured,
        samples_ms=tuple(value / batch for value in measured.samples_ms),
        method=measured.method + " / batch mean",
        batch_calls=batch,
        boundary=(
            f"Each sample is an interval around {batch} calls divided by {batch}; "
            "warmup/repeat count batches. Includes host loop/submission gaps; "
            "not a distribution of individual kernel latencies. " + measured.boundary
        ),
    )


def summary(measurements: Iterable[Measurement], *, bytes_moved: int | None = None,
            statistic: str = "min_ms") -> pd.DataFrame:
    """Summarize latency and optional algorithmic bandwidth in decimal GB/s.

    bytes_moved is a caller-supplied data-traffic model, not measured physical
    DRAM traffic. For FP32 Vector Add it is 3 * N * 4. A zero event time cannot
    support a bandwidth estimate and is reported as NaN rather than infinity.
    Set statistic="median_ms" to derive effective_GB_s_by_median; the default
    retains the original chapter 4 table's effective_GB_s_by_min column.
    """
    if statistic not in {"min_ms", "median_ms", "mean_ms"}:
        raise ValueError("statistic must be min_ms, median_ms or mean_ms")
    if bytes_moved is not None and (
        isinstance(bytes_moved, bool) or not isinstance(bytes_moved, int) or bytes_moved <= 0
    ):
        raise ValueError("bytes_moved must be a positive integer or None")
    values = list(measurements)
    if not values or any(not isinstance(value, Measurement) for value in values):
        raise ValueError("measurements must contain at least one Measurement")
    rows = []
    for value in values:
        row = {
            "label": value.label, "mean_ms": value.mean_ms,
            "median_ms": value.median_ms, "min_ms": value.min_ms,
        }
        if bytes_moved is not None:
            duration = getattr(value, statistic)
            row[f"effective_GB_s_by_{statistic.removesuffix('_ms')}"] = (
                bytes_moved / duration / 1e6 if duration > 0 else float("nan")
            )
        rows.append(row)
    table = pd.DataFrame(rows).set_index("label")
    table.attrs = {
        "measurements": [value.to_dict() for value in values],
        "bytes_moved_model": bytes_moved,
        "bandwidth_statistic": statistic,
        "bandwidth_unit": "decimal GB/s (1 GB = 10^9 bytes)",
        "comparison_boundary": (
            "CPU wall time includes host dispatch; GPU current-stream event intervals "
            "can include submission gaps. These are different timing boundaries. "
            "CPU thread counts are observed, not assumed to be single-core."
        ),
    }
    return table


def plot_times(table: pd.DataFrame, *, statistic: str = "min_ms"):
    """Plot a named latency statistic with units and CPU/GPU boundary note."""
    import matplotlib.pyplot as plt

    if statistic not in {"min_ms", "median_ms", "mean_ms"}:
        raise ValueError("statistic must be min_ms, median_ms or mean_ms")
    if statistic not in table or table.empty:
        raise ValueError(f"table must contain nonempty {statistic} results from summary()")
    figure, axes = plt.subplots(figsize=(7, 4), layout="constrained")
    axes.barh([str(label) for label in table.index], table[statistic], color="#2f6f83")
    title = {"min_ms": "Minimum", "median_ms": "Median", "mean_ms": "Mean"}[statistic]
    axes.set_xlabel(f"{title} latency (ms; lower is faster)")
    axes.set_title("Measured latency of prepared calls")
    axes.invert_yaxis()
    axes.grid(axis="x", alpha=0.2)
    axes.set_axisbelow(True)
    figure.supxlabel(
        "CPU: wall time, recorded thread count. GPU: current-stream events, may include submit gaps.\n"
        "Prepared inputs/outputs; no transfers or allocation unless the callable performs them.",
        fontsize=8,
    )
    return axes


def plot_samples(measurements: Measurement | Iterable[Measurement]):
    """Plot recorded samples in execution order, labelling batch averages clearly."""
    import matplotlib.pyplot as plt

    values = [measurements] if isinstance(measurements, Measurement) else list(measurements)
    if not values or any(not isinstance(value, Measurement) for value in values):
        raise ValueError("measurements must contain at least one Measurement")
    figure, axes = plt.subplots(figsize=(7, 4), layout="constrained")
    for value in values:
        label = value.label
        if value.batch_calls > 1:
            label += f" (mean of {value.batch_calls} calls)"
        axes.plot(range(1, value.repeat + 1), value.samples_ms, marker=".", label=label)
    axes.set_xlabel("Sample number (execution order)")
    axes.set_ylabel("Time per call (ms)")
    axes.set_title("Recorded timing samples")
    axes.grid(alpha=0.2)
    axes.legend()
    figure.supxlabel(
        "Batch samples average several calls; they do not show per-kernel latency variation.\n"
        "GPU events may include host submission gaps; CPU measurements use wall time.",
        fontsize=8,
    )
    return axes


def launch_overhead(fn: Callable[[], object], *, warmup: int = 5,
                    repeat: int = 30) -> pd.DataFrame:
    """Compare three timing boundaries for a prepared, small GPU callable.

    These are Python + C++ wrapper + HIP + queue-path costs, not pure HIP runtime
    overhead. Batch enqueue averages repeat calls per batch across repeat batches.
    Waiting is outside each batch interval; queue backpressure may still affect
    submission. The submit-and-wait path synchronizes the current stream per call.
    """
    _counts(warmup, repeat)
    if not callable(fn):
        raise TypeError("fn must be a zero-argument callable")
    if not torch.cuda.is_available():
        raise RuntimeError("launch_overhead requires the remote ROCm GPU")
    stream = torch.cuda.current_stream()
    for _ in range(warmup):
        fn()
    stream.synchronize()
    samples = {"CPU batch enqueue": [], "CPU submit + wait": [], "GPU event interval": []}
    for _ in range(repeat):
        stream.synchronize()
        started = time.perf_counter()
        for _ in range(repeat):
            fn()
        elapsed = time.perf_counter() - started
        stream.synchronize()
        samples["CPU batch enqueue"].append(elapsed * 1e6 / repeat)
    for _ in range(repeat):
        stream.synchronize()
        started = time.perf_counter()
        fn()
        stream.synchronize()
        samples["CPU submit + wait"].append((time.perf_counter() - started) * 1e6)
    events = benchmark(fn, warmup=warmup, repeat=repeat, label="small HIP callable")
    samples["GPU event interval"] = [value * 1000 for value in events.samples_ms]
    table = pd.DataFrame([
        {"path": path, "mean_us": statistics.mean(values)} for path, values in samples.items()
    ])
    table.attrs = {
        "samples_us": samples,
        "warmup": warmup,
        "repeat": repeat,
        "batch_calls": repeat,
        "cpu_threads": torch.get_num_threads(),
        "device": f"cuda:{torch.cuda.current_device()}",
        "stream": int(stream.cuda_stream),
        "scope": "Python + C++ wrapper + HIP + queue path; not pure HIP runtime overhead",
        "boundaries": {
            "CPU batch enqueue": (
                "perf_counter around batch; wait before and after outside interval; "
                "time divided by batch_calls; includes Python loop and possible queue backpressure"
            ),
            "CPU submit + wait": "perf_counter around one call plus current-stream synchronize",
            "GPU event interval": GPU_BOUNDARY,
        },
        "event_warmup": events.warmup,
    }
    return table
