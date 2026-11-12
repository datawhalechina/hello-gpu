"""实验室接口在没有 GPU 的机器上能验证的部分。

设备属性、rocminfo 和峰值测量换成伪造数据；这些读数在真卡上对不对，留给 R-01 验证。
"""

from collections import Counter
import itertools
import json
import sys
import time

import numpy as np
import pytest
import torch
from torch.autograd import DeviceType
from torch.autograd.profiler_util import EventList, FunctionEvent

import hello_gpu as hg
from hello_gpu import codes, lab, stars
from hello_gpu.measurement import Measurement

FAKE = {"name": "Fixture GPU", "gfx": "gfx9999", "cus": 10, "wave": 32, "memory_bytes": 1 << 30}
ROCMINFO = """\
*******
Agent 1
*******
  Name:                    Fixture CPU
  Device Type:             CPU
  Compute Unit:            16
*******
Agent 2
*******
  Name:                    gfx9999
  Marketing Name:          Fixture GPU
  Device Type:             GPU
  Compute Unit:            10
  Wavefront Size:          32(0x20)
  ISA Info:
    ISA 1
      Name:                    amdgcn-amd-amdhsa--gfx9999
"""


@pytest.fixture
def artifacts(tmp_path, monkeypatch):
    monkeypatch.setenv("HELLO_GPU_ARTIFACTS", str(tmp_path / "artifacts"))
    return tmp_path / "artifacts"


@pytest.fixture
def fake_gpu(monkeypatch, artifacts):
    monkeypatch.setattr(lab, "_require_gpu", lambda caller: None)
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE))
    monkeypatch.setattr(lab, "_run_rocminfo", lambda: None)
    return artifacts


def _timing(label, *samples):
    measured = Measurement(label, samples, "fixture", "cpu", 0, len(samples), 1, "unit-test data")
    ordered = sorted(samples)
    return lab.Timing(label, measured.median_ms, lab._quantile(ordered, 0.1),
                      lab._quantile(ordered, 0.9), samples, measured)


# ---------------------------------------------------------------- 没有 GPU

@pytest.mark.parametrize("hip,hint", [(None, "不是 ROCm 版"), ("fixture", "看不到 GPU")])
@pytest.mark.parametrize("name,call", [
    ("hg.device_card()", lambda: hg.device_card()),
    ("hg.peak()", lambda: hg.peak()),
    ("hg.bench()", lambda: hg.bench(lambda: None)),
    ("hg.check()", lambda: hg.check(torch.add, torch.add, [8], inputs=2)),
    ("hg.compare()", lambda: hg.compare({"torch": lambda: None})),
    ("hg.submit()", lambda: hg.submit("forge-softmax", "hip", checks={"passed": 1, "total": 1},
                                      metrics={"median_ms": 1.0})),
    ("hg.check_card()", lambda: hg.check_card({"cus": 10, "wave": 32, "memory_gib": 1.0})),
    ("hg.race()", lambda: hg.race(8)),
    ("hg.check_timer()", lambda: hg.check_timer(lambda fn: 0.0)),
    ("hg.warm_cold()", lambda: hg.warm_cold(lambda: None)),
    ("hg.roofline()", lambda: hg.roofline({"add": (lambda: None, 1, 12)})),
    ("hg.trace()", lambda: hg.trace({"mlp": lambda: None})),
])
def test_gpu_functions_explain_a_missing_gpu_in_chinese(monkeypatch, artifacts, name, call, hip, hint):
    monkeypatch.setattr(torch.version, "hip", hip)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    with pytest.raises(RuntimeError, match="需要 AMD GPU") as caught:
        call()
    assert str(caught.value).startswith(name)
    assert hint in str(caught.value)


# ---------------------------------------------------------------- check

def test_check_passes_every_shape_form_and_labels_them(capsys):
    report = hg.check(torch.add, torch.add, [1, 1000, (3, 17), ()], inputs=2, device="cpu")
    assert [case.shape for case in report.cases] == ["1", "1000", "3×17", "标量"]
    assert (report.passed, report.total, report.all_passed) == (4, 4, True)
    matmul = hg.check(torch.mm, torch.mm, [[(4, 3), (3, 2)]], device="cpu")
    assert matmul.cases[0].shape == "4×3, 3×2" and matmul.all_passed
    assert "通过 1/1" in capsys.readouterr().out


def test_check_finds_an_output_left_over_from_the_previous_call():
    # 像没写输出的 kernel：拿到的缓冲区里碰巧还是上一次的正确结果
    previous = {}

    def stale(x):
        previous.setdefault("out", torch.softmax(x, dim=-1))
        return previous["out"]

    report = hg.check(stale, lambda x: torch.softmax(x, dim=-1), [(4, 8)], device="cpu")
    assert report.passed == 0
    assert report.cases[0].reason.startswith("换一组随机数后")


def test_check_counts_unwritten_elements_and_keeps_going_after_errors():
    def partial(a, b):
        out = a + b
        out[-1] = 0.0  # 最后一个元素没写
        return out

    def fails_on_big(a, b):
        if a.numel() > 100:
            raise ValueError("block too large")
        return a + b

    report = hg.check(partial, torch.add, [1000], inputs=2, device="cpu")
    assert "1/1000 个元素超出误差" in report.cases[0].reason
    report = hg.check(fails_on_big, torch.add, [1000, 10], inputs=2, device="cpu")
    assert [case.passed for case in report.cases] == [False, True]
    assert report.cases[0].reason == "运行出错：ValueError: block too large"


@pytest.mark.parametrize("fn,reason", [
    (lambda x: x.double() * 2, "类型"),
    (lambda x: (x * 2)[:-1], "形状"),
    (lambda x: float((x * 2).sum()), "不是 Tensor"),
    (lambda x: (x * 2, x), "输出有 2 个"),
])
def test_check_explains_wrong_outputs(fn, reason):
    report = hg.check(fn, lambda x: x * 2, [16], device="cpu")
    assert reason in report.cases[0].reason


def test_check_tolerance_defaults_follow_dtype_and_can_be_set():
    double = lambda x: x * 2  # noqa: E731
    near = lambda x: x * 2 + 1e-6  # noqa: E731
    assert hg.check(near, double, [64], device="cpu").all_passed  # float32 默认 atol = 1e-5
    assert not hg.check(near, double, [64], dtype=torch.float64, device="cpu").all_passed  # float64 是 1e-7
    far = lambda x: x * 2 + 1e-4  # noqa: E731
    assert not hg.check(far, double, [64], device="cpu").all_passed
    assert hg.check(far, double, [64], atol=1e-3, rtol=0, device="cpu").all_passed


@pytest.mark.parametrize("shapes,kwargs,error", [
    (1000, {}, TypeError),
    ([-1], {}, ValueError),
    ([(2, 2.5)], {}, ValueError),
    ([True], {}, ValueError),
    ([], {}, ValueError),
    ([[(4, 3), (3, 2)]], {"inputs": 2}, ValueError),
    ([8], {"atol": 1e-3}, ValueError),
    ([8], {"dtype": torch.int32}, TypeError),
    ([8], {"guard": 1}, TypeError),
])
def test_check_rejects_unclear_arguments_before_running(shapes, kwargs, error):
    with pytest.raises(error):
        hg.check(lambda x: pytest.fail("must not run"), lambda x: x, shapes, device="cpu", **kwargs)


def test_check_inputs_are_reproducible_and_differ_between_rounds():
    seen = []
    hg.check(lambda x: seen.append(x.clone()) or x, lambda x: x, [5], seed=7, device="cpu")
    hg.check(lambda x: seen.append(x.clone()) or x, lambda x: x, [5], seed=7, device="cpu")
    assert torch.equal(seen[0], seen[2]) and torch.equal(seen[1], seen[3])
    assert not torch.equal(seen[0], seen[1])


# ---------------------------------------------------------------- check(guard=True)

