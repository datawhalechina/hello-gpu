"""CPU-only checks of measurement semantics and reproducible evidence output."""

import hashlib
import json
from types import SimpleNamespace

import matplotlib
matplotlib.use("Agg")
import pytest
import torch

from hello_gpu import measurement, records
from hello_gpu.measurement import Measurement, benchmark, benchmark_batch, plot_samples, plot_times, summary


def test_cpu_benchmark_preserves_data_and_counts_calls():
    a = torch.arange(64, dtype=torch.float32)
    b = torch.ones_like(a)
    out = torch.empty_like(a)
    calls = 0

    def add():
        nonlocal calls
        calls += 1
        torch.add(a, b, out=out)

    result = benchmark(add, device="cpu", label="CPU", warmup=2, repeat=4)
    torch.testing.assert_close(out, a + b)
    assert calls == 6
    assert len(result.samples_ms) == 4
    assert all(value >= 0 for value in result.samples_ms)
    assert result.min_ms <= result.median_ms <= max(result.samples_ms)
    assert result.cpu_threads == torch.get_num_threads()
    assert result.stream is None
    assert "CPU" in result.method


def test_cpu_interval_contains_only_callable(monkeypatch):
    ticks = iter([1.0, 1.002, 2.0, 2.004, 3.0, 3.006])
    monkeypatch.setattr(measurement.time, "perf_counter", lambda: next(ticks))
    result = benchmark(lambda: None, device="cpu", warmup=2, repeat=3)
    assert result.samples_ms == pytest.approx((2.0, 4.0, 6.0))
    assert result.mean_ms == pytest.approx(4.0)
    assert result.median_ms == pytest.approx(4.0)


def test_batch_timing_normalizes_samples_and_retains_protocol(monkeypatch):
    ticks = iter([1.0, 1.004, 2.0, 2.008, 3.0, 3.012])
    monkeypatch.setattr(measurement.time, "perf_counter", lambda: next(ticks))
    calls = []
    result = benchmark_batch(lambda: calls.append(None), device="cpu", batch=4,
                             warmup=2, repeat=3, label="batch test")
    assert len(calls) == 4 * (2 + 3)
    assert result.samples_ms == pytest.approx((1.0, 2.0, 3.0))
    assert result.batch_calls == result.to_dict()["batch_calls"] == 4
    assert "not a distribution of individual" in result.boundary
    assert summary([result]).attrs["measurements"][0]["batch_calls"] == 4
    axes = plot_samples(result)
    assert "mean of 4 calls" in axes.get_legend_handles_labels()[1][0]
    import matplotlib.pyplot as plt
    plt.close(axes.figure)


@pytest.mark.parametrize("batch", [0, -1, 1.5, True])
def test_invalid_batch_does_not_run_callable(batch):
    with pytest.raises(ValueError, match="batch"):
        benchmark_batch(lambda: pytest.fail("must reject before execution"), batch=batch, device="cpu")


@pytest.mark.parametrize("kwargs", [
    {"warmup": -1}, {"warmup": True}, {"repeat": 0}, {"repeat": 1.5},
    {"device": "mps"}, {"label": ""},
])
def test_invalid_benchmark_configuration_does_not_call_fn(kwargs):
    def forbidden():
        pytest.fail("invalid configuration must fail before the callable runs")

    with pytest.raises(ValueError):
        benchmark(forbidden, **({"device": "cpu"} | kwargs))


def _measurement(samples=(2.0, 4.0, 6.0), label="CPU"):
    return Measurement(label, tuple(samples), "CPU perf_counter", "cpu", 2, len(samples),
                       torch.get_num_threads(), measurement.CPU_BOUNDARY)


def test_summary_bandwidth_units_and_context():
    result = _measurement()
    table = summary([result], bytes_moved=12_000_000)
    assert table.loc["CPU", "mean_ms"] == 4.0
    assert table.loc["CPU", "effective_GB_s_by_min"] == 6.0
    assert table.attrs["measurements"][0]["samples_ms"] == (2.0, 4.0, 6.0)
    assert table.attrs["measurements"][0]["cpu_threads"] == torch.get_num_threads()
    assert "different timing boundaries" in table.attrs["comparison_boundary"]
    assert "effective_GB_s_by_min" not in summary([result])
    axes = plot_times(table)
    assert "ms" in axes.get_xlabel()
    import matplotlib.pyplot as plt
    plt.close(axes.figure)


