"""Trace protocol validation uses fixture CSVs; no profiler or GPU is invoked."""

import json
import os
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from hello_gpu import profiling


@pytest.fixture
def trace_context(tmp_path, monkeypatch):
    monkeypatch.setattr(profiling, "artifact_root", lambda: tmp_path)
    monkeypatch.setattr(profiling, "capabilities", lambda: {
        "available": True, "enabled": True, "rocprofv3": "/fixture/rocprofv3"})
    monkeypatch.setattr(profiling, "environment", lambda: {"gpu": None, "fixture": True})
    return {"display_name": SimpleNamespace(source="fixture HIP source", build_config={
        "entry": "actual_entry", "grid_limit": 8})}


def _completed(monkeypatch, rows, *, code=0):
    def run(command, **kwargs):
        target = Path(command[command.index("--output-directory") + 1])
        assert kwargs["cwd"] == target
        if rows is not None:
            pd.DataFrame(rows).to_csv(target / "fixture_kernel_trace.csv", index=False)
        return SimpleNamespace(returncode=code, stdout="fixture", stderr="")
    monkeypatch.setattr(profiling.subprocess, "run", run)


def test_trace_uses_actual_entry_and_override_launch_config(trace_context, monkeypatch):
    _completed(monkeypatch, [
        {"Kernel_Name": "void actual_entry(float const*, float const*, float*, int)",
         "Start_Timestamp": index * 2000, "End_Timestamp": index * 2000 + 1000}
        for index in range(3)
    ] + [{"Kernel_Name": "void unrelated_actual_entry_helper()", "Start_Timestamp": 0,
          "End_Timestamp": 1}])
    report = profiling.kernel_trace(trace_context, n=4097, block=256, launches=3,
                                    grid_limits={"display_name": 2})
    assert report["status"] == "passed"
    assert report["target_records_by_kernel"] == {"display_name": 3}
    spec = report["input"]["kernels"]["display_name"]
    assert spec["grid_limit"] == 2
    assert spec["build_grid_limit"] == 8
    assert spec["launch"] == {"n": 4097, "block": 256, "grid_limit": 2,
                              "grid_blocks": 2, "launches": 3}
    script = (Path(report["directory"]) / "workload.py").read_text()
    assert 'prepare(a,b,block=p["block"],out=out,grid_limit=spec["grid_limit"])' in script
    assert report["table"]["duration_us"].tolist() == [1.0] * 3


@pytest.mark.parametrize("count", [None, 1])
def test_zero_exit_cannot_pass_with_missing_target_records(trace_context, monkeypatch, count):
    rows = None if count is None else [{"Kernel_Name": "actual_entry", "Start_Timestamp": 0,
                                      "End_Timestamp": 1}] * count
    _completed(monkeypatch, rows)
    report = profiling.kernel_trace(trace_context, n=1024, launches=3)
    assert report["returncode"] == 0
    assert report["status"] == "failed"
    assert "insufficient records" in report["reason"]
    saved = json.loads((Path(report["directory"]) / "report.json").read_text())
    assert saved["status"] == "failed"


def test_trace_can_explicitly_remove_compiled_default_cap(trace_context, monkeypatch):
    _completed(monkeypatch, [{"Kernel_Name": "actual_entry", "Start_Timestamp": 0,
                             "End_Timestamp": 1}])
    report = profiling.kernel_trace(trace_context, n=4097, block=256, launches=1,
                                    grid_limits={"display_name": None})
    assert report["input"]["kernels"]["display_name"]["launch"]["grid_blocks"] == 17


def test_trace_rejects_override_typos(trace_context, monkeypatch):
    monkeypatch.setattr(profiling.subprocess, "run", lambda *a, **k: pytest.fail("must not run"))
    with pytest.raises(ValueError, match="unknown kernel"):
        profiling.kernel_trace(trace_context, n=16, grid_limits={"typo": 1})


def test_trace_child_can_import_checkout_and_preserves_parent_environment(trace_context, monkeypatch):
    existing = os.pathsep.join(("/application/helpers", "/course/shared"))
    monkeypatch.setenv("PYTHONPATH", existing)
    original = dict(os.environ)
    observed = {}

    def run(command, **kwargs):
        observed.update(kwargs["env"])
        target = Path(command[command.index("--output-directory") + 1])
        pd.DataFrame([{"Kernel_Name": "actual_entry", "Start_Timestamp": 0,
                       "End_Timestamp": 1}]).to_csv(target / "fixture_kernel_trace.csv", index=False)
        return SimpleNamespace(returncode=0, stdout="fixture", stderr="")

    monkeypatch.setattr(profiling.subprocess, "run", run)
    report = profiling.kernel_trace(trace_context, n=16, launches=1)
    source = str(Path(profiling.__file__).resolve().parents[1])
    assert report["status"] == "passed"
    assert observed["PYTHONPATH"] == source + os.pathsep + existing
    assert dict(os.environ) == original


