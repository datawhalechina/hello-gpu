"""Correctness checks must detect missing writes even with reused buffers."""

import hashlib
import json
from types import SimpleNamespace

import pandas as pd
import pytest
import torch

from hello_gpu import learning
from hello_gpu.measurement import Measurement


def _measured(label="test", repeat=1, warmup=0):
    return Measurement(label, (1.0,) * repeat, "CPU test fixture", "cpu", warmup,
                       repeat, 1, "Unit-test data, not an experiment")


def test_compare_rejects_partial_write_after_good_candidate(monkeypatch):
    reference = torch.arange(8, dtype=torch.float32)
    out = reference.clone()
    timed = []
    def measure(call, **kwargs):
        timed.append(kwargs["label"])
        call()
        return _measured(**kwargs)
    monkeypatch.setattr(learning, "benchmark", measure)
    calls = {"good": lambda: out.copy_(reference),
             "partial": lambda: out[:4].copy_(reference[:4])}
    with pytest.raises(AssertionError, match="unwritten"):
        learning.compare(calls, reference=reference, outputs={name: out for name in calls},
                         warmup=0, repeat=1)
    assert timed == ["good"]


def test_compare_rechecks_with_fresh_poison_after_timing(monkeypatch):
    reference = torch.arange(8, dtype=torch.float32)
    out = torch.empty_like(reference)
    count = 0
    def call():
        nonlocal count
        count += 1
        if count < 3:
            out.copy_(reference)
        else:
            out[:4].copy_(reference[:4])
    def measure(fn, **kwargs):
        # The precheck has completed. No poison/fill belongs in this interval.
        torch.testing.assert_close(out, reference)
        fn()
        torch.testing.assert_close(out, reference)
        return _measured(**kwargs)
    monkeypatch.setattr(learning, "benchmark", measure)
    with pytest.raises(AssertionError, match="unwritten"):
        learning.compare({"unstable": call}, reference=reference,
                         outputs={"unstable": out}, warmup=0, repeat=1)
    assert count == 3


def test_compare_rejects_integer_sentinel_ambiguity_before_call():
    reference = torch.arange(8)
    with pytest.raises(TypeError, match="floating-point"):
        learning.compare({"integer": lambda: pytest.fail("must reject before call")},
                         reference=reference, outputs={"integer": reference.clone()})


def test_save_table_keeps_exact_external_source_and_actual_launch(tmp_path, monkeypatch):
    monkeypatch.setattr(learning, "artifact_root", lambda: tmp_path)
    monkeypatch.setattr(learning, "environment", lambda: {"gpu": None, "fixture": True})
    source = "@triton.jit\ndef add(a, b, out, N, BLOCK: tl.constexpr):\n    pass\n"
    launches = {"triton_add": {"BLOCK": 1024, "num_warps": 4, "grid": [2]}}
    table = pd.DataFrame({"median_ms": [1.0]}, index=["triton_add"])
    target = learning.save_table("part2-kernels/chapter8", table, config={"n": 1025},
                                 sources={"triton_add": source}, launches=launches)
    record = json.loads((target / "record.json").read_text())
    assert record["sources"]["triton_add"] == {
        "source": source, "source_sha256": hashlib.sha256(source.encode()).hexdigest()}
    assert record["launches"] == launches
    assert "num_warps" in (target / "EXPERIMENT.md").read_text()


@pytest.mark.parametrize("failure", [False, True])
def test_roofline_restores_tf32_even_when_measurement_fails(monkeypatch, failure):
    monkeypatch.setattr(learning, "inputs", lambda n: (torch.arange(n, dtype=torch.float32), None))
    monkeypatch.setattr(torch.Tensor, "cuda", lambda self: self)
    monkeypatch.setattr(learning, "environment", lambda: {"fixture": True})
    # Replace only the precision-control namespace; no real global backend state
    # is changed by a CPU unit test.
    precision = SimpleNamespace(allow_tf32=True)
    monkeypatch.setattr(torch.backends.cuda, "matmul", precision)
    def measure(fn, *, label, **kwargs):
        if label == "FP32 mm reference":
            assert precision.allow_tf32 is False
            if failure:
                raise RuntimeError("measurement failure fixture")
        fn()
        return _measured(label)
    monkeypatch.setattr(learning, "benchmark", measure)
    if failure:
        with pytest.raises(RuntimeError, match="measurement failure"):
            learning.roofline_references(n=8, matrix_size=4, warmup=0, repeat=1)
    else:
        learning.roofline_references(n=8, matrix_size=4, warmup=0, repeat=1)
    assert precision.allow_tf32 is True
