"""Small experiment helpers; algorithm kernels stay visible in each notebook."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from uuid import uuid4

import pandas as pd
import torch

from .environment import environment
from .measurement import benchmark, summary
from .paths import artifact_root
from .records import _json_value


def inputs(n: int, *, seed: int = 0, device: str = "cuda", dtype=torch.float32):
    """Use a CPU generator so the same seed gives identical inputs across backends."""
    generator = torch.Generator().manual_seed(seed)
    a = torch.randn(n, generator=generator, dtype=dtype)
    b = torch.randn(n, generator=generator, dtype=dtype)
    return a.to(device), b.to(device)


def compare(calls: dict, *, reference: torch.Tensor, outputs: dict,
            warmup: int = 5, repeat: int = 30, bytes_moved: int | None = None):
    """Poison, run and check each floating-point output before and after timing.

    NaN poisoning is outside the measured callable and exposes missing writes
    even when candidates reuse an output buffer. Integer outputs are unsupported
    because no sentinel integer can reliably distinguish a missing write from a
    valid result. The postcheck executes a fresh call, independent of timed data.
    """
    if not calls or calls.keys() - outputs.keys():
        raise ValueError("calls must be nonempty and each call must have an output")
    for name in calls:
        output = outputs[name]
        if not isinstance(output, torch.Tensor) or not (output.is_floating_point() or output.is_complex()):
            raise TypeError(f"{name}: compare requires floating-point or complex output tensors")

    def check(name, call):
        with torch.no_grad():
            outputs[name].fill_(float("nan"))
        call()
        if not torch.isfinite(outputs[name]).all().item():
            raise AssertionError(f"{name}: non-finite or unwritten output")
        torch.testing.assert_close(outputs[name], reference, rtol=1e-5, atol=1e-6)

    measurements = []
    for name, call in calls.items():
        check(name, call)
        measurements.append(benchmark(call, label=name, warmup=warmup, repeat=repeat))
        check(name, call)
    table = summary(measurements)
    if bytes_moved is not None:
        table["logical_GB_s_by_median"] = bytes_moved / table["median_ms"] / 1e6
        table.attrs["bytes_moved_model"] = bytes_moved
    return table


def save_table(chapter: str, table: pd.DataFrame, *, config: dict, kernels=(),
               sources: dict[str, str] | None = None,
               launches: dict[str, dict] | None = None):
    """Save results, raw samples, authored source and actual launch parameters.

    ``sources`` maps implementation names to source strings (for example Triton
    ``kernel.src``); each is stored with SHA-256. ``launches`` maps names to JSON
    dictionaries such as {"BLOCK": 1024, "num_warps": 4, "grid_limit": 32}.
    These are explicit caller-supplied execution settings, not inferred defaults.
    """
    if not isinstance(chapter, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_-]*(?:/[A-Za-z0-9][A-Za-z0-9_-]*)*", chapter
    ):
        raise ValueError("chapter must be a safe relative path")
    if sources is not None and (not isinstance(sources, dict) or any(
        not isinstance(name, str) or not name or not isinstance(source, str) or not source.strip()
        for name, source in sources.items()
    )):
        raise TypeError("sources must map nonempty names to source strings")
    if launches is not None and (not isinstance(launches, dict) or any(
        not isinstance(name, str) or not name or not isinstance(launch, dict)
        for name, launch in launches.items()
    )):
        raise TypeError("launches must map nonempty names to JSON dictionaries")
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ-") + uuid4().hex[:8]
    target = artifact_root() / "experiments" / chapter / run_id
    payload = _json_value({"schema_version": 2, "created_at": datetime.now(timezone.utc).isoformat(),
               "environment": environment(), "config": config,
               "table": table.reset_index().to_dict(orient="records"), "metadata": table.attrs,
               "kernels": [{"name": k.__name__, "source": k.source, "build_id": k.build_id,
                             "source_sha256": hashlib.sha256(k.source.encode()).hexdigest(),
                             "build_config": k.build_config} for k in kernels],
               "sources": {name: {"source": source,
                                  "source_sha256": hashlib.sha256(source.encode()).hexdigest()}
                           for name, source in (sources or {}).items()},
               "launches": launches or {}})
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    target.mkdir(parents=True, exist_ok=False)
    (target / "record.json").write_text(serialized)
    table.to_csv(target / "summary.csv")
    (target / "EXPERIMENT.md").write_text(
        f"# {chapter}\n\n时间：{payload['created_at']}\n\n"
        f"环境：{json.dumps(payload['environment'], ensure_ascii=False)}\n\n"
        "运行：打开对应章节的 Notebook，从第一个代码单元开始依次运行。\n\n"
        f"配置：{json.dumps(payload['config'], ensure_ascii=False)}\n\n"
        f"实际启动参数：{json.dumps(payload['launches'], ensure_ascii=False)}\n\n"
        "其他实现的源码与 SHA-256 保存在 record.json 的 sources 字段。\n\n"
        "结果与每次原始样本见 record.json / summary.csv。计时期间没有 profiler。\n")
    return target


def plot_comparison(table: pd.DataFrame, *, baseline: str | None = None):
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(figsize=(7, 4), layout="constrained")
    axes.barh(table.index.astype(str), table["median_ms"], color="#2f6f83")
    axes.set_xlabel("Median prepared-call latency (ms)")
    axes.invert_yaxis()
    axes.set_title("Same inputs, output allocation and current-stream event timing")
    if baseline is not None:
        axes.axvline(table.loc[baseline, "median_ms"], color="#b35b30", linestyle="--", label=baseline)
        axes.legend()
    return axes


def roofline_references(*, n: int, matrix_size: int = 512, warmup: int = 5, repeat: int = 30):
    """Validated copy and FP32 matrix multiplication on the learner's current GPU."""
    source, _ = inputs(n)
    copy_out = torch.empty_like(source)
    copy = lambda: copy_out.copy_(source)
    copy()
    torch.testing.assert_close(copy_out, source)
    copy_time = benchmark(copy, label="copy_ reference", warmup=warmup, repeat=repeat)
    generator = torch.Generator().manual_seed(0)
    a_cpu = torch.randn(matrix_size, matrix_size, generator=generator)
    b_cpu = torch.randn(matrix_size, matrix_size, generator=generator)
    a, b = a_cpu.cuda(), b_cpu.cuda()
    out = torch.empty_like(a)
    previous_tf32 = torch.backends.cuda.matmul.allow_tf32
    try:
        torch.backends.cuda.matmul.allow_tf32 = False
        mm = lambda: torch.mm(a, b, out=out)
        mm()
        torch.testing.assert_close(out.cpu(), a_cpu @ b_cpu, rtol=1e-3, atol=1e-3)
        mm_time = benchmark(mm, label="FP32 mm reference", warmup=warmup, repeat=repeat)
    finally:
        torch.backends.cuda.matmul.allow_tf32 = previous_tf32
    return {"bandwidth_gbs": 2 * source.numel() * source.element_size() / copy_time.median_ms / 1e6,
            "compute_tflops": 2 * matrix_size**3 / mm_time.median_ms / 1e9,
            "source": "validated copy_ and FP32 mm in this run; workload reference, not device peak",
            "copy": copy_time.to_dict(), "mm": mm_time.to_dict(), "matrix_size": matrix_size,
            "environment": environment()}


def plot_roofline(table: pd.DataFrame, *, flops: int, bytes_moved: int, references: dict):
    import matplotlib.pyplot as plt
    import numpy as np

    ai = flops / bytes_moved
    bw = references["bandwidth_gbs"]
    compute = references["compute_tflops"] * 1000
    if bw <= 0 or compute <= 0:
        raise ValueError("Roofline references must be positive and have a stated source")
    xs = np.geomspace(min(ai / 4, .01), max(100, compute / bw * 4), 200)
    fig, axes = plt.subplots(figsize=(7, 4), layout="constrained")
    axes.loglog(xs, np.minimum(bw * xs, compute), label="Measured workload reference envelope")
    for name, row in table.iterrows():
        axes.scatter(ai, flops / row["median_ms"] / 1e6, label=str(name))
    axes.set_xlabel("Algorithmic arithmetic intensity (FLOP/Byte)")
    axes.set_ylabel("Throughput (GFLOP/s)")
    axes.set_title("Roofline learning plot — references are not physical ceilings")
    axes.grid(which="both", alpha=.2)
    axes.legend(fontsize=8)
    return axes