def _without_bounds_check(block):
    """像没写边界检查的 kernel：线程按 block 个一组派，最后一组多出来的线程照样读写。"""
    def kernel(a, b, out):
        total = -(-a.numel() // block) * block  # 组数向上取整，乘每组的线程数
        reach = lambda t: torch.as_strided(t, (total,), (1,))  # noqa: E731  从 t 的开头往后数 total 个元素
        reach(out).copy_(reach(a) + reach(b))
        return out
    return kernel


def test_check_guard_passes_a_function_that_writes_only_into_out(capsys):
    report = hg.check(lambda a, b, out: torch.add(a, b, out=out), torch.add, [1, 1000, (3, 17), ()],
                      inputs=2, guard=True, device="cpu")
    assert report.all_passed
    assert f"输出前后各留 {lab.GUARD_ELEMENTS} 个元素的护栏" in capsys.readouterr().out


def test_check_guard_catches_writes_past_the_output_when_the_length_is_off_the_block_size():
    report = hg.check(_without_bounds_check(256), torch.add, [1, 255, 256, 1000, 1024], inputs=2,
                      guard=True, device="cpu")
    assert [case.passed for case in report.cases] == [False, False, True, False, True]
    assert report.cases[0].reason == "越界写：输出后面 255 个位置被改写了，kernel 写到了输出外面"
    assert "后面 24 个位置" in report.cases[3].reason  # 4 组共 1024 个线程，比 1000 多 24 个


def test_check_guard_catches_writes_before_the_output():
    def shifted(a, b, out):  # 下标整体往前错了 3 个
        torch.as_strided(out, (a.numel(),), (1,), out.storage_offset() - 3).copy_(a + b)
        return out

    report = hg.check(shifted, torch.add, [100], inputs=2, guard=True, device="cpu")
    assert report.cases[0].reason.startswith("越界写：输出前面 3 个位置被改写了")


def test_check_guard_reports_elements_left_unwritten():
    def half(a, b, out):
        n = a.numel() // 2
        out[:n] = a[:n] + b[:n]
        return out

    report = hg.check(half, torch.add, [1000], inputs=2, guard=True, device="cpu")
    assert report.cases[0].reason == "有 500/1000 个元素没写到（还是 hg.check 事先填的值）"
    report = hg.check(lambda a, b, out: a + b, torch.add, [1000], inputs=2, guard=True, device="cpu")
    assert "fn 返回了另一个 Tensor，结果要写进传给它的 out" in report.cases[0].reason


def test_check_guard_explains_a_function_without_out():
    report = hg.check(lambda a, b: a + b, torch.add, [8], inputs=2, guard=True, device="cpu")
    assert report.cases[0].reason == "fn 不接受 out：guard=True 时 hg.check 用 fn(*输入, out=输出) 调用"


@pytest.mark.parametrize("ref", [lambda a: (a, a), lambda a: a.to(torch.int32)])
def test_check_guard_needs_one_floating_point_output(ref):
    with pytest.raises(TypeError, match="guard=True"):
        hg.check(lambda a, out: out.copy_(a), ref, [8], guard=True, device="cpu")


# ---------------------------------------------------------------- bench

def test_bench_uses_the_shared_protocol_and_linear_percentiles(tmp_path, monkeypatch, capsys):
    config = tmp_path / "config.toml"
    config.write_text("[experiment]\nwarmup = 2\nrepeat = 10\n", encoding="utf-8")
    monkeypatch.setenv("HELLO_GPU_CONFIG", str(config))
    calls = []

    def measure(fn, **kwargs):
        calls.append(kwargs)
        samples = (5.0, 1.0, 9.0, 3.0, 7.0, 2.0, 10.0, 4.0, 8.0, 6.0)
        return Measurement(kwargs["label"], samples, "fixture", "cpu", kwargs["warmup"], kwargs["repeat"],
                           1, "unit-test data")

    monkeypatch.setattr(lab, "benchmark", measure)
    timing = hg.bench(lambda: None, label="mine", device="cpu")
    assert (calls[0]["warmup"], calls[0]["repeat"]) == (2, 10)  # 不写时用 config.toml 的 [experiment]
    assert (timing.median_ms, timing.p10_ms, timing.p90_ms) == pytest.approx((5.5, 1.9, 9.1))
    assert timing.samples_ms[:3] == (5.0, 1.0, 9.0)  # 保留执行顺序
    assert "中位数 5.5 ms" in capsys.readouterr().out
    assert lab._quantile([0.25], 0.1) == lab._quantile([0.25], 0.9) == 0.25


def test_bench_times_a_real_callable_on_cpu():
    timing = hg.bench(lambda: sum(range(100)), warmup=1, repeat=5, device="cpu")
    assert len(timing.samples_ms) == 5
    assert timing.p10_ms <= timing.median_ms <= timing.p90_ms


# ---------------------------------------------------------------- compare

def test_compare_table_metrics_and_stars_agree(capsys):
    table = hg.compare({"torch": _timing("torch", 2.0), "HIP v1": _timing("HIP v1", 4.0),
                        "mine": _timing("mine", 1.0)},
                       bytes_moved=4_000_000, flops=2_000_000, peak={"gbps": 8.0, "tflops": 4.0})
    mine = table.table.loc["mine"]
    assert mine["gbps"] == pytest.approx(4.0)
    assert mine["gbps_of_peak"] == pytest.approx(0.5)
    assert mine["tflops"] == pytest.approx(0.002)
    assert mine["speedup"] == pytest.approx(2.0)
    assert table.table.loc["HIP v1", "speedup"] == pytest.approx(0.5)
    metrics = table.metrics("mine")
    assert metrics == pytest.approx({"median_ms": 1.0, "p10_ms": 1.0, "p90_ms": 1.0, "gbps": 4.0,
                                     "peak_gbps": 8.0, "tflops": 0.002, "peak_tflops": 4.0, "torch_ms": 2.0})
    rules = [{"text": "带宽到峰值的 60%", "rule": {"ratio": ["gbps", "peak_gbps"], "gte": 0.6}},
             {"text": "比 torch 快", "rule": {"ratio": ["torch_ms", "median_ms"], "gte": 1.0}}]
    assert stars.evaluate(rules, {"checks": {"passed": 1, "total": 1}, "metrics": metrics}) == [False, True]
    out = capsys.readouterr().out
    assert "相对 torch" in out and "50.0%" in out


def test_compare_baseline_and_missing_peak(artifacts, capsys):
    table = hg.compare({"naive": _timing("naive", 3.0), "mine": _timing("mine", 1.5)}, bytes_moved=3_000_000)
    assert table.baseline == "naive"
    assert table.table.loc["mine", "speedup"] == pytest.approx(2.0)
    assert "gbps_of_peak" not in table.table
    assert "peak_gbps" not in table.metrics("mine")
    assert table.metrics("mine")["naive_ms"] == 3.0
    assert "hg.peak()" in capsys.readouterr().out
    with pytest.raises(ValueError, match="基线"):
        hg.compare({"mine": _timing("mine", 1.0)}, baseline="torch")
    with pytest.raises(KeyError):
        table.metrics("torch")


# ---------------------------------------------------------------- submit

def test_submit_saves_the_credential_and_links_to_the_configured_site(fake_gpu, tmp_path, monkeypatch, capsys):
    config = tmp_path / "config.toml"
    config.write_text('[lab]\nsite = "https://example.org/hg/"\n', encoding="utf-8")
    monkeypatch.setenv("HELLO_GPU_CONFIG", str(config))
    report = lab.CheckReport((lab.CheckCase("8", True, 0.0), lab.CheckCase("9", False, None, "坏了")))
    result = hg.submit("forge-softmax", "triton", checks=report,
                       metrics={"median_ms": 0.5, "torch_ms": 0.6})
    saved = json.loads(result.path.read_text(encoding="utf-8"))
    assert saved == result.credential
    assert result.path.parent == fake_gpu / "lab" / "forge-softmax"
    assert codes.decode(result.code, stage="forge-softmax") == (codes.CREDENTIAL, saved)
    assert result.link == f"https://example.org/hg/forge/softmax/#lab={result.code}"
    assert list(saved) == ["v", "stage", "route", "at", "device", "env", "checks", "metrics"]
    assert saved["device"] == {"name": "Fixture GPU", "gfx": "gfx9999", "cus": 10}
    assert saved["checks"] == {"passed": 1, "total": 2}
    out = capsys.readouterr().out
    assert result.link in out and "2-9" in out


def test_submit_links_gpu_dungeons_and_works_outside_the_repository(fake_gpu, monkeypatch):
    checks, metrics = {"passed": 1, "total": 1}, {"median_ms": 1.0}
    dungeon = hg.submit("dungeon-spmv", "hip", checks=checks, metrics=metrics)
    assert dungeon.link.startswith(f"{lab.DEFAULT_SITE}/dungeon/spmv/#lab=HGPU1.")
    monkeypatch.setattr(lab, "_repo_file", lambda *parts: None)  # 例如装成 wheel：没有 outline.json
    elsewhere = hg.submit("trial-gemm-tiling", "hip", checks=checks, metrics=metrics)
    assert "/trial/gemm-tiling/#lab=" in elsewhere.link


@pytest.mark.parametrize("stage,route,message", [
    ("forge-softmax", "shared", "split"),
    ("forge-roofline", "hip", "shared"),
    ("novice-thousand-additions", "shared", "不是真卡关卡"),
    ("forge-no-such-stage", "hip", "没有关卡"),
    ("Forge_Softmax", "hip", "写法不对"),
    ("forge-softmax", "cuda", "路线只能是"),
])
def test_submit_rejects_a_wrong_stage_or_route_before_using_the_gpu(stage, route, message):
    with pytest.raises(ValueError, match=message):
        hg.submit(stage, route, checks={"passed": 1, "total": 1}, metrics={"median_ms": 1.0})


@pytest.mark.parametrize("checks,metrics", [
    ({"passed": 2, "total": 1}, {"median_ms": 1.0}),
    ({"passed": 0, "total": 0}, {"median_ms": 1.0}),
    ({"passed": 1.5, "total": 2}, {"median_ms": 1.0}),
    ({"passed": 1, "total": 1}, {"median_ms": 0}),
    ({"passed": 1, "total": 1}, {"median_ms": float("nan")}),
    ({"passed": 1, "total": 1}, {"median_ms": float("inf")}),
    ({"passed": 1, "total": 1}, {"median_ms": True}),
    ({"passed": 1, "total": 1}, {"median_ms": "0.1"}),
    ({"passed": 1, "total": 1}, {"Median": 0.1}),
])
def test_submit_rejects_data_the_page_would_reject(checks, metrics):
    with pytest.raises(ValueError):
        hg.submit("forge-softmax", "hip", checks=checks, metrics=metrics)


@pytest.mark.parametrize("section", ['site = "ftp://example.org"', 'site = "https://x.org/?a=1"', 'sites = "x"'])
def test_submit_rejects_a_bad_site_setting(tmp_path, monkeypatch, section):
    config = tmp_path / "config.toml"
    config.write_text(f"[lab]\n{section}\n", encoding="utf-8")
    monkeypatch.setenv("HELLO_GPU_CONFIG", str(config))
    with pytest.raises(ValueError, match="lab"):
        hg.submit("forge-softmax", "hip", checks={"passed": 1, "total": 1}, metrics={"median_ms": 1.0})


# ---------------------------------------------------------------- peak 与 GPU 卡片

def test_peak_is_measured_once_per_card_then_read_from_cache(fake_gpu, monkeypatch):
    measured = []

    def measure(device):
        measured.append(device["cus"])
        return {"v": 1, "device": lab._identity(device), "env": {}, "at": "2026-11-08T10:00:00Z",
                "gbps": 600.0, "tflops": 40.0}

    monkeypatch.setattr(lab, "_measure_peak", measure)
    assert hg.peak() == hg.peak() == {"gbps": 600.0, "tflops": 40.0}
    assert measured == [10]
    hg.peak(refresh=True)
    assert measured == [10, 10]
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE, cus=20))  # 另一张卡不用这张卡的缓存
    hg.peak()
    assert measured == [10, 10, 20]
    lab._peak_path(FAKE).write_text("{坏掉的缓存", encoding="utf-8")
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE))
    hg.peak()
    assert measured == [10, 10, 20, 10]