def test_median_bandwidth_and_plot_use_the_requested_statistic():
    result = _measurement()
    table = summary([result], bytes_moved=12_000_000, statistic="median_ms")
    assert table.loc["CPU", "effective_GB_s_by_median"] == 3.0
    assert table.attrs["bandwidth_statistic"] == "median_ms"
    axes = plot_times(table, statistic="median_ms")
    assert axes.patches[0].get_width() == 4.0
    assert "Median" in axes.get_xlabel()
    import matplotlib.pyplot as plt
    plt.close(axes.figure)


@pytest.mark.parametrize("size", [0, -1, True, 1.5])
def test_summary_rejects_invalid_traffic_model(size):
    with pytest.raises(ValueError):
        summary([_measurement()], bytes_moved=size)


def test_zero_event_time_is_not_infinite_bandwidth():
    import math
    table = summary([_measurement((0.0, 0.0))], bytes_moved=12)
    assert math.isnan(table.loc["CPU", "effective_GB_s_by_min"])


@pytest.fixture
def record_context(tmp_path, monkeypatch):
    monkeypatch.setenv("HELLO_GPU_ARTIFACTS", str(tmp_path / "artifacts"))
    monkeypatch.setenv("JUPYTER_TOKEN", "must-not-be-collected")
    monkeypatch.setattr(records, "environment", lambda: {
        "gpu": None, "os": "CPU-only test", "torch": str(torch.__version__),
        "cpu": "CPU fixture", "cpu_logical_count": 8,
        "hip": None, "cpu_threads": torch.get_num_threads(),
    })
    build = tmp_path / "build"
    build.mkdir()
    (build / "build_identity.json").write_text(json.dumps({
        "preset": "binary_f32", "flags": ["-O3"], "architecture": "test-fixture",
    }))
    return SimpleNamespace(
        __name__="vector_add", source="fixture source, not an executed kernel", build_id="test-build",
        build_directory=build, compile_seconds=0.0, cache_hit=True,
    )


@pytest.mark.parametrize("use_table", [False, True])
@pytest.mark.parametrize("chapter", ["chapter4", "part0-intro/chapter4"])
def test_record_contains_source_raw_samples_and_unique_run(record_context, use_table, chapter):
    values = [_measurement()]
    data = summary(values, bytes_moved=12_000_000) if use_table else values
    config = {"shape": [64], "dtype": "float32", "block": 256, "correctness": "unit test fixture"}
    first = records.save_record(chapter, kernel=record_context, config=config, measurements=data)
    second = records.save_record(chapter, kernel=record_context, config=config, measurements=data)
    assert first != second
    assert first.parent.name == "chapter4"
    assert first.parent.relative_to(records.artifact_root() / "experiments").as_posix() == chapter
    contents = (first / "record.json").read_text()
    parsed = json.loads(contents)
    assert parsed["kernel"]["source"] == record_context.source
    assert parsed["kernel"]["source_sha256"] == hashlib.sha256(record_context.source.encode()).hexdigest()
    assert parsed["kernel"]["build_identity"]["flags"] == ["-O3"]
    assert "must-not-be-collected" not in contents
    measurements = parsed["measurements"]["metadata"]["measurements"] if use_table else parsed["measurements"]
    assert measurements[0]["samples_ms"] == [2.0, 4.0, 6.0]
    markdown = (first / "EXPERIMENT.md").read_text()
    assert "CPU perf_counter" in markdown
    assert "CPU fixture（逻辑处理器数：8）" in markdown
    assert f"CPU 线程：{torch.get_num_threads()}" in markdown


@pytest.mark.parametrize("chapter", [
    "/chapter4", "../escape", "part0-intro/../escape", "part0-intro//chapter4",
    "part0-intro/", "", "./chapter4", "part0-intro/./chapter4", "C:/chapter4",
    "part0-intro\\chapter4",
])
def test_record_rejects_unsafe_relative_paths(record_context, chapter):
    with pytest.raises(ValueError, match="relative path"):
        records.save_record(chapter, kernel=record_context, config={}, measurements=[_measurement()])


def test_record_rejects_path_escape_and_missing_evidence(record_context):
    with pytest.raises(ValueError, match="directory name"):
        records.save_record("../escape", kernel=record_context, config={}, measurements=[_measurement()])
    with pytest.raises(ValueError, match="Measurement"):
        records.save_record("chapter4", kernel=record_context, config={}, measurements=[])
    with pytest.raises(TypeError, match="evidence"):
        records.save_record("chapter4", kernel=record_context, config={"bad": object()}, measurements=[_measurement()])
