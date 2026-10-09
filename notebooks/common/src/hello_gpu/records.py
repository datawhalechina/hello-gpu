"""Write one self-contained, immutable experiment record per notebook run."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
from uuid import uuid4

import pandas as pd

from .environment import environment
from .measurement import Measurement
from .paths import artifact_root


def _json_value(value):
    """Normalize supported evidence values without serializing arbitrary objects."""
    if isinstance(value, Measurement):
        return _json_value(value.to_dict())
    if isinstance(value, pd.DataFrame):
        return {
            "rows": _json_value(value.reset_index().to_dict(orient="records")),
            "metadata": _json_value(value.attrs),
        }
    if isinstance(value, Mapping):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_value(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        # Derived bandwidth is undefined if an event rounds down to zero.
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"Cannot save evidence value of type {type(value).__name__}")


def _markdown(record: dict) -> str:
    context = record["environment"]
    config = json.dumps(record["config"], ensure_ascii=False, indent=2, allow_nan=False)
    rows = record["measurements"]
    if isinstance(rows, dict) and "metadata" in rows:
        rows = rows["metadata"].get("measurements", [])
    lines = [
        f"# 实验记录：{record['chapter']}", "",
        f"运行编号：`{record['run_id']}`  ", f"时间（UTC）：{record['created_at']}", "",
        "## 目标", "", str(record["config"].get("goal", "复跑本章 kernel 并记录正确性与测量结果。")), "",
        "## 环境与源码", "",
        f"- GPU：{context.get('gpu', '未记录 GPU')}",
        f"- 系统：{context.get('os', '未记录系统')}",
        f"- PyTorch / HIP：{context.get('torch', '未记录')} / {context.get('hip', '未记录')}",
        f"- CPU：{context.get('cpu', '未记录 CPU')}（逻辑处理器数：{context.get('cpu_logical_count', '未记录')}）",
        f"- CPU 线程：{context.get('cpu_threads', '未记录')}（不推断为单核）",
        f"- kernel：`{record['kernel']['name']}`",
        f"- 源码 SHA-256：`{record['kernel']['source_sha256']}`",
        f"- 构建编号：`{record['kernel']['build_id']}`", "",
        "完整 kernel 源码、构建配置、环境和原始计时样本保存在同目录 `record.json`。", "",
        "## 流程与配置", "", "```json", config, "```", "",
        "## 测量结果", "",
        "| 路径 | Mean (ms) | Median (ms) | Min (ms) | CPU threads |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        lines.append(
            f"| {row['label']} | {row['mean_ms']:.6g} | {row['median_ms']:.6g} | "
            f"{row['min_ms']:.6g} | {row['cpu_threads']} |"
        )
    lines.extend(["", "### 计时边界", ""])
    for row in rows:
        lines.append(f"- {row['label']}（{row['method']}）：{row['boundary']}")
    if record["overhead"] is not None:
        lines.extend(["", "### 小 kernel 调用路径", "",
                      "| 路径 | Mean (μs) |", "| --- | ---: |"])
        for row in record["overhead"]["rows"]:
            lines.append(f"| {row['path']} | {row['mean_us']:.6g} |")
        lines.extend(["", str(record["overhead"]["metadata"]["scope"]), ""])
        for path, boundary in record["overhead"]["metadata"]["boundaries"].items():
            lines.append(f"- {path}：{boundary}")
    lines.extend(["", "这些值来自本次调用；预热和编译不计入样本。有效带宽依赖算法字节量模型，"
                  "不代表物理显存流量。正确性结果和复跑入口由上面的配置明确记录。", ""])
    return "\n".join(lines)


def save_record(chapter: str, *, kernel, config: dict, measurements,
                overhead: pd.DataFrame | None = None) -> Path:
    """Save JSON + Markdown below .artifacts/experiments/<chapter>/<run-id>.

    Pass explicit reproducibility metadata (input shape/dtype, seed, block,
    correctness result and notebook/CLI entry) in config. No environment-variable
    dump, Jupyter URLs or authentication tokens are collected. Timing records
    accept either Measurement objects or a table returned by summary(). Chapter
    may be a safe relative path, for example ``part0-intro/chapter4``.
    """
    if not isinstance(chapter, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9_-]*(?:/[A-Za-z0-9][A-Za-z0-9_-]*)*", chapter
    ):
        raise ValueError("chapter must be a relative path of safe directory names, such as part0-intro/chapter4")
    if not isinstance(config, dict):
        raise TypeError("config must be a dictionary of explicit experiment metadata")
    if not isinstance(kernel.source, str) or not isinstance(kernel.build_id, str):
        raise TypeError("kernel must expose source text and a build_id")
    if isinstance(measurements, pd.DataFrame):
        if not measurements.attrs.get("measurements"):
            raise ValueError("measurement table must come from summary() and retain its attrs")
    else:
        measurements = list(measurements)
        if not measurements or any(not isinstance(value, Measurement) for value in measurements):
            raise ValueError("measurements must contain Measurement objects or a summary() table")
    if overhead is not None and (
        not isinstance(overhead, pd.DataFrame)
        or not {"path", "mean_us"}.issubset(overhead.columns)
        or not {"scope", "boundaries", "samples_us"}.issubset(overhead.attrs)
    ):
        raise ValueError("overhead must be a table from launch_overhead() with its attrs")

    identity_path = Path(kernel.build_directory) / "build_identity.json"
    build_identity = json.loads(identity_path.read_text(encoding="utf-8"))
    created_at = datetime.now(timezone.utc)
    run_id = f"{created_at:%Y%m%dT%H%M%S.%fZ}-{uuid4().hex[:8]}"
    record = _json_value({
        "schema_version": 1,
        "chapter": chapter,
        "run_id": run_id,
        "created_at": created_at.isoformat(),
        "environment": environment(),
        "kernel": {
            "name": kernel.__name__,
            "source": kernel.source,
            "source_sha256": hashlib.sha256(kernel.source.encode("utf-8")).hexdigest(),
            "build_id": kernel.build_id,
            "build_identity": build_identity,
            "compile_seconds": kernel.compile_seconds,
            "cache_hit": kernel.cache_hit,
        },
        "config": config,
        "measurements": measurements,
        "overhead": overhead,
    })
    # Serialize before creating the directory so invalid evidence leaves no
    # misleading partial run. mkdir(exist_ok=False) also prevents overwrites.
    payload = json.dumps(record, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    markdown = _markdown(record)
    destination = artifact_root() / "experiments" / chapter / run_id
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "record.json").write_text(payload, encoding="utf-8")
    (destination / "EXPERIMENT.md").write_text(markdown, encoding="utf-8")
    return destination