def test_rocminfo_parsing_keeps_top_level_gpu_fields():
    agents = lab._parse_rocminfo(ROCMINFO)
    assert len(agents) == 1
    assert agents[0]["Name"] == "gfx9999"
    assert agents[0]["Wavefront Size"] == "32(0x20)"
    assert lab._match_agent(FAKE, ROCMINFO) == agents[0]
    assert lab._match_agent(dict(FAKE, gfx="gfx0"), ROCMINFO) is None


def test_device_card_uses_rocminfo_and_cached_peak(fake_gpu, monkeypatch, capsys):
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE, wave=None))  # PyTorch 没给 wave 大小
    monkeypatch.setattr(lab, "_run_rocminfo", lambda: ROCMINFO)
    card = hg.device_card()
    assert card["wave"] == 32 and card["peak_gbps"] is None
    prefix, payload = codes.decode(card["code"])
    assert prefix == codes.CARD and payload["device"] == FAKE and "peak" not in payload
    assert "CU 数和 wave 大小和上面一致" in capsys.readouterr().out

    monkeypatch.setattr(lab, "_measure_peak", lambda device: {
        "v": 1, "device": lab._identity(device), "env": {}, "at": "2026-11-08T10:00:00Z",
        "gbps": 600.0, "tflops": 40.0})
    hg.peak()
    monkeypatch.setattr(lab, "_run_rocminfo", lambda: ROCMINFO.replace("Compute Unit:            10", "Compute Unit:            12"))
    card = hg.device_card()
    assert codes.decode(card["code"])[1]["peak"] == {"gbps": 600.0, "tflops": 40.0}
    assert "CU 数 12（上面是 10）" in capsys.readouterr().out


class _Props:
    """torch.cuda.get_device_properties 的替身：PyTorch 在 ROCm 上报的几项。"""

    def __init__(self, gfx: str, reported: int):
        self.name = " Fixture GPU "
        self.gcnArchName = f"{gfx}:sramecc+:xnack-"
        self.multi_processor_count = reported
        self.warp_size = 32
        self.total_memory = 1 << 30


@pytest.mark.parametrize("gfx,reported,flag,cus", [
    ("gfx1201", 32, None, 64),  # RDNA4：multi_processor_count 数的是 WGP
    ("gfx1100", 48, None, 96),  # RDNA3
    ("gfx1151", 20, None, 40),  # RDNA3.5
    ("gfx1030", 36, None, 72),  # RDNA2
    ("gfx1201", 64, "0", 64),  # GPU_ENABLE_WGP_MODE 关掉以后按计算单元报
    ("gfx1201", 64, "false", 64),  # clr 只认 true 和非零整数
    ("gfx1201", 32, "true", 64),
    ("gfx942", 304, None, 304),  # CDNA 没有 WGP
    ("gfx90a", 104, None, 104),
    ("gfx1250", 64, None, 64),  # gfx12.5 起不进 WGP 模式
    ("gfx9999", 10, None, 10),  # 不认识的架构照原样
])
def test_device_counts_compute_units_not_wgps(monkeypatch, gfx, reported, flag, cus):
    if flag is None:
        monkeypatch.delenv("GPU_ENABLE_WGP_MODE", raising=False)
    else:
        monkeypatch.setenv("GPU_ENABLE_WGP_MODE", flag)
    monkeypatch.setattr(lab.torch.cuda, "current_device", lambda: 0)
    monkeypatch.setattr(lab.torch.cuda, "get_device_properties", lambda index: _Props(gfx, reported))
    assert lab._device() == {"name": "Fixture GPU", "gfx": gfx, "cus": cus, "wave": 32, "memory_bytes": 1 << 30}


def test_device_card_explains_the_wgp_count(fake_gpu, monkeypatch, capsys):
    monkeypatch.delenv("GPU_ENABLE_WGP_MODE", raising=False)
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE, gfx="gfx1201", cus=64))
    card = hg.device_card()
    assert codes.decode(card["code"])[1]["device"]["cus"] == 64
    assert "CU 数：64（PyTorch 的 multi_processor_count 是 32" in capsys.readouterr().out