def _runtime_fixture(tmp_path):
    root = tmp_path / "site-packages/_rocm_sdk_core"
    (root / "bin").mkdir(parents=True)
    (root / "lib").mkdir()
    (root / "bin/rocprofv3").write_text("#!/usr/bin/env python3\n")
    (root / "lib/librocprofiler-sdk.so.1").write_bytes(b"fixture, not a shared library")
    return root.resolve()


def test_capabilities_select_active_runtime_before_devel_path(tmp_path, monkeypatch):
    from hello_gpu import config
    root = _runtime_fixture(tmp_path)
    monkeypatch.setattr(profiling.sys, "path", [str(root.parent)])
    monkeypatch.setattr(config, "configuration", lambda: {"profiling": {"enabled": True}})
    monkeypatch.delenv("HELLO_GPU_ROCPROFV3", raising=False)
    monkeypatch.setattr(profiling.shutil, "which", lambda name: "/other/_rocm_sdk_devel/bin/rocprofv3")
    caps = profiling.capabilities()
    assert caps["rocprofv3"] == str(root / "bin/rocprofv3")
    assert caps["rocm_root"] == str(root)
    assert caps["library_dirs"] == [str(root / "lib")]


def test_profiler_child_uses_one_sdk_without_mutating_parent(trace_context, tmp_path, monkeypatch):
    root = _runtime_fixture(tmp_path)
    caps = {"available": True, "enabled": True, "rocprofv3": str(root / "bin/rocprofv3"),
            "rocm_root": str(root), "library_dirs": [str(root / "lib")]}
    monkeypatch.setattr(profiling, "capabilities", lambda: caps)
    devel = str(root.parent / "_rocm_sdk_devel")
    monkeypatch.setenv("ROCM_PATH", devel)
    monkeypatch.setenv("HIP_PATH", devel)
    monkeypatch.setenv("LD_LIBRARY_PATH", devel + "/lib:/application/lib")
    monkeypatch.setenv("ROCPROFILER_REGISTER_LIBRARY", devel + "/lib/librocprofiler-sdk.so.1")
    monkeypatch.setenv("LD_PRELOAD", devel + "/lib/librocprofiler-sdk.so.1:/application/libasan.so")
    monkeypatch.setenv("ROCP_TOOL_LIBRARIES", devel + "/lib/rocprofiler-sdk/librocprofiler-sdk-tool.so")
    monkeypatch.setenv("JUPYTER_TOKEN", "must-not-appear-in-report")
    original = dict(os.environ)
    observed = {}
    def run(command, **kwargs):
        observed.update({"command": command, "env": kwargs["env"]})
        target = Path(command[command.index("--output-directory") + 1])
        pd.DataFrame([{"Kernel_Name": "actual_entry", "Start_Timestamp": 0,
                       "End_Timestamp": 1}]).to_csv(target / "fixture_kernel_trace.csv", index=False)
        return SimpleNamespace(returncode=0, stdout="fixture", stderr="")
    monkeypatch.setattr(profiling.subprocess, "run", run)
    report = profiling.kernel_trace(trace_context, n=16, launches=1)
    child = observed["env"]
    assert observed["command"][1:3] == ["--rocm-root", str(root)]
    assert child["LD_LIBRARY_PATH"].split(os.pathsep)[0] == str(root / "lib")
    assert child["ROCPROFILER_REGISTER_LIBRARY"] == str(root / "lib/librocprofiler-sdk.so.1")
    assert child["ROCM_PATH"] == child["HIP_PATH"] == devel
    assert child["LD_PRELOAD"] == "/application/libasan.so"
    assert "ROCP_TOOL_LIBRARIES" not in child
    assert dict(os.environ) == original
    saved = (Path(report["directory"]) / "report.json").read_text()
    assert "must-not-appear-in-report" not in saved
    assert report["profiler"]["registration_library"] == str(root / "lib/librocprofiler-sdk.so.1")