# ---------------------------------------------------------------- 开工准备（2-1）：check_env

GUIDE = "https://datawhalechina.github.io/hello-gpu/handbook/setup/"


@pytest.fixture
def ready_machine(monkeypatch, artifacts):
    """伪造一台一切正常的 ROCm 机器：PyTorch 2.13.0+rocm10.0.0，ROCm SDK 10.0.0，两条路线的工具都在。"""
    monkeypatch.setattr(torch.version, "hip", "7.15.26333")
    monkeypatch.setattr(torch, "__version__", "2.13.0+rocm10.0.0")
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "device_count", lambda: 1)
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE))
    monkeypatch.setattr(lab, "_probe_gpu", lambda: None)
    monkeypatch.setattr(lab, "_rocm_version", lambda: "10.0.0")
    monkeypatch.setattr(lab, "_hip_tools", lambda: ("/opt/rocm", "/opt/rocm/bin/hipcc", True))
    monkeypatch.setattr(lab, "_build_tools", lambda: ("/usr/bin/gcc", "/usr/bin/c++", "/usr/include/python3.12"))
    monkeypatch.setattr(lab, "_triton_version", lambda: "3.8.0")


def _statuses(items):
    return [item.status for item in items]


def test_check_env_passes_on_a_ready_machine(ready_machine):
    report = hg.check_env()
    assert report.ok and _statuses(report.items) == ["ok"] * 6


def test_check_env_stops_on_a_cpu_build_and_points_to_the_guide(monkeypatch, artifacts, capsys):
    monkeypatch.setattr(torch.version, "hip", None)
    with pytest.raises(RuntimeError, match="PyTorch 是 ROCm 版"):
        hg.check_env()
    assert f"{GUIDE}#troubleshooting" in capsys.readouterr().out
    assert _statuses(lab._env_items()) == ["fail"] + ["skip"] * 5


def test_check_env_without_a_visible_gpu_still_checks_versions_and_tools(ready_machine, monkeypatch):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert _statuses(lab._env_items()) == ["ok", "fail", "skip", "ok", "ok", "ok"]
    with pytest.raises(RuntimeError, match="看得到 GPU"):
        hg.check_env()


def test_check_env_blames_missing_gpu_code_for_this_card(ready_machine, monkeypatch):
    monkeypatch.setattr(lab, "_probe_gpu", lambda: "RuntimeError: HIP error: invalid device function")
    item = lab._env_items()[2]
    assert item.status == "fail" and "invalid device function" in item.detail
    assert "gfx9999" in item.hint and item.link == f"{GUIDE}#local"
    with pytest.raises(RuntimeError, match="GPU 算得对"):
        hg.check_env()


@pytest.mark.parametrize("built,installed,status", [
    ("2.13.0+rocm10.0.0", "10.0.0", "ok"),
    ("2.5.1+rocm6.2", "6.2.4-120", "ok"),  # 只比主版本和次版本
    ("2.5.1+rocm6.2", "6.4.1-120", "warn"),
    ("2.13.0+rocm10.0.0", None, "warn"),  # 没找到 ROCm SDK
    ("2.13.0a0+gitabcdef", "10.0.0", "skip"),  # 版本号里没写为哪版 ROCm 编译
])
def test_check_env_compares_rocm_major_and_minor_versions(ready_machine, monkeypatch, built, installed, status):
    monkeypatch.setattr(torch, "__version__", built)
    monkeypatch.setattr(lab, "_rocm_version", lambda: installed)
    item = hg.check_env().items[3]  # 版本对不上只是提醒，不抛
    assert item.status == status
    assert item.link == (f"{GUIDE}#local" if status == "warn" else None)


def test_check_env_only_warns_about_the_route_tools(ready_machine, monkeypatch):
    monkeypatch.setattr(lab, "_hip_tools", lambda: (None, None, False))
    monkeypatch.setattr(lab, "_triton_version", lambda: None)
    report = hg.check_env()
    assert report.ok and _statuses(report.items)[3:] == ["ok", "warn", "warn"]
    assert "hipcc" in report.items[4].detail and "ninja" in report.items[4].detail


def test_check_env_warns_when_the_routes_cannot_compile(ready_machine, monkeypatch):
    # R-01 在真卡上碰到过：系统自带的 Python 没装开发头文件，hipcc、ninja、Triton 都在，%%hip、Triton 第一次启动和
    # hg.peak() 却都编译失败（找不到 Python.h）。
    monkeypatch.setattr(lab, "_build_tools", lambda: (None, None, None))
    report = hg.check_env()
    assert report.ok and _statuses(report.items)[4:] == ["warn", "warn"]
    hip, triton = report.items[4:]
    assert "C++ 编译器" in hip.detail and "Python.h" in hip.detail and "hipcc" not in hip.detail
    assert "build-essential" in hip.hint and hip.link == f"{GUIDE}#local"
    release = f"{sys.version_info.major}.{sys.version_info.minor}"
    assert "C 编译器" in triton.detail and f"python{release}-dev" in triton.hint
    monkeypatch.setattr(lab, "_build_tools", lambda: ("/usr/bin/gcc", "/usr/bin/c++", None))
    assert [item.detail for item in lab._env_items()[4:]] == ["没找到 Python.h", "Triton 3.8.0，但没找到 Python.h"]


# ---------------------------------------------------------------- check_card

def test_check_card_accepts_the_three_numbers_of_this_card(fake_gpu):
    report = hg.check_card({"cus": 10, "wave": 32, "memory_gib": 1.0})
    assert (report.passed, report.total) == (3, 3)
    # 显存按 GiB 保留一位小数核对：差不超过 0.05 GiB 算对
    assert hg.check_card({"cus": 10.0, "wave": 32, "memory_gib": 1.05}).passed == 3
    assert hg.check_card({"cus": 10, "wave": 32, "memory_gib": 1.06}).passed == 2


@pytest.mark.parametrize("mine,field,reason", [
    ({"cus": 32, "wave": 32, "memory_gib": 15.0}, 0, "WGP"),  # gfx1201：multi_processor_count 数的是 WGP
    ({"cus": 64, "wave": 64, "memory_gib": 15.0}, 1, "Wavefront Size"),
    ({"cus": 64, "wave": 32, "memory_gib": 16.1}, 2, "GB"),  # 按 1000 进位算成了 GB
    ({"cus": 64, "wave": 32, "memory_gib": 16}, 2, "2³⁰"),
    ({"cus": ..., "wave": None}, 0, "还没填"),
    ({"cus": "64", "wave": 32, "memory_gib": 15.0}, 0, "正整数"),
    ({"cus": 64, "wave": True, "memory_gib": 15.0}, 1, "正整数"),
])
def test_check_card_says_what_is_wrong(fake_gpu, monkeypatch, mine, field, reason):
    monkeypatch.delenv("GPU_ENABLE_WGP_MODE", raising=False)
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE, gfx="gfx1201", cus=64, memory_bytes=15 << 30))
    report = hg.check_card(mine)
    case = report.cases[field]
    assert not case.passed and reason in case.reason
    assert report.passed < report.total


def test_check_card_rejects_unclear_arguments(fake_gpu):
    with pytest.raises(ValueError, match="不认识：memory"):
        hg.check_card({"cus": 10, "wave": 32, "memory": 1.0})
    with pytest.raises(TypeError):
        hg.check_card([10, 32, 1.0])


def test_check_card_takes_the_wave_size_from_rocminfo_when_pytorch_has_none(fake_gpu, monkeypatch):
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE, wave=None))
    monkeypatch.setattr(lab, "_run_rocminfo", lambda: ROCMINFO)
    assert hg.check_card({"cus": 10, "wave": 32, "memory_gib": 1.0}).passed == 3


# ---------------------------------------------------------------- race

@pytest.fixture
def cpu_race(monkeypatch):
    """没有 GPU：hg.race() 里「GPU」那两种也在 CPU 上算。"""
    monkeypatch.setattr(lab, "_require_gpu", lambda caller: None)
    monkeypatch.setattr(lab, "_race_device", lambda: "cpu")


@pytest.mark.parametrize("n", [0, lab.RACE_MAX_N + 1, True, 64.0, "64"])
def test_race_rejects_a_bad_size_before_using_the_gpu(n):
    with pytest.raises(ValueError, match=str(lab.RACE_MAX_N)):
        hg.race(n)


def test_race_metrics_feed_the_stage_stars(cpu_race, monkeypatch):
    times = {"CPU": 10.0, "GPU，数据已在显存里": 2.0, "GPU，算上拷进拷回": 20.0}
    monkeypatch.setattr(lab, "_time", lambda fn, label, *rest: _timing(label, times[label]))
    race = hg.race(8)
    assert race.metrics == {"median_ms": 2.0, "trip_ms": 20.0, "cpu_ms": 10.0, "n": 8.0}
    outline = json.loads(lab._repo_file("docs", "course", "outline.json").read_text(encoding="utf-8"))
    rules = next(stage["lab"]["stars"] for stage in outline["stages"] if stage["id"] == "forge-your-gpu")
    credential = {"checks": {"passed": 3, "total": 3}, "metrics": race.metrics}
    assert stars.evaluate(rules, credential) == [True, True, False]


def test_race_refuses_to_time_a_wrong_gpu_result(cpu_race, monkeypatch):
    monkeypatch.setattr(torch.Tensor, "cpu", lambda self: self + 1)  # 「拷回来」的结果被弄坏了
    monkeypatch.setattr(lab, "_time", lambda *args: pytest.fail("结果不对时不该计时"))
    with pytest.raises(RuntimeError, match="对不上"):
        hg.race(8)


# ---------------------------------------------------------------- 测得准（2-3）：check_timer

class FakeAdd:
    """假的一次 GPU 加法：gpu_ms 是它在 GPU 上花的时间，queued_ms 是开始计时时 GPU 前面还排着的活。"""

    def __init__(self, gpu_ms, queued_ms=0.0):
        self.gpu_ms, self.queued_ms = gpu_ms, queued_ms

    def __call__(self):
        pass


@pytest.fixture
def timer_cases(monkeypatch):
    """没有 GPU：三种情况换成假的加法，hg 的参考计时直接报它在 GPU 上花的时间。"""
    cases = [("大数组加法", FakeAdd(0.3), None), ("小数组加法", FakeAdd(0.01), None),
             ("前面排着活", FakeAdd(0.004, queued_ms=0.6), lambda: None)]
    monkeypatch.setattr(lab, "_require_gpu", lambda caller: None)
    monkeypatch.setattr(lab, "_synchronize", lambda: None)
    monkeypatch.setattr(lab, "_EventTimer", lambda: lambda fn: fn.gpu_ms)
    monkeypatch.setattr(lab, "_timer_cases", lambda: cases)
    return cases


def waits_for_the_gpu(fn):
    """GPU 事件、等 GPU 走到 end：量到的就是这次加法在 GPU 上的时间。"""
    fn()
    return fn.gpu_ms


def test_check_timer_passes_a_timer_that_waits_for_the_gpu(timer_cases, capsys):
    report = hg.check_timer(waits_for_the_gpu)
    assert (report.passed, report.total) == (3, 3)
    out = capsys.readouterr().out
    assert "✓ 大数组加法：你的 0.3 ms，参考 0.3 ms" in out and "通过 3/3" in out


@pytest.mark.parametrize("timer,verdicts,reason", [
    # 没等 GPU：CPU 计时只量到把加法排进队列的那一下
    (lambda fn: 0.02, [False, False, False], "停表的时候 GPU 还没算完"),
    # CPU 计时，等 GPU 算完再停表：大小数组都对得上，前面排着的活却也算了进去
    (lambda fn: fn.queued_ms + fn.gpu_ms + 0.003, [True, True, False], "GPU 前面排着的活"),
    (lambda fn: fn.gpu_ms / 1000, [False, False, False], "返回的是秒吧"),
    (lambda fn: fn.gpu_ms * 1000, [False, False, False], "返回的是微秒吧"),
])
def test_check_timer_says_how_a_timer_goes_wrong(timer_cases, timer, verdicts, reason):
    report = hg.check_timer(timer)
    assert [case.passed for case in report.cases] == verdicts
    assert reason in next(case.reason for case in report.cases if not case.passed)


@pytest.mark.parametrize("timer,reason", [
    (lambda fn: ..., "还没写完"),
    (lambda fn: None, "还没写完"),
    (lambda fn: torch.tensor(0.3), "要返回毫秒数"),
    (lambda fn: -1.0, "要返回毫秒数"),
    (lambda fn: float("nan"), "要返回毫秒数"),
])
def test_check_timer_explains_a_timer_that_returns_no_milliseconds(timer_cases, timer, reason):
    report = hg.check_timer(timer)
    assert report.passed == 0
    assert all(reason in case.reason for case in report.cases)


# R-01 在真卡上（PyTorch 2.13、ROCm 10）只补 return、不等 end 时，报的是 PyTorch 自己的检查，不是 HIP 的 not ready。
@pytest.mark.parametrize("message", ["Both events must be completed before calculating elapsed time.",
                                     "HIP error: device not ready"])
def test_check_timer_reports_errors_and_points_to_waiting_for_end(timer_cases, message):
    def not_ready(fn):
        raise RuntimeError(message)

    report = hg.check_timer(not_ready)
    assert report.passed == 0
    expected = f"运行出错：RuntimeError: {message.rstrip('.')}。读 elapsed_time 之前，先等 GPU 走到 end"
    assert report.cases[0].reason == expected
    assert hg.check_timer(lambda fn: 1 / 0).cases[0].reason == "运行出错：ZeroDivisionError: division by zero"


def test_check_timer_does_not_blame_the_reader_for_a_broken_reference(timer_cases, monkeypatch):
    def broken(fn):
        raise RuntimeError("HIP error: an illegal memory access was encountered")

    monkeypatch.setattr(lab, "_EventTimer", lambda: broken)
    with pytest.raises(RuntimeError, match="illegal memory access"):
        hg.check_timer(waits_for_the_gpu)


def test_check_timer_leaves_out_the_warmup_calls(timer_cases, tmp_path, monkeypatch):
    config = tmp_path / "config.toml"
    config.write_text("[experiment]\nwarmup = 3\nrepeat = 3\n", encoding="utf-8")
    monkeypatch.setenv("HELLO_GPU_CONFIG", str(config))
    calls = Counter()

    def slow_at_first(fn):  # 前三次带着第一次调用的开销
        calls[id(fn)] += 1
        return 100.0 if calls[id(fn)] <= 3 else fn.gpu_ms

    assert hg.check_timer(slow_at_first).passed == 3


# ---------------------------------------------------------------- 测得准（2-3）：warm_cold

@pytest.fixture
def cache_times(monkeypatch):
    """没有 GPU：每次「换掉缓存」之后的第一次计时算冷缓存，其余算热缓存；两种各报什么数由测试给。"""
    samples, flushed = {}, []

    def timer(fn):
        fn()
        values = samples["cold" if flushed else "warm"]
        flushed.clear()
        return next(values)

    monkeypatch.setattr(lab, "_require_gpu", lambda caller: None)
    monkeypatch.setattr(lab, "_device", lambda: dict(FAKE))
    monkeypatch.setattr(lab, "_synchronize", lambda: None)
    monkeypatch.setattr(lab, "_EventTimer", lambda: timer)
    monkeypatch.setattr(lab, "_flusher", lambda device: (lambda: flushed.append(True), 512 * 2**20))
    monkeypatch.setattr(torch.cuda, "current_device", lambda: 0)

    def use(warm, cold):
        samples["warm"], samples["cold"] = itertools.cycle(warm), itertools.cycle(cold)
    return use


def _stage_stars(stage_id):
    outline = json.loads(lab._repo_file("docs", "course", "outline.json").read_text(encoding="utf-8"))
    return next(stage["lab"]["stars"] for stage in outline["stages"] if stage["id"] == stage_id)


@pytest.mark.parametrize("warm,cold,earned,verdict", [
    # 数据装得进缓存：冷缓存慢一倍，热缓存的样本也挨得紧
    ([1.00, 1.02, 0.98, 1.01, 0.99], [2.0, 2.1, 1.9], [True, True, True], "冷热分得开"),
    # 数据装不下：冷热都从显存读，差不多一样快
    ([1.00, 1.01, 0.99], [1.00, 1.01, 0.99], [True, True, False], "冷热分不开"),
    # 一次调用太短：冷热分得开，热缓存的波动却超过一成
    ([0.7, 1.0, 1.4, 0.8, 1.2], [3.0], [True, False, True], "冷热分得开"),
])
def test_warm_cold_metrics_feed_the_stage_stars(cache_times, capsys, warm, cold, earned, verdict):
    cache_times(warm, cold)
    result = hg.warm_cold(lambda: None, warmup=2, repeat=10)
    credential = {"checks": {"passed": 3, "total": 3}, "metrics": result.metrics}
    assert stars.evaluate(_stage_stars("forge-trusted-timing"), credential) == earned
    assert verdict in capsys.readouterr().out


def test_warm_cold_reports_both_sides_and_their_bandwidth(cache_times, capsys):
    cache_times([0.5], [1.0])
    result = hg.warm_cold(lambda: None, bytes_moved=12_000_000, warmup=1, repeat=4)
    assert result.metrics == pytest.approx({"median_ms": 0.5, "p10_ms": 0.5, "p90_ms": 0.5, "cold_ms": 1.0,
                                            "cold_p10_ms": 1.0, "cold_p90_ms": 1.0, "gbps": 24.0,
                                            "cold_gbps": 12.0})
    out = capsys.readouterr().out
    assert "512 MiB" in out and "有效带宽 24.0 GB/s" in out and "有效带宽 12.0 GB/s" in out


@pytest.mark.parametrize("call,error", [
    (lambda: hg.warm_cold(42), TypeError),
    (lambda: hg.warm_cold(lambda: None, bytes_moved=0), ValueError),
    (lambda: hg.warm_cold(lambda: None, repeat=0), ValueError),
    (lambda: hg.check_timer(42), TypeError),
    (lambda: hg.check_mm_cost(42), TypeError),
    (lambda: hg.roofline([("add", lambda: None, 1, 12)]), TypeError),
    (lambda: hg.roofline({"add": (lambda: None, 1)}), TypeError),
    (lambda: hg.roofline({"add": (42, 1, 12)}), TypeError),
    (lambda: hg.roofline({"copy": (lambda: None, 0, 12)}), ValueError),  # 拷贝没有浮点运算，画不到屋顶线上
    (lambda: hg.roofline({"add": (lambda: None, 1, "12")}), ValueError),
    (lambda: hg.roofline({"peak": (lambda: None, 1, 12)}), ValueError),  # 会和这张卡的 peak_gbps 混在一起
    (lambda: hg.roofline({}, peak={"gbps": 0, "tflops": 1}), ValueError),
    (lambda: hg.roofline({"add": (lambda: None, 1, 12)}, repeat=0), ValueError),
    (lambda: hg.trace([lambda: None]), TypeError),
    (lambda: hg.trace({}), TypeError),
    (lambda: hg.trace({"mlp": 42}), TypeError),
    (lambda: hg.trace({" ": lambda: None}), ValueError),
    (lambda: hg.trace({"mlp": lambda: None}, repeat=0), ValueError),
    (lambda: hg.trace({"mlp": lambda: None}, warmup=-1), ValueError),
])
def test_stage_helpers_reject_unclear_arguments_before_using_the_gpu(monkeypatch, call, error):
    monkeypatch.setattr(lab, "_require_gpu", lambda caller: pytest.fail("参数不对时不该用到 GPU"))
    with pytest.raises(error):
        call()


# ---------------------------------------------------------------- 性能的天花板（2-4）

def _mm_right(m, k, n):
    return 2 * m * k * n, 4 * (m * k + k * n + m * n)


@pytest.mark.parametrize("cost", [
    _mm_right,
    lambda m, k, n: (2.0 * m * k * n, 4.0 * (m * k + k * n + m * n)),
    lambda m, k, n: [np.int64(value) for value in _mm_right(m, k, n)],
])
def test_check_mm_cost_accepts_the_algorithmic_count_in_any_number_type(cost):
    report = hg.check_mm_cost(cost)
    assert (report.passed, report.total) == (5, 5)


@pytest.mark.parametrize("cost,reason", [
    (lambda m, k, n: (m * k * n, 4 * (m * k + k * n + m * n)), "少了一半"),  # 一次乘加只算了 1 次
    (lambda m, k, n: (2 * m * k * n, m * k + k * n + m * n), "1/4"),  # 数的是个数，不是字节
    (lambda m, k, n: (2 * m * k * n, 8 * (m * k + k * n + m * n)), "不是 8 字节"),
    (lambda m, k, n: (2 * m * k * n, 4 * (m * k + k * n)), "少算了 C"),
    (lambda m, k, n: (2 * m * k * n, 4 * (m * k + k * n + 2 * m * n)), "多算了一遍 C"),
])
def test_check_mm_cost_names_the_mistake(cost, reason):
    report = hg.check_mm_cost(cost)
    assert report.passed == 0
    assert all(reason in case.reason for case in report.cases)


def test_check_mm_cost_catches_a_formula_that_only_fits_square_matrices():
    assert not hg.check_mm_cost(lambda m, k, n: (2 * n**3, 12 * n**2)).all_passed


@pytest.mark.parametrize("cost,reason", [
    (lambda m, k, n: (..., ...), "还没写"),  # Notebook 里 TODO 原样的样子
    (lambda m, k, n: None, "还没写完"),
    (lambda m, k, n: 2 * m * k * n, "两个数"),
    (lambda m, k, n: (2 * m * k * n, "12 字节"), "要是一个数"),
    (lambda m, k, n: 1 / 0, "运行出错"),
])
def test_check_mm_cost_counts_unfinished_or_broken_functions_as_failed_shapes(cost, reason):
    report = hg.check_mm_cost(cost)
    assert (report.passed, report.total) == (0, 5)
    assert all(reason in case.reason for case in report.cases)


PEAK = {"gbps": 600.0, "tflops": 24.0}  # 拐点在 40 FLOP/字节


def _points(add_ms, mm_ms, *, n=1 << 26, k=4096, cost=_mm_right):
    """挑战里的两个点：n 个数的加法，4096×k 乘 k×4096 的矩阵乘；耗时由测试给。"""
    return {"add": (_timing("add", add_ms), n, 12 * n), "mm": (_timing("mm", mm_ms), *cost(4096, k, 4096))}


def test_roofline_puts_each_point_under_its_own_roof(capsys):
    roof = hg.roofline(_points(1.3, 13.0), peak=PEAK, plot=False)
    add, mm = roof.points["add"], roof.points["mm"]
    assert roof.ridge == pytest.approx(40.0)
    assert add.intensity == pytest.approx(1 / 12)
    assert add.gbps == pytest.approx(12 * (1 << 26) / 1.3e6)
    assert roof.roof(add.intensity) == pytest.approx(600 / 12 / 1000)  # 拐点左边：峰值带宽 × 算术强度
    assert roof.roof(mm.intensity) == 24.0  # 右边：峰值算力
    assert list(roof.table["bound"]) == ["带宽", "算力"]
    assert roof.table.loc["mm", "of_roof"] == pytest.approx(2 * 4096**3 / 13e9 / 24)


def test_roofline_ridge_is_where_the_two_roofs_meet():
    roof = hg.roofline(peak=PEAK, plot=False)  # 不放点，只要屋顶
    assert roof.roof(roof.ridge) == pytest.approx(PEAK["tflops"])
    assert roof.roof(roof.ridge / 2) == pytest.approx(PEAK["tflops"] / 2)
    assert roof.roof(roof.ridge * 2) == PEAK["tflops"]


@pytest.mark.parametrize("points,earned", [
    # 补好 TODO：加法够长，跑到带宽屋顶的九成多；矩阵乘的 k 改成 4096，过了拐点
    (_points(1.4, 13.0), [True, True]),
    # TODO 原样：加法只有 2¹² 个数，量到的大多是启动的开销；矩阵乘的工作量还没写，这个点不画
    (_points(0.01, 1.0, n=1 << 12, k=16, cost=lambda m, k, n: (..., ...)), [False, False]),
    # 加法够长，矩阵乘的 k 还是 16：算术强度不到 8，在拐点左边
    (_points(1.4, 1.0, k=16), [True, False]),
])
def test_roofline_metrics_feed_the_stage_stars(points, earned, capsys):
    metrics = hg.roofline(points, peak=PEAK, plot=False).metrics
    credential = {"checks": {"passed": 5, "total": 5}, "metrics": metrics}
    assert stars.evaluate(_stage_stars("forge-roofline"), credential) == [True, *earned]


def test_roofline_metrics_are_submittable_and_skip_names_that_cannot_prefix_a_metric(capsys):
    points = {"mm 4096": (_timing("mm", 13.0), *_mm_right(4096, 4096, 4096)),
              "add": (_timing("add", 1.4), 1 << 26, 12 << 26)}
    roof = hg.roofline(points, peak=PEAK, plot=False)
    assert "mm 4096" in roof.table.index
    assert set(roof.metrics) == {"add_ms", "add_gbps", "add_tflops", "add_intensity", "add_roof_tflops",
                                 "ridge", "peak_gbps", "peak_tflops"}
    assert lab._metrics_dict(roof.metrics) == roof.metrics  # hg.submit 收得下


def test_roofline_reads_the_cached_peak_and_measures_only_when_there_is_none(fake_gpu, monkeypatch, capsys):
    measured = []

    def measure(device):
        measured.append(device["cus"])
        return {"v": 1, "device": lab._identity(device), "env": {}, "at": "2026-11-11T00:00:00Z", **PEAK}

    monkeypatch.setattr(lab, "_measure_peak", measure)
    first = hg.roofline(_points(1.4, 13.0), plot=False)
    second = hg.roofline(_points(1.4, 13.0), plot=False)
    assert measured == [10]
    assert first.metrics == second.metrics
    assert second.ridge == pytest.approx(40.0)


def test_roofline_plot_draws_the_measured_roof_and_each_point(capsys):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    roof = hg.roofline(_points(1.4, 13.0), peak=PEAK, plot=False)
    axes = lab._plot_roofline(roof)
    x, y = axes.get_lines()[0].get_data()
    assert roof.ridge in x  # 折线正好折在拐点上
    assert y == pytest.approx([roof.roof(value) for value in x])
    drawn = [offset for collection in axes.collections for offset in collection.get_offsets()]
    np.testing.assert_allclose(drawn, [(point.intensity, point.tflops) for point in roof.points.values()])
    plt.close("all")


# ---------------------------------------------------------------- 一行 PyTorch 背后（2-5）

GEMM = "Cijk_Alik_Bljk_SB_MT128x128x16_fixture"
ELEMENTWISE = "void at::native::vectorized_elementwise_kernel<4, at::native::{}<float>, std::array<char*, 2ul> >(int, …)"
#: F.gelu(x @ w + b)：(算子, 里层算子, kernel, GPU 上跑多少 µs)。矩阵乘的 kernel 由里层的 aten::mm 启动。
MLP = [("aten::matmul", "aten::mm", GEMM, 2950.0), ("aten::add", None, ELEMENTWISE.format("add"), 130.0),
       ("aten::gelu", None, ELEMENTWISE.format("gelu"), 134.0)]
#: 照公式一步一步写的 GELU：8 个逐元素的算子，读两个数组的那两步慢一些。
GELU_STEPS = [(name, None, ELEMENTWISE.format(name[6:]), us) for name, us in (
    ("aten::mul", 260.0), ("aten::pow", 260.0), ("aten::mul", 260.0), ("aten::add", 390.0),
    ("aten::mul", 260.0), ("aten::tanh", 262.0), ("aten::add", 260.0), ("aten::mul", 390.0))]
GELU_ONE = [("aten::gelu", None, ELEMENTWISE.format("gelu"), 262.0)]


def _event(id, name, start, end, kind, *, thread=1, linked=0, stream=None):
    """profiler 记下的一个事件，同 PyTorch 解析 kineto 结果时建的 FunctionEvent；kind 是 activity_type。"""
    gpu = kind in ("kernel", "gpu_memcpy", "gpu_memset", "gpu_user_annotation")
    event = FunctionEvent(id=id, name=name, thread=thread, start_us=start, end_us=end,
                          device_type=DeviceType.CUDA if gpu else DeviceType.CPU, device_resource_id=stream)
    event.activity_type, event.linked_correlation_id = kind, linked
    return event


def _profile(labels, steps, *, slower=(1.0,), old=False):
    """模拟 ROCm 上的 profiler 记一行：每一遍里 CPU 一个个调用 steps 的算子，每个算子里一次 hipLaunchKernel，
    GPU 按顺序跑对应的 kernel。第 i 遍 CPU 上的时间乘 slower[i]。profiler 真会多记的也带上：GPU 上和标注同名的一段、
    算子里没启动东西的 aten::empty、每遍之后别的线程上等 GPU 的 hipDeviceSynchronize。树由 PyTorch 自己的 EventList 搭。
    old=True 去掉 activity_type 和 linked_correlation_id，模拟没有这两项的旧版 PyTorch。"""
    events, clock, ids = [], 100.0, itertools.count(1)
    for run, label in enumerate(labels):
        scale = slower[run % len(slower)]
        begin, anchor, gpu_free = clock, next(ids), clock
        cpu = begin + 2.0
        for name, inner, kernel, gpu_us in steps:
            owner = next(ids)
            events.append(_event(owner, name, cpu, cpu + 8.0 * scale, "cpu_op"))
            if inner:
                owner = next(ids)
                events.append(_event(owner, inner, cpu + 0.5, cpu + 8.0 * scale - 0.5, "cpu_op"))
            events.append(_event(next(ids), "aten::empty", cpu + 1.0, cpu + 1.5, "cpu_op"))
            correlation, launch = 10_000 + next(ids), (cpu + 4.0 * scale, cpu + 6.4 * scale)
            events.append(_event(correlation, "hipLaunchKernel", *launch, "cuda_runtime", linked=owner))
            start = max(launch[1] + 4.0, gpu_free)
            gpu_free = start + gpu_us
            events.append(_event(correlation, kernel, start, gpu_free, "kernel", linked=owner, stream=7))
            cpu += 8.0 * scale + 3.0
        events.append(_event(anchor, label, begin, cpu, "user_annotation"))
        events.append(_event(anchor, label, begin + 6.0, max(gpu_free, begin + 6.0), "gpu_user_annotation", stream=7))
        events.append(_event(next(ids), "hipDeviceSynchronize", cpu + 1.0, max(cpu, gpu_free) + 2.0, "cuda_runtime",
                             thread=99))
        clock = max(cpu, gpu_free) + 50.0
    if old:
        for event in events:
            del event.activity_type, event.linked_correlation_id
    tree = EventList(sorted(events, key=lambda event: (event.time_range.start, -event.time_range.end)),
                     use_device="cuda")
    tree._build_tree()
    return list(tree)


LABELS = [f"hg.trace mlp #{index}" for index in (1, 2, 3)]


@pytest.mark.parametrize("old", [False, True], ids=["新版 PyTorch", "旧版 PyTorch"])
def test_trace_follows_each_kernel_back_to_the_op_that_launched_it(old):
    run = lab._trace_runs(_profile(LABELS, MLP, old=old), LABELS)[0]
    # 这一行直接调用的三个算子，加上启动了矩阵乘的里层 aten::mm；没启动东西的 aten::empty 不收
    assert [(op["name"], op["parent"]) for op in run["ops"]] == [
        ("aten::matmul", None), ("aten::mm", 0), ("aten::add", None), ("aten::gelu", None)]
    assert [launch["op"] for launch in run["launches"]] == [1, 2, 3]
    # GPU 上和标注同名的那一段不是 kernel；别的线程上等 GPU 的同步不在这一行里
    assert [(event["kind"], event["op"], event["launch"], event["stream"]) for event in run["gpu"]] == [
        ("kernel", 1, 0, 0), ("kernel", 2, 1, 0), ("kernel", 3, 2, 0)]
    assert [event["start"] for event in run["gpu"]] == [12.4, 2962.4, 3092.4]  # 从这一行开始算，单位 µs
    assert (run["cpu_us"], run["span_us"], run["gpu_us"]) == (35.0, 3226.4, 3214.0)


def test_trace_places_kernels_without_a_launch_by_linked_op_or_by_time():
    events = _profile(LABELS[:2], MLP)
    second = next(event for event in events if event.name == LABELS[1] and event.device_type == DeviceType.CPU)

    def late(event):
        return event.time_range.start >= second.time_range.start

    # 第二遍的运行时调用没记下来：kernel 按 linked_correlation_id 找算子；矩阵乘的连这个也没有，只按时间归到这一遍
    kept = [event for event in events if not (late(event) and event.name == "hipLaunchKernel")]
    next(event for event in kept if late(event) and event.name == GEMM).linked_correlation_id = 0
    first, again = lab._trace_runs(kept, LABELS[:2])
    assert again["launches"] == []
    assert [op["name"] for op in again["ops"]] == ["aten::matmul", "aten::add", "aten::gelu"]
    assert [(event["op"], event["launch"]) for event in again["gpu"]] == [(None, None), (1, None), (2, None)]
    assert [event["name"] for event in again["gpu"]] == [event["name"] for event in first["gpu"]]


@pytest.fixture
def traced(fake_gpu, monkeypatch):
    """hg.trace 不用 GPU：profiler 记下的事件换成 _profile 模拟的。往返回的字典里写 {行名: _profile 的参数}。"""
    plans = {}
    monkeypatch.setattr(lab, "_synchronize", lambda: None)
    monkeypatch.setattr(lab, "_record", lambda fn, labels: _profile(labels, **plans[labels[0].split(" ")[1]]))
    return plans


def test_trace_keeps_the_middle_run_and_saves_what_it_prints(traced, capsys):
    traced["mlp"] = {"steps": MLP, "slower": (1.0, 4.0, 2.0, 3.0, 5.0)}  # 从开始到算完排在中间的是慢 3 倍的那遍
    result = hg.trace({"mlp": lambda: None}, plot=False)
    line = result.lines["mlp"]
    assert (line["runs"], line["cpu_us"]) == (5, 83.0)
    assert result.path.parent.name == "traces"
    assert json.loads(result.path.read_text(encoding="utf-8")) == result.data
    assert result.data["device"] == lab._identity(FAKE)
    out = capsys.readouterr().out
    assert "mlp：启动了 3 个 kernel" in out
    assert f"最耗时的是第 1 个：aten::matmul 启动的 {GEMM}" in out


def test_trace_writes_the_format_the_archive_schema_describes(traced, capsys):
    traced["mlp"] = {"steps": MLP}
    data = hg.trace({"mlp": lambda: None}, plot=False).data
    schema = json.loads(lab._repo_file("docs", "lab", "schema.json").read_text(encoding="utf-8"))["$defs"]

    def fits(definition, value):
        node = schema[definition]
        assert set(node["required"]) <= set(value) <= set(node["properties"]), definition

    fits("trace", data)
    assert data["v"] == schema["trace"]["properties"]["v"]["const"]
    for line in data["lines"]:
        fits("traceLine", line)
        for key, definition in (("ops", "traceOp"), ("launches", "traceLaunch"), ("gpu", "traceGpu")):
            for event in line[key]:
                fits(definition, event)


def _tiny(steps):
    """同样的算子，数据很小：每个 kernel 在 GPU 上只跑 2 µs。"""
    return [(name, inner, kernel, 2.0) for name, inner, kernel, _ in steps]


@pytest.mark.parametrize("mine,earned", [
    (GELU_ONE, [True, True]),  # 一个 kernel 算完：少读写 8 遍显存，也少启动 7 次
    ([], [False, False]),  # TODO 原样：mine 在 GPU 上什么也不做，不交它的数
    (GELU_STEPS, [False, False]),  # 照抄 gelu_steps
    (GELU_STEPS[2:], [False, False]),  # 少了两步，还剩 6 个 kernel
])
def test_trace_metrics_feed_the_stage_stars(traced, capsys, mine, earned):
    traced.update(steps={"steps": GELU_STEPS}, mine={"steps": mine},
                  steps_small={"steps": _tiny(GELU_STEPS)}, mine_small={"steps": _tiny(mine)})
    lines = hg.trace({name: (lambda: None) for name in ("steps", "mine", "steps_small", "mine_small")}, plot=False)
    credential = {"checks": {"passed": 3, "total": 3}, "metrics": lines.metrics}
    assert stars.evaluate(_stage_stars("forge-behind-pytorch"), credential) == [True, *earned]
    assert lab._metrics_dict(lines.metrics) == lines.metrics  # hg.submit 收得下


def test_trace_reports_a_line_that_fails_and_records_the_others(traced, capsys):
    traced["mlp"] = {"steps": MLP}
    result = hg.trace({"broken": lambda: 1 / 0, "mlp": lambda: None}, plot=False)
    assert list(result.lines) == ["mlp"]
    assert "broken：运行出错，这一行没记下来：ZeroDivisionError" in capsys.readouterr().out
    with pytest.raises(RuntimeError, match="每一行都运行出错"):
        hg.trace({"broken": lambda: 1 / 0}, plot=False)


def test_trace_reads_a_real_profiler_run_without_a_gpu(fake_gpu, monkeypatch, capsys):
    from torch.profiler import ProfilerActivity
    monkeypatch.setattr(lab, "_trace_activities", lambda: [ProfilerActivity.CPU])
    monkeypatch.setattr(lab, "_synchronize", lambda: None)
    pauses = itertools.cycle([0.024, 0.006, 0.018, 0.012, 0.030])  # 每遍在 CPU 上多停多久：排在中间的是 18 ms
    x, w, b = torch.randn(64, 64), torch.randn(64, 64), torch.randn(64)

    def line():
        time.sleep(next(pauses))
        return torch.nn.functional.gelu(x @ w + b)

    result = hg.trace({"mlp": line}, warmup=0, plot=False)
    mlp = result.lines["mlp"]
    assert [op["name"] for op in mlp["ops"]] == ["aten::matmul", "aten::add", "aten::gelu"]
    assert 18_000 <= mlp["cpu_us"] < 24_000
    assert mlp["gpu"] == [] and result.metrics == {}
    out = capsys.readouterr().out
    assert "mlp：GPU 上一个事件也没有" in out and "这几行在 GPU 上一个事件都没记到" in out


@pytest.mark.parametrize("name,short", [
    (ELEMENTWISE.format("add"), "vectorized_elementwise_kernel"),
    ("void at::native::(anonymous namespace)::CatArrayBatchedCopy<float, unsigned int, 2, 128, 1>(…)",
     "CatArrayBatchedCopy"),
    ("Memcpy DtoD (Device -> Device)", "Memcpy DtoD"),
    ("Cijk_Alik_Bljk_SB_MT128x128x16_MI16x16x4x1_SN_1LDSB0_APM1", "Cijk_Alik_Bljk_SB_MT128x128x16_MI16x16x…"),  # 截到 40 格
])
def test_trace_shortens_kernel_names_for_the_table(name, short):
    assert lab._short_kernel(name) == short


def test_trace_plot_gives_an_op_and_its_kernels_one_color(traced, capsys):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    traced["mlp"] = {"steps": MLP}
    (axes,) = lab._plot_trace(hg.trace({"mlp": lambda: None}, plot=False))
    ops, launches, kernels = (collection.get_facecolors().tolist() for collection in axes.collections)
    assert len(set(map(tuple, ops))) == 3  # 三个顶层算子三种颜色
    assert launches == ops and kernels == ops  # 矩阵乘由里层的 aten::mm 启动，颜色跟着顶层的 aten::matmul
    plt.close("all")
