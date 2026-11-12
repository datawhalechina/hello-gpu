"""铸造城、试炼场实验室用的 hello_gpu v2 接口（课程规则）。

    hg.device_card()   打印并返回 GPU 卡片，附「我的 GPU 卡片」导入码（HGCARD1.）
    hg.check(...)      多形状正确性校验；guard=True 时还查越界写（输出前后留护栏）
    hg.bench(...)      可信计时，沿用 measurement.benchmark 的 GPU 事件协议
    hg.peak()          这张卡的实测峰值带宽和 FP32 FMA 吞吐，测一次后缓存
    hg.compare(...)    多个实现的对比表
    hg.submit(...)     生成通关凭证（HGPU1.），打印通关链接和通关码，凭证 JSON 存进 artifact 目录

2-1 开工准备另有三个（在文件末尾）：

    hg.check_env()       一键检查实验环境，没通过的项附上怎么改和实验环境指南的链接
    hg.check_card(mine)  核对读者自己读出的 CU 数、wave 大小和显存
    hg.race(n)           同一个 n×n 矩阵乘，CPU 和 GPU（数据已在显存里 / 算上拷进拷回）比谁快

2-3 测得准另有两个（也在文件末尾）：

    hg.check_timer(timer)  核对读者写的计时函数：三种情况下都要和 GPU 事件的参考值对得上
    hg.warm_cold(fn)       同一个调用，热缓存和冷缓存轮流测，看波动和冷热分不分得开

2-4 性能的天花板另有两个（也在文件末尾）：

    hg.roofline(points)    用这张卡的实测峰值画屋顶线，把算子按实测耗时放上去，看归谁管、离屋顶多远
    hg.check_mm_cost(cost) 核对读者写的矩阵乘浮点运算次数和字节数

2-5 一行 PyTorch 背后另有一个（也在文件末尾）：

    hg.trace(lines)        用 torch.profiler 记下几行 PyTorch 代码：CPU 上的算子、启动 kernel 的运行时调用、GPU 上的
                           kernel；打印、画时间线，存成实验档案馆收录的 trace JSON（docs/lab/schema.json 的 trace）

导入本模块不会初始化 GPU。没有 GPU 时，用到 GPU 的函数抛出 RuntimeError，用中文说明原因
（hg.check_env() 先把每一项的检查结果打印出来，再抛）。
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
import importlib.util
import json
import math
import numbers
import os
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import sys
import sysconfig
import time
import unicodedata
from uuid import uuid4

import pandas as pd
import torch
from torch.autograd import DeviceType

from . import codes
from .config import configuration, settings
from .hip import compile_kernel
from .measurement import Measurement, _counts, _events, benchmark
from .paths import artifact_root

#: 通关链接默认指向的站点；自己部署的镜像站在 config.toml 的 [lab] site 里改。
DEFAULT_SITE = "https://datawhalechina.github.io/hello-gpu"

# torch.testing.assert_close 对各浮点类型的默认误差 (rtol, atol)。
_TOLERANCES = {
    torch.float16: (1e-3, 1e-5),
    torch.bfloat16: (1.6e-2, 1e-5),
    torch.float32: (1.3e-6, 1e-5),
    torch.float64: (1e-7, 1e-7),
}
_ROUTE_NAMES = {"hip": "HIP 路线", "triton": "Triton 路线", "shared": "两条路线共用"}

# hg.peak() 的两个测试。拷贝：两块缓冲区之间 copy_，读一遍写一遍。
_COPY_BYTES = 512 * 2**20
# FMA：每个线程 _FMA_CHAINS 条互不依赖的 FMA 链，每条 _FMA_ITERS 次；一次 FMA 记 2 次浮点运算。
# 链写成累加 s ← a·b + s：编译器能把相邻两条链的 FMA 并成一条双发射指令（gfx11、gfx12 的 v_dual_fmac_f32），
# 产品页的 FP32 峰值就是按双发射算的。写成 s ← s·b + a 时编译出来是一条一条的 v_fma_f32，在 R9700（gfx1201）上
# 只测到产品页的一半出头（R-01）。输入 a ∈ [1, 2)、b ∈ [0.25, 0.75)，s 从 a + 0.125·c 起每次加 a·b，
# 不会溢出，也没有非规格化数，所以结果可以校验：out ≈ Σ_c (a + 0.125·c + _FMA_ITERS · a · b)。
_FMA_THREADS = 1 << 23
_FMA_CHAINS = 16
_FMA_ITERS = 256
# 编译 FMA kernel 的十几秒里 GPU 空着。计时之前先让它连着跑这么久（秒），等频率升上来再量：R-01 在 R9700 上看到，
# 刚编译完只预热几次就计时，偶尔只量到升频以后的六成。
_FMA_WARM_SECONDS = 0.2
_FMA_SOURCE = f"""
__global__ void kernel(const float* a, const float* b, float* out, int n) {{
    const int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= n) return;
    const float x = a[i];
    const float y = b[i];
    float s[{_FMA_CHAINS}];
#pragma unroll
    for (int c = 0; c < {_FMA_CHAINS}; ++c) s[c] = x + 0.125f * c;
#pragma unroll 16
    for (int k = 0; k < {_FMA_ITERS}; ++k) {{
#pragma unroll
        for (int c = 0; c < {_FMA_CHAINS}; ++c) s[c] = fmaf(x, y, s[c]);
    }}
    float total = 0.0f;
#pragma unroll
    for (int c = 0; c < {_FMA_CHAINS}; ++c) total += s[c];
    out[i] = total;
}}
"""


# ---------------------------------------------------------------- 设备与环境

def _require_gpu(caller: str) -> None:
    if torch.version.hip is None:
        raise RuntimeError(
            f"{caller} 需要 AMD GPU：当前 Python 环境里的 PyTorch（{torch.__version__}）不是 ROCm 版。"
            "请换到装了 ROCm 版 PyTorch 的内核再运行。")
    if not torch.cuda.is_available():
        raise RuntimeError(
            f"{caller} 需要 AMD GPU：PyTorch 看不到 GPU。请在终端运行 rocminfo，确认能列出显卡，"
            "并且当前用户能访问 /dev/kfd 和 /dev/dri。")


def _device() -> dict:
    """当前 GPU 的名称、gfx 架构、CU 数、wave 大小和显存字节数（PyTorch 的设备属性）。

    CU 数是计算单元的个数：按 WGP 计数的卡（见 _wgp_mode），PyTorch 报的 multi_processor_count 乘 2。
    """
    props = torch.cuda.get_device_properties(torch.cuda.current_device())
    gfx = str(props.gcnArchName).split(":")[0]
    reported = int(props.multi_processor_count)
    return {
        "name": str(props.name).strip(),
        "gfx": gfx,
        "cus": reported * 2 if _wgp_mode(gfx) else reported,
        "wave": int(getattr(props, "warp_size", 0) or 0) or None,
        "memory_bytes": int(props.total_memory),
    }


# ROCm 的 HIP 运行时（clr）怎么数 multiProcessorCount（固定到一次提交，行号不会漂）：
# gfx10 起按环境变量 GPU_ENABLE_WGP_MODE（默认开）进 WGP 模式，gfx12.5 起不进
#   https://github.com/ROCm/rocm-systems/blob/3e6495e3a33a6d2bf4855e69f17f42b6185c0b71/projects/clr/rocclr/device/rocm/rocsettings.cpp#L174-L181
# WGP 模式下计算单元数取一半
#   https://github.com/ROCm/rocm-systems/blob/3e6495e3a33a6d2bf4855e69f17f42b6185c0b71/projects/clr/rocclr/device/rocm/rocdevice.cpp#L1148-L1149
# multiProcessorCount 就是这个数
#   https://github.com/ROCm/rocm-systems/blob/3e6495e3a33a6d2bf4855e69f17f42b6185c0b71/projects/clr/hipamd/src/hip_device.cpp#L685


def _flag_on(value: str) -> bool:
    """clr 读布尔环境变量的规则（flags.cpp）：写 true，或者开头是非零整数（同 C 的 atoi），算开。"""
    match = re.match(r"\s*([+-]?\d+)", value)
    return value == "true" or (match is not None and int(match.group(1)) != 0)


def _wgp_mode(gfx: str) -> bool:
    """这张卡上 HIP 是不是按 WGP 计数：是的话，multi_processor_count 数的是 WGP，一个 WGP 两个计算单元。

    RDNA 的三代（gfx10、gfx11、gfx12.0–12.4）默认按 WGP 计数，环境变量 GPU_ENABLE_WGP_MODE 可以关掉
    （出处见上面的 clr 源码）。别的架构（gfx9 的 CDNA 等）和不认识的写法按计算单元计数。
    """
    match = re.fullmatch(r"gfx(\d+)([0-9a-f])[0-9a-f]", gfx)
    if match is None:
        return False
    major, minor = int(match.group(1)), int(match.group(2), 16)
    if major not in (10, 11, 12) or (major == 12 and minor >= 5):
        return False
    flag = os.environ.get("GPU_ENABLE_WGP_MODE")
    return flag is None or _flag_on(flag)


def _identity(device: Mapping) -> dict:
    """凭证和峰值缓存里认卡用的三项。"""
    return {key: device[key] for key in ("name", "gfx", "cus")}


def _package_version(*names: str) -> str | None:
    for name in names:
        try:
            return version(name)
        except PackageNotFoundError:
            continue
    return None


def _rocm_version() -> str | None:
    found = _package_version("rocm")  # pip 安装的 ROCm SDK（TheRock）
    if found is not None:
        return found
    for root in filter(None, (os.environ.get("ROCM_PATH"), "/opt/rocm")):
        try:
            words = (Path(root) / ".info" / "version").read_text(encoding="utf-8").split()
        except OSError:
            continue
        if words:
            return words[0]
    return None


def _versions() -> dict:
    """ROCm / PyTorch / Triton 版本；查不到的写 None，不猜。"""
    return {
        "rocm": _rocm_version(),
        "torch": str(torch.__version__),
        "triton": _package_version("triton", "pytorch-triton-rocm", "triton-rocm"),
    }


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _run_rocminfo() -> str | None:
    """rocminfo 的输出；找不到或运行失败时返回 None。"""
    tool = shutil.which("rocminfo")
    if tool is None and os.environ.get("ROCM_PATH"):
        candidate = Path(os.environ["ROCM_PATH"]) / "bin" / "rocminfo"
        tool = str(candidate) if candidate.is_file() else None
    if tool is None:
        return None
    try:
        result = subprocess.run([tool], capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 else None


_ROCMINFO_FIELD = re.compile(r"  ([A-Za-z][^:]*?):\s*(.*?)\s*")


def _parse_rocminfo(text: str) -> list[dict[str, str]]:
    """rocminfo 输出里每个 GPU agent 的顶层字段（缩进两格的那些，例如 Compute Unit）。"""
    agents: list[dict[str, str]] = []
    for line in text.splitlines():
        if re.fullmatch(r"Agent \d+", line.strip()):
            agents.append({})
            continue
        match = _ROCMINFO_FIELD.fullmatch(line)
        if agents and match:
            agents[-1].setdefault(match.group(1), match.group(2))
    return [agent for agent in agents if agent.get("Device Type") == "GPU"]


def _leading_int(text: str | None) -> int | None:
    match = re.match(r"\s*(\d+)", text or "")
    return int(match.group(1)) if match else None


def _match_agent(device: Mapping, text: str | None) -> dict | None:
    """rocminfo 里对应当前 GPU 的 agent：gfx 相同，CU 数也相同的优先。"""
    agents = [agent for agent in _parse_rocminfo(text or "") if agent.get("Name") == device["gfx"]]
    exact = [agent for agent in agents if _leading_int(agent.get("Compute Unit")) == device["cus"]]
    return (exact or agents or [None])[0]


def _repo_file(*parts: str) -> Path | None:
    """仓库里的文件；不在仓库里运行（例如装成 wheel）时返回 None。"""
    for parent in Path(__file__).resolve().parents:
        if parent.name == "notebooks" and (parent / "common").is_dir():
            path = parent.parent.joinpath(*parts)
            return path if path.is_file() else None
    return None


# ---------------------------------------------------------------- 峰值

def _peak_path(device: Mapping) -> Path:
    key = re.sub(r"[^a-z0-9]+", "-", f"{device['gfx']} {device['cus']}cu {device['name']}".lower()).strip("-")
    return artifact_root() / "lab" / "peak" / f"{key}.json"


def _cached_peak(device: Mapping) -> dict | None:
    """这张卡缓存的实测峰值；没有、读不出或者不是这张卡的，返回 None。"""
    try:
        record = json.loads(_peak_path(device).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if (not isinstance(record, dict) or record.get("device") != _identity(device)
            or codes.positive(record.get("gbps")) is None or codes.positive(record.get("tflops")) is None):
        return None
    return record


def _measure_peak(device: Mapping) -> dict:
    config = settings()
    warmup, repeat = config["warmup"], config["repeat"]
    elements = min(_COPY_BYTES, device["memory_bytes"] // 8) // 4
    source = torch.arange(elements, device="cuda", dtype=torch.float32)
    target = torch.empty_like(source)

    def copy():
        target.copy_(source)

    copy()
    if not torch.equal(target, source):
        raise RuntimeError("峰值带宽没有测成：拷贝测试的结果不对")
    copied = benchmark(copy, label="peak copy_", warmup=warmup, repeat=repeat)
    del source, target

    try:
        kernel = compile_kernel("hg_peak_fma", _FMA_SOURCE)
    except RuntimeError as error:
        raise RuntimeError(
            "峰值算力没有测成：FMA 测试要编译一个 HIP kernel，这个环境里编译不了。运行 hg.check_env()，按「HIP 编译工具」"
            f"那一项的提示装好再试，两条路线都要。原来的报错：{_first_line(error)}") from error
    generator = torch.Generator().manual_seed(config["seed"])
    a = (1 + torch.rand(_FMA_THREADS, generator=generator)).cuda()
    b = (0.25 + 0.5 * torch.rand(_FMA_THREADS, generator=generator)).cuda()
    out = torch.empty_like(a)
    fma = kernel.prepare(a, b, out=out)
    fma()
    expected = _FMA_CHAINS * a * (1 + _FMA_ITERS * b) + 0.125 * _FMA_CHAINS * (_FMA_CHAINS - 1) / 2
    if not torch.allclose(out, expected, rtol=1e-4, atol=0):
        raise RuntimeError("峰值算力没有测成：FMA 测试的结果不对")
    deadline = time.perf_counter() + _FMA_WARM_SECONDS
    while time.perf_counter() < deadline:
        fma()
        torch.cuda.synchronize()  # 一次一次地跑：不等的话，0.2 秒能排进去几千次，GPU 要忙好一阵
    timed = benchmark(fma, label="peak FMA", warmup=warmup, repeat=repeat)

    moved = 2 * elements * 4
    flops = 2 * _FMA_CHAINS * _FMA_ITERS * _FMA_THREADS
    return {
        "v": 1,
        "device": _identity(device),
        "env": _versions(),
        "at": _stamp(_now()),
        "gbps": moved / copied.median_ms / 1e6,
        "tflops": flops / timed.median_ms / 1e9,
        "copy": {"bytes_moved": moved, **copied.to_dict()},
        "fma": {"flops": flops, "threads": _FMA_THREADS, "chains": _FMA_CHAINS,
                "iterations": _FMA_ITERS, **timed.to_dict()},
    }


def peak(*, refresh: bool = False) -> dict:
    """这张卡的实测峰值：{"gbps": 显存拷贝带宽（十进制 GB/s）, "tflops": FP32 FMA 吞吐（TFLOPS）}。

    第一次调用时现场测（2-4 关），结果缓存在 artifact 目录的 lab/peak/ 下，之后的关卡直接读缓存；
    refresh=True 重新测一次。两个数都是这张卡在当前软件上的实测值，不是厂商标称的理论峰值。

    - 带宽：两块各 512 MiB（显存不到 4 GiB 时取显存的 1/8）的缓冲区之间 copy_，
      读一遍写一遍，按 config.toml 的预热和重复次数计时，取中位数。
    - 算力：每个线程 16 条互不依赖的 FMA 链、每条 256 次的 HIP kernel（第一次要编译），链写成累加，
      编译器能用上双发射；先连着跑 0.2 秒等频率升上来，再按预热和重复次数计时，一次 FMA 记 2 次浮点运算，取中位数。
    """
    _require_gpu("hg.peak()")
    device = _device()
    path = _peak_path(device)
    record = None if refresh else _cached_peak(device)
    if record is None:
        print("现场测峰值：先做拷贝测试，再做 FMA 测试。第一次运行要编译 FMA 测试的 kernel，要等一会儿。")
        record = _measure_peak(device)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                        encoding="utf-8")
        source = "刚测出，已缓存"
    else:
        source = "读取缓存"
    print(f"{device['name']}（{device['gfx']}）的实测峰值，{source}：{path}")
    print("\n".join(_peak_lines(record)))
    return {"gbps": record["gbps"], "tflops": record["tflops"]}


def _peak_lines(record: Mapping) -> list[str]:
    """hg.peak() 打印的峰值和两个测试的测法；缓存里缺测法的细节时，那个测试只写一行峰值。"""
    lines = [f"  峰值带宽：{record['gbps']:.1f} GB/s"]
    copy = record.get("copy")
    if isinstance(copy, Mapping) and None not in (codes.positive(copy.get(key)) for key in ("bytes_moved", "median_ms")):
        moved = copy["bytes_moved"]
        lines.append(f"    拷贝测试：两块各 {moved / 2 / 2**20:.0f} MiB 的缓冲区之间 copy_，一次读写 {_bytes(moved)}，"
                     f"中位数 {copy['median_ms']:.4g} ms")
    lines.append(f"  峰值算力：{record['tflops']:.2f} TFLOPS")
    fma = record.get("fma")
    keys = ("flops", "threads", "chains", "iterations", "median_ms")
    if isinstance(fma, Mapping) and None not in (codes.positive(fma.get(key)) for key in keys):
        flops, threads = fma["flops"], fma["threads"]
        lines.append(f"    FMA 测试：{_amount(threads, '个')}线程，每个 {fma['chains']} 条链 × {fma['iterations']} 次 FMA，"
                     f"一次 {_amount(flops, '次')}浮点运算，中位数 {fma['median_ms']:.4g} ms")
        lines.append(f"    每个线程只读两个数、写一个数：算术强度约 {_plain(flops / threads / 12)} FLOP/字节，几乎全是计算")
    return lines


# ---------------------------------------------------------------- GPU 卡片

def _card_device(*, rocminfo: bool = True) -> tuple[dict, dict | None]:
    """卡片上的设备信息，和 rocminfo 里对应这张卡的那一段（不读或者没找到是 None）。

    PyTorch 没给 wave 大小时，用 rocminfo 的 Wavefront Size。hg.device_card() 和 hg.check_card() 共用。
    """
    device = _device()
    agent = _match_agent(device, _run_rocminfo()) if rocminfo else None
    if device["wave"] is None and agent is not None:
        device["wave"] = _leading_int(agent.get("Wavefront Size"))
    return device, agent


def device_card(*, rocminfo: bool = True) -> dict:
    """打印并返回这张 GPU 的卡片，附「我的 GPU 卡片」导入码（HGCARD1.，编码同通关码）。

    数据来自 PyTorch 的设备属性（按 WGP 计数的卡，CU 数是它报的 multi_processor_count 乘 2，见 _wgp_mode）；
    rocminfo=True 且能运行 rocminfo 时，再用它核对 CU 数和 wave 大小（PyTorch 没给 wave 大小时用 rocminfo 的）。
    2-4 关运行过 hg.peak() 后，卡片带上实测峰值。
    返回的 dict 包含卡片上的每一项、rocminfo 里对应这张卡的字段（rocminfo）和导入码（code）。
    """
    _require_gpu("hg.device_card()")
    device, agent = _card_device(rocminfo=rocminfo)
    env = _versions()
    record = _cached_peak(device)
    payload = {"v": codes.VERSION, "at": _stamp(_now()), "device": device, "env": env}
    if record is not None:
        payload["peak"] = {"gbps": record["gbps"], "tflops": record["tflops"]}
    code = codes.encode(codes.CARD, payload)

    lines = [
        "我的 GPU 卡片",
        f"  名称：{device['name']}",
        f"  架构：{device['gfx']}",
        f"  CU 数：{device['cus']}" + (f"（PyTorch 的 multi_processor_count 是 {device['cus'] // 2}，数的是 WGP，"
                                       "一个 WGP 两个 CU）" if _wgp_mode(device["gfx"]) else ""),
        f"  wave 大小：{device['wave'] or '未知'}",
        f"  显存：{device['memory_bytes'] / 2**30:.1f} GiB",
        f"  软件：ROCm {env['rocm'] or '未知'} · PyTorch {env['torch']} · Triton {env['triton'] or '未找到'}",
        (f"  实测峰值：{record['gbps']:.1f} GB/s · {record['tflops']:.2f} TFLOPS" if record is not None
         else "  实测峰值：还没测（2-4 关运行 hg.peak() 后补上）"),
    ]
    if rocminfo:
        lines.append(_rocminfo_note(device, agent))
    lines += ["导入码（复制到网页的「我的 GPU 卡片」里）：", code]
    print("\n".join(lines))
    return {**device, **env,
            "peak_gbps": record["gbps"] if record is not None else None,
            "peak_tflops": record["tflops"] if record is not None else None,
            "rocminfo": agent, "code": code}


def _rocminfo_note(device: Mapping, agent: Mapping | None) -> str:
    if agent is None:
        return "  rocminfo：没有找到 rocminfo 或其中没有这张卡，跳过核对"
    differences = [
        f"{label} {found}（上面是 {device[key]}）"
        for label, key, found in (("CU 数", "cus", _leading_int(agent.get("Compute Unit"))),
                                  ("wave 大小", "wave", _leading_int(agent.get("Wavefront Size"))))
        if found is not None and found != device[key]
    ]
    if differences:
        return "  rocminfo：" + "，".join(differences)
    return "  rocminfo：CU 数和 wave 大小和上面一致"


# ---------------------------------------------------------------- 校验

@dataclass(frozen=True)
class CheckCase:
    """一个形状的校验结果；没通过时 reason 是中文原因。"""

    shape: str
    passed: bool
    max_abs_error: float | None = None
    reason: str | None = None


@dataclass(frozen=True)
class CheckReport:
    """hg.check() 的结果：每个形状一条，交成绩时用 passed 和 total。"""

    cases: tuple[CheckCase, ...]

    @property
    def passed(self) -> int:
        return sum(case.passed for case in self.cases)

    @property
    def total(self) -> int:
        return len(self.cases)

    @property
    def all_passed(self) -> bool:
        return self.total > 0 and self.passed == self.total

    def __repr__(self) -> str:
        return f"CheckReport(通过 {self.passed}/{self.total})"


def _shape(value) -> tuple[int, ...] | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return (value,) if value >= 0 else None
    if isinstance(value, (tuple, list)) and all(
        isinstance(size, int) and not isinstance(size, bool) and size >= 0 for size in value
    ):
        return tuple(value)
    return None


def _cases(shapes, inputs: int) -> list[tuple[tuple[int, ...], ...]]:
    """把 shapes 展开成用例：每个用例是每个输入的形状。"""
    if isinstance(shapes, (str, bytes, int)) or not isinstance(shapes, Iterable):
        raise TypeError("shapes 要是一组形状，例如 [1000, (64, 1000)]")
    cases = []
    for item in shapes:
        single = _shape(item)
        if single is not None:
            cases.append((single,) * inputs)
        elif isinstance(item, (tuple, list)) and item and all(_shape(part) is not None for part in item):
            if inputs != 1:
                raise ValueError("用例里已经逐个写了输入的形状，就不要再写 inputs")
            cases.append(tuple(_shape(part) for part in item))
        else:
            raise ValueError(f"看不懂的形状 {item!r}：写成 1000、(64, 1000)，"
                             "或者每个输入一个形状，例如 [(64, 32), (32, 16)]")
    if not cases:
        raise ValueError("shapes 至少要有一个形状")
    return cases


def _label(shape: tuple[int, ...]) -> str:
    return "×".join(map(str, shape)) if shape else "标量"


def _case_label(case: tuple[tuple[int, ...], ...]) -> str:
    if len(set(case)) == 1:
        return _label(case[0])
    return ", ".join(_label(shape) for shape in case)


def _difference(actual, wanted: list[torch.Tensor], rtol: float, atol: float) -> tuple[str | None, float]:
    """把 fn 的输出和参考输出（列表）比较，返回（没通过的原因，没问题时是 None；最大绝对误差）。"""
    if isinstance(actual, torch.Tensor):
        got = [actual]
    elif isinstance(actual, (tuple, list)):
        got = list(actual)
    else:
        got = [actual]
    if len(got) != len(wanted):
        return f"输出有 {len(got)} 个，参考有 {len(wanted)} 个", math.nan
    worst = 0.0
    for index, (out, ref) in enumerate(zip(got, wanted)):
        name = "输出" if len(wanted) == 1 else f"第 {index + 1} 个输出"
        if not isinstance(out, torch.Tensor):
            return f"{name}不是 Tensor，而是 {type(out).__name__}", math.nan
        if out.shape != ref.shape:
            return f"{name}的形状是 {tuple(out.shape)}，参考是 {tuple(ref.shape)}", math.nan
        if out.dtype != ref.dtype:
            return f"{name}的类型是 {out.dtype}，参考是 {ref.dtype}", math.nan
        if out.device != ref.device:
            return f"{name}在 {out.device} 上，参考在 {ref.device} 上", math.nan
        if out.numel() == 0:
            continue
        out64, ref64 = out.double(), ref.double()
        error = (out64 - ref64).abs()
        finite = torch.isfinite(error)
        if bool(finite.any()):
            worst = max(worst, float(error[finite].max()))
        bad = int((~torch.isclose(out64, ref64, rtol=rtol, atol=atol)).sum())
        if bad:
            extra = "，含 NaN 或 Inf" if not bool(finite.all()) else ""
            return f"{name}有 {bad}/{out.numel()} 个元素超出误差（最大绝对误差 {worst:.3g}{extra}）", worst
    return None, worst


#: guard=True 时 hg.check 在输出前后各留的护栏、在每个输入后面接的空位，按元素个数算。HIP 一个线程块
#: 最多 1024 个线程，Triton 的 BLOCK 一般也只有几千：最后一组整组越界读写，都落在这一段里。
GUARD_ELEMENTS = 1 << 16
#: 护栏按元素大小换成同样宽的整数来看，事先填的 -1 就是每一位都是 1（按浮点数看是 NaN）。
_GUARD_BITS = {1: torch.int8, 2: torch.int16, 4: torch.int32, 8: torch.int64}


def _padded(arg: torch.Tensor) -> torch.Tensor:
    """guard=True 时的输入：同样的数，后面接 GUARD_ELEMENTS 个 0；越界读到的是这些 0，不会碰到别的数据。"""
    buffer = torch.zeros(arg.numel() + GUARD_ELEMENTS, dtype=arg.dtype, device=arg.device)
    view = buffer[:arg.numel()].view(arg.shape)
    view.copy_(arg)
    return view


def _fenced(like: torch.Tensor, device: torch.device) -> tuple[torch.Tensor, torch.Tensor]:
    """guard=True 时的输出：前后各 GUARD_ELEMENTS 个元素的护栏，连同输出本身，每一位都事先填成 1。

    返回（整块缓冲区按整数看的视图，输出）。输出是缓冲区中间的一段，形状、类型和 like 相同，在 device 上。
    越界写进护栏的值来自输入或者输入后面的 0，不会正好是这个位型。
    """
    bits = torch.full((like.numel() + 2 * GUARD_ELEMENTS,), -1, dtype=_GUARD_BITS[like.element_size()],
                      device=device)
    out = bits.view(like.dtype)[GUARD_ELEMENTS:GUARD_ELEMENTS + like.numel()].view(like.shape)
    return bits, out


def _fence_problem(bits: torch.Tensor, out: torch.Tensor, returned) -> str | None:
    """fn 运行之后看护栏：写到了输出外面，或者输出里有元素没写到，返回原因；都没有返回 None。"""
    end = GUARD_ELEMENTS + out.numel()
    before = int((bits[:GUARD_ELEMENTS] != -1).sum())
    after = int((bits[end:] != -1).sum())
    if before or after:
        where = "、".join(f"{side} {count} 个" for side, count in (("前面", before), ("后面", after)) if count)
        return f"越界写：输出{where}位置被改写了，kernel 写到了输出外面"
    missing = int((bits[GUARD_ELEMENTS:end] == -1).sum())
    if not missing:
        return None
    if isinstance(returned, torch.Tensor) and returned.data_ptr() != out.data_ptr():
        return f"有 {missing}/{out.numel()} 个元素没写到：fn 返回了另一个 Tensor，结果要写进传给它的 out"
    return f"有 {missing}/{out.numel()} 个元素没写到（还是 hg.check 事先填的值）"


def _check_case(fn, ref, case, *, dtype, device, rtol, atol, generator, guard) -> CheckCase:
    label = _case_label(case)
    worst = 0.0
    for attempt in range(2):
        args = [torch.randn(shape, generator=generator).to(device=device, dtype=dtype) for shape in case]
        expected = ref(*(arg.clone() for arg in args))
        wanted = [expected] if isinstance(expected, torch.Tensor) else expected
        if not isinstance(wanted, (tuple, list)) or not wanted \
                or not all(isinstance(item, torch.Tensor) for item in wanted):
            raise TypeError("ref 要返回一个 Tensor，或者几个 Tensor 组成的元组")
        if guard:
            if len(wanted) != 1 or not wanted[0].is_floating_point():
                raise TypeError("guard=True 时 ref 要返回一个浮点 Tensor：护栏只围一个输出")
            args = [_padded(arg) for arg in args]
            bits, out = _fenced(wanted[0], device)
        try:
            if guard:
                problem = _fence_problem(bits, out, fn(*args, out=out))
                problem, error = (problem, math.nan) if problem else _difference(out, list(wanted), rtol, atol)
            else:
                problem, error = _difference(fn(*args), list(wanted), rtol, atol)
        except Exception as failure:  # 读者的实现出错只算这个形状没通过，继续校验其他形状
            message = (str(failure).strip().splitlines() or [""])[0]
            if guard and isinstance(failure, TypeError) and "unexpected keyword argument 'out'" in message:
                return CheckCase(label, False, None, "fn 不接受 out：guard=True 时 hg.check 用 fn(*输入, out=输出) 调用")
            return CheckCase(label, False, None, f"运行出错：{type(failure).__name__}: {message}")
        if problem is not None:
            prefix = "换一组随机数后，" if attempt else ""
            return CheckCase(label, False, None if math.isnan(error) else error, prefix + problem)
        worst = max(worst, error)
    return CheckCase(label, True, worst)


def check(fn: Callable, ref: Callable, shapes: Iterable, *, dtype: torch.dtype = torch.float32,
          atol: float | None = None, rtol: float | None = None, inputs: int = 1,
          seed: int | None = None, device: str = "cuda", guard: bool = False) -> CheckReport:
    """多形状正确性校验：每个形状生成固定种子的随机输入，比较 fn 和 ref 的输出。

    shapes 的每一项是一个用例：
      - 一个整数或一个形状，例如 1000、(64, 1000)：生成 inputs 个这个形状的输入（默认 1 个）；
      - 每个输入一个形状，例如 [(64, 32), (32, 16)]：输入形状不同的情况（矩阵乘）。
    fn(*输入) 和 ref(*输入) 都返回结果 Tensor（或几个 Tensor 组成的元组）。每个用例换两组随机数
    各比一次，两次都对才算通过：没写到的输出位置碰巧留着上一次的正确结果时，第二次能发现。
    输入是标准正态分布，种子默认取 config.toml 的 [experiment] seed。
    atol、rtol 一起写，或者都不写（用 torch.testing.assert_close 对这个 dtype 的默认值）。
    fn 抛异常只记为这个形状没通过，继续校验后面的形状；ref 出错直接抛出。

    guard=True 时还查越界写：输出由 hg.check 准备，用 fn(*输入, out=输出) 调用，结果要写进 out
    （ref 要返回一个浮点 Tensor）。输出前后各留 GUARD_ELEMENTS 个元素的护栏，连同输出本身事先填满；
    每个输入后面接同样长的一段 0，越界读读到的是这些 0。fn 运行完，护栏里有元素变了（写到了输出外面），
    或者输出里还有没写到的元素，这个形状就没通过。
    """
    if not callable(fn) or not callable(ref):
        raise TypeError("fn 和 ref 都要是函数（可以调用的对象）")
    if not isinstance(guard, bool):
        raise TypeError("guard 只能写 True 或 False")
    if dtype not in _TOLERANCES:
        raise TypeError("dtype 只能是 torch.float16、torch.bfloat16、torch.float32 或 torch.float64")
    if (atol is None) != (rtol is None):
        raise ValueError("atol 和 rtol 要一起写，或者都不写（用默认值）")
    if atol is not None and (codes.number(atol) is None or atol < 0 or codes.number(rtol) is None or rtol < 0):
        raise ValueError("atol 和 rtol 要是有限的非负数")
    if isinstance(inputs, bool) or not isinstance(inputs, int) or inputs < 1:
        raise ValueError("inputs 要是正整数")
    if seed is None:
        seed = settings()["seed"]
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ValueError("seed 要是非负整数")
    target = torch.device(device)
    if target.type not in ("cpu", "cuda"):
        raise ValueError("device 只能是 cuda（ROCm 的 GPU 也叫 cuda）或 cpu")
    cases = _cases(shapes, inputs)
    if target.type == "cuda":
        _require_gpu("hg.check()")
    rtol, atol = (rtol, atol) if rtol is not None else _TOLERANCES[dtype]
    generator = torch.Generator().manual_seed(seed)
    report = CheckReport(tuple(
        _check_case(fn, ref, case, dtype=dtype, device=target, rtol=rtol, atol=atol, generator=generator,
                    guard=guard)
        for case in cases
    ))
    fence = f"；输出前后各留 {GUARD_ELEMENTS} 个元素的护栏" if guard else ""
    print(f"校验 {report.total} 个形状（{str(dtype).removeprefix('torch.')}，rtol={rtol:g}，atol={atol:g}{fence}）")
    for case in report.cases:
        if case.passed:
            print(f"  ✓ {case.shape}（最大绝对误差 {case.max_abs_error:.3g}）")
        else:
            print(f"  ✗ {case.shape}：{case.reason}")
    print(f"通过 {report.passed}/{report.total}")
    return report


# ---------------------------------------------------------------- 计时

@dataclass(frozen=True)
class Timing:
    """hg.bench() 的结果（毫秒）。measurement 是原始记录，含每次样本和计时边界说明。"""

    label: str
    median_ms: float
    p10_ms: float
    p90_ms: float
    samples_ms: tuple[float, ...]
    measurement: Measurement

    def __repr__(self) -> str:
        return f"Timing({self.label!r}，中位数 {self.median_ms:.4g} ms)"


def _quantile(ordered: list[float], q: float) -> float:
    """线性插值的分位数，和 numpy.percentile 的默认算法相同。"""
    position = (len(ordered) - 1) * q
    low = math.floor(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def _callable_name(fn) -> str:
    name = getattr(fn, "__name__", "")
    return name if isinstance(name, str) and name and not name.startswith("<") else "kernel"


def _counts_or_config(warmup: int | None, repeat: int | None) -> tuple[int, int]:
    """预热和计时的次数：没写的那个用 config.toml 的 [experiment]。"""
    if warmup is None or repeat is None:
        config = settings()
        warmup = config["warmup"] if warmup is None else warmup
        repeat = config["repeat"] if repeat is None else repeat
    return warmup, repeat


def _timing_of(measured: Measurement) -> Timing:
    ordered = sorted(measured.samples_ms)
    return Timing(measured.label, measured.median_ms, _quantile(ordered, 0.1), _quantile(ordered, 0.9),
                  measured.samples_ms, measured)


def _time(fn, label: str, warmup: int | None, repeat: int | None, device: str, caller: str) -> Timing:
    warmup, repeat = _counts_or_config(warmup, repeat)
    if torch.device(device).type == "cuda":
        _require_gpu(caller)
    return _timing_of(benchmark(fn, device=device, label=label, warmup=warmup, repeat=repeat))


def bench(fn: Callable[[], object], *, warmup: int | None = None, repeat: int | None = None,
          label: str | None = None, device: str = "cuda") -> Timing:
    """可信计时：先预热，再计时 repeat 次，返回中位数、p10、p90 和全部样本（毫秒）。

    沿用 measurement.benchmark 的协议：fn 是准备好输入和输出的无参函数；每次调用前后在当前
    stream 上记录 GPU 事件，在计时区间外同步；准备输入、分配内存和校验结果都不在计时区间里。
    warmup、repeat 不写时用 config.toml 的 [experiment]。device="cpu" 时改用 perf_counter 计墙钟时间。
    """
    name = label or _callable_name(fn)
    timing = _time(fn, name, warmup, repeat, device, "hg.bench()")
    measured = timing.measurement
    print(f"{name}：中位数 {timing.median_ms:.4g} ms（p10 {timing.p10_ms:.4g}，p90 {timing.p90_ms:.4g}；"
          f"预热 {measured.warmup} 次，计时 {measured.repeat} 次）")
    return timing


# ---------------------------------------------------------------- 对比

def _rate(amount: float, milliseconds: float, scale: float) -> float:
    return amount / milliseconds / scale if milliseconds > 0 else math.nan


@dataclass(frozen=True, eq=False)
class Comparison:
    """hg.compare() 的结果：table 是对比表，metrics(name) 生成交成绩用的测量数据。"""

    table: pd.DataFrame
    timings: dict[str, Timing]
    baseline: str
    bytes_moved: float | None
    flops: float | None
    peak: dict | None

    def metrics(self, name: str) -> dict[str, float]:
        """把 name 这一行变成 hg.submit() 的 metrics。

        包括 median_ms、p10_ms、p90_ms；给了 bytes_moved 时有 gbps（有峰值时再加 peak_gbps），
        给了 flops 时有 tflops（和 peak_tflops）；其他实现的名字是小写字母、数字、下划线时，
        再附上它们的中位数 <名字>_ms，例如 torch_ms。
        """
        if name not in self.timings:
            raise KeyError(f"对比表里没有 {name!r}，现有：{'、'.join(self.timings)}")
        timing = self.timings[name]
        result = {"median_ms": timing.median_ms, "p10_ms": timing.p10_ms, "p90_ms": timing.p90_ms}
        peak = self.peak or {}
        for amount, key, scale in ((self.bytes_moved, "gbps", 1e6), (self.flops, "tflops", 1e9)):
            if amount is None:
                continue
            result[key] = _rate(amount, timing.median_ms, scale)
            if codes.positive(peak.get(key)) is not None:
                result[f"peak_{key}"] = float(peak[key])
        for other, measured in self.timings.items():
            key = f"{other}_ms"
            if other != name and codes.METRIC_NAME.fullmatch(key) and key not in result:
                result[key] = measured.median_ms
        return result

    def __repr__(self) -> str:
        return f"Comparison({len(self.timings)} 个实现，基线 {self.baseline!r})"


_HEADERS = {
    "median_ms": ("中位数 ms", "{:.4g}"), "p10_ms": ("p10 ms", "{:.4g}"), "p90_ms": ("p90 ms", "{:.4g}"),
    "gbps": ("带宽 GB/s", "{:.1f}"), "gbps_of_peak": ("占峰值带宽", "{:.1%}"),
    "tflops": ("算力 TFLOPS", "{:.2f}"), "tflops_of_peak": ("占峰值算力", "{:.1%}"),
    "speedup": ("相对基线", "{:.2f}×"),
}


def compare(candidates: Mapping[str, Callable[[], object] | Timing], *,
            bytes_moved: float | None = None, flops: float | None = None,
            baseline: str | None = None, peak: Mapping | None = None,
            warmup: int | None = None, repeat: int | None = None) -> Comparison:
    """多个实现的对比表：耗时、有效带宽、占峰值比例、相对基线的倍数。

    candidates：{名字: 准备好的无参函数，或 hg.bench() 的结果}；函数按 hg.bench 的协议计时。
    bytes_moved、flops：一次调用按算法搬运的字节数和浮点运算次数（不是硬件计数器读数），
    给了才有带宽（十进制 GB/s）和算力（TFLOPS）两列。
    baseline：倍数的基准，默认是名为 "torch" 的实现，没有就用第一个；倍数 = 基线耗时 ÷ 这一行的耗时，
    大于 1 表示比基线快。peak：峰值 {"gbps", "tflops"}，默认读 hg.peak() 的缓存（不会现场测）。
    """
    if not isinstance(candidates, Mapping) or not candidates:
        raise TypeError("candidates 要是 {名字: 无参函数 或 hg.bench() 的结果}，至少一个")
    for name, item in candidates.items():
        if not isinstance(name, str) or not name:
            raise ValueError("每个实现都要有名字（非空字符串）")
        if not isinstance(item, Timing) and not callable(item):
            raise TypeError(f"{name}：要是无参函数或 hg.bench() 的结果")
    for value, key in ((bytes_moved, "bytes_moved"), (flops, "flops")):
        if value is not None and codes.positive(value) is None:
            raise ValueError(f"{key} 要是有限的正数")
    if baseline is None:
        baseline = "torch" if "torch" in candidates else next(iter(candidates))
    if baseline not in candidates:
        raise ValueError(f"基线 {baseline!r} 不在 candidates 里")
    if peak is None and (bytes_moved is not None or flops is not None) \
            and torch.version.hip is not None and torch.cuda.is_available():
        peak = _cached_peak(_device())

    timings = {
        name: item if isinstance(item, Timing) else _time(item, name, warmup, repeat, "cuda", "hg.compare()")
        for name, item in candidates.items()
    }
    peak = dict(peak) if peak is not None else None
    base = timings[baseline].median_ms
    rows = {}
    for name, timing in timings.items():
        row = {"median_ms": timing.median_ms, "p10_ms": timing.p10_ms, "p90_ms": timing.p90_ms}
        for amount, key, scale in ((bytes_moved, "gbps", 1e6), (flops, "tflops", 1e9)):
            if amount is None:
                continue
            row[key] = _rate(amount, timing.median_ms, scale)
            reference = codes.positive((peak or {}).get(key))
            if reference is not None:
                row[f"{key}_of_peak"] = row[key] / reference
        row["speedup"] = base / timing.median_ms if timing.median_ms > 0 else math.nan
        rows[name] = row
    table = pd.DataFrame.from_dict(rows, orient="index")
    result = Comparison(table, timings, baseline, bytes_moved, flops, peak)

    formatters = {column: _HEADERS[column][1].format for column in table.columns}
    headers = [_HEADERS[column][0] if column != "speedup" else f"相对 {baseline}" for column in table.columns]
    with pd.option_context("display.unicode.east_asian_width", True):
        print(table.to_string(formatters=formatters, header=headers))
    missing = [key for amount, key in ((bytes_moved, "gbps"), (flops, "tflops"))
               if amount is not None and codes.positive((peak or {}).get(key)) is None]
    if missing:
        print("（还没有这张卡的实测峰值，所以没有占峰值的比例：2-4 关运行 hg.peak() 之后就有了）")
    return result


# ---------------------------------------------------------------- 交成绩

@dataclass(frozen=True, eq=False)
class Submission:
    """hg.submit() 的结果：凭证内容、通关码、通关链接和凭证 JSON 的保存位置。"""

    credential: dict
    code: str
    link: str
    path: Path

    def __repr__(self) -> str:
        return f"Submission({self.credential['stage']!r}，{_ROUTE_NAMES[self.credential['route']]})"


def _site() -> str:
    section = configuration().get("lab", {})
    if not isinstance(section, dict):
        raise ValueError("config.toml 的 [lab] 要是一个表")
    unknown = section.keys() - {"site"}
    if unknown:
        raise ValueError(f"config.toml 的 [lab] 里有不认识的设置：{', '.join(sorted(unknown))}")
    site = section.get("site", DEFAULT_SITE)
    if not isinstance(site, str) or not re.fullmatch(r"https?://[^\s?#]+", site):
        raise ValueError(f"lab.site 要是 http:// 或 https:// 开头、不带 ? 和 # 的站点地址，现在是 {site!r}")
    return site.rstrip("/")


def _stage_page(stage: str, route: str) -> tuple[str, str]:
    """检查关卡 id 和路线，返回关卡页的路径和显示名。"""
    if not isinstance(stage, str) or not codes.STAGE_ID.fullmatch(stage):
        raise ValueError(f"关卡 id 写法不对：{stage!r}，应该像 forge-softmax 这样，和 outline.json 里一致")
    if route not in codes.ROUTES:
        raise ValueError(f"路线只能是 hip、triton 或 shared，现在是 {route!r}")
    path = _repo_file("docs", "course", "outline.json")
    if path is None:  # 不在仓库里运行：只能按「区域-slug」拼出地址
        zone, slug = stage.split("-", 1)
        return f"/{zone}/{slug}/", stage
    outline = json.loads(path.read_text(encoding="utf-8"))
    zones = {zone["id"]: zone for zone in outline.get("zones", [])}
    for item in outline.get("stages", []):
        if item.get("id") != stage:
            continue
        if not item.get("gpu"):
            raise ValueError(f"{stage} 不是真卡关卡，没有实验室，也不用交成绩")
        mode = item.get("routes") or zones.get(item.get("zone"), {}).get("routes") or "shared"
        allowed = ("hip", "triton") if mode == "split" else ("shared",)
        if route not in allowed:
            raise ValueError(f"{stage} 的路线设置是 {mode}，route 应该是 {' 或 '.join(allowed)}")
        return f"/{item['zone']}/{item['slug']}/", f"{item['code']} {item['title']}"
    for group in outline.get("exercises", []):
        for item in group.get("items", []):
            if item.get("id") != stage:
                continue
            if item.get("env") != "gpu":
                raise ValueError(f"{stage} 是在浏览器里做的副本，不用交成绩")
            return f"/dungeon/{item['slug']}/", f"副本 {item['title']}"
    raise ValueError(f"outline.json 里没有关卡 {stage}，请检查关卡 id")


def _checks_dict(checks) -> dict:
    if isinstance(checks, CheckReport):
        passed, total = checks.passed, checks.total
    elif isinstance(checks, Mapping):
        passed, total = codes.count(checks.get("passed")), codes.count(checks.get("total"))
    else:
        raise TypeError('checks 要是 hg.check() 的结果，或者 {"passed": 通过数, "total": 总数}')
    if passed is None or total is None or total < 1 or passed > total:
        raise ValueError("checks 要满足 0 ≤ passed ≤ total，并且 total ≥ 1")
    return {"passed": passed, "total": total}


def _metrics_dict(metrics) -> dict[str, float]:
    if not isinstance(metrics, Mapping):
        raise TypeError('metrics 要是 {名字: 数} 的字典，例如 hg.compare(...).metrics("mine")')
    result = {}
    for name, value in metrics.items():
        if not isinstance(name, str) or not codes.METRIC_NAME.fullmatch(name):
            raise ValueError(f"测量项的名字 {name!r} 只能用小写字母、数字和下划线，并以字母开头")
        number = None
        if isinstance(value, numbers.Real) and not isinstance(value, bool):
            try:
                number = codes.positive(float(value))
            except (OverflowError, ValueError):
                number = None
        if number is None:
            raise ValueError(f"测量项 {name} 要是有限的正数，现在是 {value!r}")
        result[name] = number
    return result


def submit(stage: str, route: str, *, checks, metrics) -> Submission:
    """生成通关凭证（课程规则），打印通关链接和通关码，把凭证 JSON 存进 artifact 目录。

    stage：关卡 id，例如 forge-softmax；route：hip、triton，或共用路线的 shared。
    checks：hg.check() 的结果，或者 {"passed": 通过的形状数, "total": 形状总数}。
    metrics：{名字: 有限的正数}，例如 hg.compare(...).metrics("mine")，或者 {"median_ms": t.median_ms}。
    凭证只有关卡、路线、时间、GPU 型号、软件版本、校验结果和测量数据，不含任何个人信息；
    星级由关卡页按本关规则重新计算，凭证里不写结论。通关链接的站点地址来自 config.toml 的 [lab] site。
    """
    page, title = _stage_page(stage, route)
    checks = _checks_dict(checks)
    metrics = _metrics_dict(metrics)
    site = _site()
    _require_gpu("hg.submit()")
    moment = _now()
    credential = {
        "v": codes.VERSION,
        "stage": stage,
        "route": route,
        "at": _stamp(moment),
        "device": _identity(_device()),
        "env": _versions(),
        "checks": checks,
        "metrics": metrics,
    }
    code = codes.encode(codes.CREDENTIAL, credential)
    link = f"{site}{page}#lab={code}"
    path = artifact_root() / "lab" / stage / f"{moment:%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(credential, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    shown = " · ".join(f"{name} {value:.4g}" for name, value in metrics.items()) or "无"
    print(f"通关凭证：{title}（{_ROUTE_NAMES[route]}）")
    print(f"  校验：{checks['passed']}/{checks['total']} 通过")
    print(f"  测量：{shown}")
    print("通关链接（在浏览器里打开，成绩会导入关卡页）：")
    print(link)
    print("通关码（也可以粘贴到关卡页的「导入成绩」里）：")
    print(code)
    print(f"凭证 JSON 已保存：{path}")
    print("星级由关卡页按本关规则计算。")
    return Submission(credential, code, link, path)


# ---------------------------------------------------------------- 开工准备（2-1）

#: 实验环境指南（L-06）在站点上的路径；hg.check_env() 的提示链到它的小节。
_GUIDE = "/handbook/setup/"
#: 环境检查每一项的状态和打印时的记号：ok 通过，fail 没通过，warn 提醒，skip 跳过。
_MARKS = {"ok": "✓", "fail": "✗", "warn": "⚠", "skip": "–"}


@dataclass(frozen=True)
class EnvItem:
    """环境检查的一项。status 是 _MARKS 的键：fail 表示实验做不了，warn 只影响后面某条路线，
    skip 是没法检查（前面的项没通过，或者缺少比较的依据）。hint 是怎么改，link 是实验环境指南里对应的小节。"""

    name: str
    status: str
    detail: str
    hint: str | None = None
    link: str | None = None


@dataclass(frozen=True)
class EnvReport:
    """hg.check_env() 的结果：每一项一条；ok 表示没有没通过（✗）的项。"""

    items: tuple[EnvItem, ...]

    @property
    def ok(self) -> bool:
        return not any(item.status == "fail" for item in self.items)

    def __repr__(self) -> str:
        count = {status: sum(item.status == status for item in self.items) for status in _MARKS}
        return f"EnvReport(✓ {count['ok']}，✗ {count['fail']}，⚠ {count['warn']}，– {count['skip']})"


def _guide(anchor: str) -> str:
    return f"{_site()}{_GUIDE}#{anchor}"


def _first_line(error: BaseException) -> str:
    message = (str(error).strip().splitlines() or [""])[0]
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


def _release(text: str | None) -> tuple[int, int] | None:
    """版本号的主版本和次版本：10.0.0 → (10, 0)，6.4.1-120 → (6, 4)；读不出是 None。"""
    match = re.match(r"\s*(\d+)\.(\d+)", text or "")
    return (int(match.group(1)), int(match.group(2))) if match else None


def _torch_rocm() -> str | None:
    """PyTorch 是为哪版 ROCm 编译的：版本号里 +rocm 后面那段，例如 2.13.0+rocm10.0.0 → 10.0.0。"""
    match = re.search(r"\+rocm(\d+(?:\.\d+)*)", str(torch.__version__))
    return match.group(1) if match else None


def _probe_gpu() -> str | None:
    """在 GPU 上算一次 2x + 1，和 CPU 比：一样返回 None，不一样或者出错返回原因。"""
    x = torch.arange(1024, dtype=torch.float32)
    try:
        y = (x.to("cuda") * 2 + 1).cpu()  # 拷回 CPU 要等 GPU 算完，GPU 上的错误在这里冒出来
    except Exception as error:
        return _first_line(error)
    return None if torch.equal(y, x * 2 + 1) else "GPU 算出的结果和 CPU 的不一样"


def _hip_tools() -> tuple[str | None, str | None, bool]:
    """HIP 路线编译 kernel 的工具（hg.compile_kernel 和 %%hip 用的同一套）：
    (PyTorch 找到的 ROCm 目录, hipcc 的路径, 有没有 ninja)，找不到的是 None / False。"""
    from torch.utils import cpp_extension

    home = cpp_extension.ROCM_HOME
    hipcc = Path(home) / "bin" / "hipcc" if home else None
    return (str(home) if home else None, str(hipcc) if hipcc is not None and hipcc.is_file() else None,
            bool(cpp_extension.is_ninja_available()))


def _build_tools() -> tuple[str | None, str | None, str | None]:
    """两条路线现场编译都要的系统工具：(C 编译器, C++ 编译器, Python.h 所在的目录)，找不到的是 None。

    HIP 路线：PyTorch 的扩展构建工具用 C++ 编译器（环境变量 CXX，没设是 c++）编译调用 kernel 的那段 C++，
    hipcc 编 kernel，两边都要 include Python.h。Triton 路线：第一次启动 kernel 时，Triton 用 C 编译器（环境变量 CC，
    没设时找 gcc、clang）把一小段启动代码编成 Python 扩展，也要 Python.h。Python.h 按 PyTorch 的找法找
    （sysconfig 的 posix_prefix 下的 include 目录）。系统自带的 Python 常常没装开发头文件。
    """
    cc_name = os.environ.get("CC")
    cc = shutil.which(cc_name) if cc_name else shutil.which("gcc") or shutil.which("clang")
    cxx = shutil.which(os.environ.get("CXX", "c++"))
    include = sysconfig.get_path("include", scheme="posix_prefix")
    headers = include if include and (Path(include) / "Python.h").is_file() else None
    return cc, cxx, headers


def _build_fixes(*, compiler: str | None, headers: str | None, which: str) -> list[str]:
    """缺编译器或 Python.h 时怎么改（Ubuntu 上的装法）。which 是缺的那种编译器的名字：C 或 C++。"""
    fixes = []
    if not compiler:
        fixes.append(f"{which} 编译器：在终端装上（Ubuntu 上是 sudo apt install build-essential），再重启内核")
    if not headers:
        release = f"{sys.version_info.major}.{sys.version_info.minor}"
        fixes.append(f"Python.h 是这个 Python（{release}）的开发头文件：在终端装上"
                     f"（Ubuntu 上是 sudo apt install python{release}-dev），再重启内核")
    return fixes


def _triton_version() -> str | None:
    """Triton 的版本；找不到 triton 这个包时是 None。"""
    if importlib.util.find_spec("triton") is None:
        return None
    return _package_version("triton", "pytorch-triton-rocm", "triton-rocm") or "版本未知"


#: hg.check_env() 的六项，按检查的顺序：前三项没通过记 fail，后三项记 warn。
_ENV_NAMES = ("PyTorch 是 ROCm 版", "看得到 GPU", "GPU 算得对", "ROCm 和 PyTorch 版本一致",
              "HIP 编译工具（HIP 路线用）", "Triton（Triton 路线用）")


def _env_items() -> list[EnvItem]:
    """hg.check_env() 的六项检查结果，顺序同 _ENV_NAMES。"""
    rocm_name, gpu_name, probe_name, version_name, hip_name, triton_name = _ENV_NAMES
    troubleshooting, local = _guide("troubleshooting"), _guide("local")
    if torch.version.hip is None:
        return [EnvItem(rocm_name, "fail", f"当前内核里的 PyTorch（{torch.__version__}）不是 ROCm 版",
                        "本地换成装了 ROCm 版 PyTorch 的内核，云平台上重新启动一个实例。"
                        "别在 Notebook 里 pip install torch：装上的是 CUDA 版。", troubleshooting),
                *(EnvItem(name, "skip", "PyTorch 不是 ROCm 版，没法检查") for name in _ENV_NAMES[1:])]
    items = [EnvItem(rocm_name, "ok", f"PyTorch {torch.__version__}，HIP {torch.version.hip}")]

    if torch.cuda.is_available() and torch.cuda.device_count() > 0:
        device = _device()
        count = torch.cuda.device_count()
        extra = f"，共 {count} 块，用的是第 {torch.cuda.current_device()} 块" if count > 1 else ""
        items.append(EnvItem(gpu_name, "ok", f"{device['name']}（{device['gfx']}）{extra}"))
        problem = _probe_gpu()
        if problem is None:
            items.append(EnvItem(probe_name, "ok", "在 GPU 上算了 1024 个数，和 CPU 算的一样"))
        else:
            items.append(EnvItem(
                probe_name, "fail", problem,
                f"报错里有 invalid device function 时，多半是这版 PyTorch 没有 {device['gfx']} 能用的 GPU 代码："
                "换一个和这张卡配套的 PyTorch（本地按指南第 3 步改设备标签）。", local))
    else:
        items.append(EnvItem(
            gpu_name, "fail", "PyTorch 看不到 GPU",
            "服务器没有挂 GPU，或者当前用户不能访问 /dev/kfd 和 /dev/dri。在终端运行 rocminfo："
            "列不出 GPU，就先按指南装好驱动、配好权限。", troubleshooting))
        items.append(EnvItem(probe_name, "skip", "看不到 GPU，没法检查"))

    built, installed = _torch_rocm(), _rocm_version()
    if built is None:
        items.append(EnvItem(version_name, "skip",
                             f"PyTorch 的版本号（{torch.__version__}）里没写它是为哪版 ROCm 编译的，没法比"))
    elif installed is None:
        items.append(EnvItem(version_name, "warn", f"PyTorch 为 ROCm {built} 编译，没找到装好的 ROCm SDK",
                             "HIP 路线编译 kernel 要用 ROCm SDK 里的编译器，走 HIP 路线之前按指南装好。", local))
    elif _release(built) == _release(installed):
        items.append(EnvItem(version_name, "ok", f"PyTorch 为 ROCm {built} 编译，装的 ROCm 是 {installed}"))
    else:
        items.append(EnvItem(
            version_name, "warn", f"PyTorch 为 ROCm {built} 编译，装的 ROCm 是 {installed}",
            "HIP 路线用 ROCm 的编译器编 kernel，再交给 PyTorch 调用：两边版本对不上，可能编不过或者加载不了。"
            "换成同一版本的 ROCm 和 PyTorch。", local))

    home, hipcc, ninja = _hip_tools()
    cc, cxx, headers = _build_tools()
    if hipcc and ninja and cxx and headers:
        items.append(EnvItem(hip_name, "ok", f"hipcc 在 {hipcc}，ninja、C++ 编译器和 Python.h 也有"))
    else:
        fixes = []
        if not hipcc:
            fixes.append(f"hipcc 在 ROCm SDK 的 bin 目录里（PyTorch 找到的 ROCm 目录：{home or '没有'}）："
                         "按指南装好 SDK，让环境变量 ROCM_PATH 指向它，再重启内核")
        if not ninja:
            fixes.append("ninja 是编译 PyTorch 扩展用的构建工具：在终端里给这个内核的 Python 装上"
                         "（pip install ninja），再重启内核")
        fixes += _build_fixes(compiler=cxx, headers=headers, which="C++")
        missing = "、".join(tool for tool, found in (("hipcc", hipcc), ("ninja", ninja), ("C++ 编译器", cxx),
                                                     ("Python.h", headers)) if not found)
        items.append(EnvItem(hip_name, "warn", f"没找到 {missing}", "；".join(fixes) + "。", local))

    triton = _triton_version()
    if triton is None:
        items.append(EnvItem(triton_name, "warn", "没找到 Triton",
                             "Triton 路线的实验要用它：换一个装了 Triton 的环境，或者走 HIP 路线。", troubleshooting))
    elif cc and headers:
        items.append(EnvItem(triton_name, "ok", f"Triton {triton}，C 编译器和 Python.h 也有"))
    else:
        missing = "、".join(tool for tool, found in (("C 编译器", cc), ("Python.h", headers)) if not found)
        items.append(EnvItem(
            triton_name, "warn", f"Triton {triton}，但没找到 {missing}",
            "Triton 第一次启动 kernel 时，要把一小段启动代码编译成 Python 扩展。"
            + "；".join(_build_fixes(compiler=cc, headers=headers, which="C")) + "。", local))
    return items


def check_env() -> EnvReport:
    """一键检查实验环境：打印每一项的结果，没通过的项附上怎么改和实验环境指南的链接。

    前三项是做实验的前提：PyTorch 是 ROCm 版、看得到 GPU、GPU 算得对（在 GPU 上算一次 2x + 1，和 CPU 比）。
    有一项没通过（✗），打印完就抛 RuntimeError，停在这里，免得后面的单元接连报错。
    后三项只影响后面某条路线，没通过记为提醒（⚠）：ROCm 和 PyTorch 版本一致（PyTorch 版本号里 +rocm 后面的
    版本和装的 ROCm SDK 比主版本、次版本）、HIP 路线编译 kernel 用的 hipcc、ninja、C++ 编译器和 Python.h，
    Triton 路线用的 Triton 和它第一次启动 kernel 时要的 C 编译器、Python.h。
    指南的地址跟着 config.toml 的 [lab] site。
    """
    report = EnvReport(tuple(_env_items()))
    lines = ["环境检查"]
    for item in report.items:
        lines.append(f"  {_MARKS[item.status]} {item.name}：{item.detail}")
        if item.hint:
            lines.append(f"      {item.hint}")
        if item.link:
            lines.append(f"      指南：{item.link}")
    failed = [item.name for item in report.items if item.status == "fail"]
    if failed:
        lines.append("✗ 的项要先改好：按提示改完，重启内核，再从头运行。")
    elif any(item.status == "warn" for item in report.items):
        lines.append("前三项都通过，可以做实验；⚠ 只影响后面某条路线，走那条路线之前改好就行。")
    else:
        lines.append("全部通过，可以做实验。")
    print("\n".join(lines))
    if failed:
        raise RuntimeError(f"环境检查没通过：{'、'.join(failed)}。按上面的提示改好，重启内核再从头运行。")
    return report


#: hg.check_card() 核对的三个数：键和显示名。
_CARD_FIELDS = {"cus": "CU 数", "wave": "wave 大小", "memory_gib": "显存（GiB）"}
#: 显存按 GiB 保留一位小数核对：差不超过 0.05 GiB 算对。
_GIB_TOLERANCE = 0.05


def _card_case(key: str, value, device: Mapping) -> CheckCase:
    """核对一个数；没通过时 reason 说错在哪，不直接给出答案。"""
    label = _CARD_FIELDS[key]
    if value is None or value is Ellipsis:
        return CheckCase(label, False, reason="还没填")
    if key == "memory_gib":
        number = codes.positive(value)
        if number is None:
            return CheckCase(label, False, reason=f"要填一个正数，现在是 {value!r}")
        if abs(number - device["memory_bytes"] / 2**30) <= _GIB_TOLERANCE + 1e-9:
            return CheckCase(label, True)
        if abs(number - device["memory_bytes"] / 1e9) <= _GIB_TOLERANCE + 1e-9:
            return CheckCase(label, False, reason="这是按 1000 进位的 GB；要的是 GiB：字节数除以 2³⁰")
        return CheckCase(label, False, reason="和这张卡的显存总量对不上：用 PyTorch 读到的总量（字节）除以 2³⁰")
    number = codes.count(value)
    if number is None or number < 1:
        return CheckCase(label, False, reason=f"要填一个正整数，现在是 {value!r}")
    actual = device[key]
    if actual is None:  # PyTorch 和 rocminfo 都没给 wave 大小
        return CheckCase(label, False, reason="这张卡的 wave 大小读不到，没法核对")
    if number == actual:
        return CheckCase(label, True)
    if key == "cus" and _wgp_mode(device["gfx"]) and number * 2 == actual:
        return CheckCase(label, False, reason=f"{number} 是 WGP 的个数：这张卡上 PyTorch 的 multi_processor_count "
                                              "一个数两个 CU")
    if key == "cus":
        return CheckCase(label, False, reason="和这张卡对不上：CU 数看 rocminfo 的 Compute Unit 一行")
    return CheckCase(label, False, reason="和这张卡对不上：看 rocminfo 的 Wavefront Size，或者 PyTorch 的 warp_size")


def check_card(mine: Mapping) -> CheckReport:
    """核对读者自己读出的三个数：CU 数（cus）、wave 大小（wave）、显存总量（memory_gib，单位 GiB）。

    和 hg.device_card() 用同一份数据比：CU 数按计算单元算（按 WGP 计数的卡已经乘 2），wave 大小来自
    PyTorch 的 warp_size（没有时用 rocminfo 的），显存是 PyTorch 读到的总量，差不超过 0.05 GiB 算对。
    没填（...、None 或者没写这一项）、填的不是数，都只算这一项没通过。返回 CheckReport，交成绩时当 checks。
    """
    if not isinstance(mine, Mapping):
        raise TypeError('mine 要写成 {"cus": CU 数, "wave": wave 大小, "memory_gib": 显存 GiB}')
    unknown = [key for key in mine if key not in _CARD_FIELDS]
    if unknown:
        raise ValueError(f"mine 里只写 cus、wave、memory_gib 三项，不认识：{'、'.join(map(str, unknown))}")
    _require_gpu("hg.check_card()")
    device, _ = _card_device()
    report = CheckReport(tuple(_card_case(key, mine.get(key), device) for key in _CARD_FIELDS))
    print("核对你读出的三个数")
    for key, case in zip(_CARD_FIELDS, report.cases):
        print(f"  ✓ {case.shape}：{mine[key]}" if case.passed else f"  ✗ {case.shape}：{case.reason}")
    print(f"通过 {report.passed}/{report.total}")
    return report


#: hg.race() 的矩阵边长上限：再大，CPU 那一边每次要算好几秒。
RACE_MAX_N = 4096
#: GPU 和 CPU 的矩阵乘结果的相对误差（差的范数 ÷ CPU 结果的范数）上限：两边的累加顺序不同，FP32 下不会逐位相同。
_RACE_TOLERANCE = 1e-3


@dataclass(frozen=True, eq=False)
class Race:
    """hg.race() 的结果：三种跑法各自的计时（墙钟时间），metrics 是交成绩用的测量数据。"""

    n: int
    cpu: Timing
    gpu: Timing
    trip: Timing

    @property
    def metrics(self) -> dict[str, float]:
        """median_ms：GPU，数据已在显存里；trip_ms：GPU，算上拷进拷回；cpu_ms：CPU；n：矩阵边长。"""
        return {"median_ms": self.gpu.median_ms, "trip_ms": self.trip.median_ms,
                "cpu_ms": self.cpu.median_ms, "n": float(self.n)}

    def __repr__(self) -> str:
        return (f"Race(n={self.n}，CPU {self.cpu.median_ms:.4g} ms，GPU {self.gpu.median_ms:.4g} ms，"
                f"算上拷进拷回 {self.trip.median_ms:.4g} ms)")


def _race_device() -> str:
    """hg.race() 里 GPU 那两种用的设备；没有 GPU 的单测换成 cpu。"""
    return "cuda"


def _relative_error(actual: torch.Tensor, expected: torch.Tensor) -> float:
    scale = float(torch.linalg.vector_norm(expected.double()))
    return float(torch.linalg.vector_norm((actual - expected).double())) / max(scale, 1e-30)


def _plain(value: float) -> str:
    """三四位有效数字、不用科学记数法：3355.44 → 3355，21.47 → 21.5，6.5536 → 6.55。"""
    decimals = max(0, 2 - math.floor(math.log10(value))) if value > 0 else 0
    return f"{value:.{decimals}f}"


def _amount(value: float, unit: str) -> str:
    """大数用「万」「亿」写：(2147483648, "次") → 21.5 亿次，(2048, "次") → 2048 次。"""
    for prefix, size in (("亿", 1e8), ("万", 1e4)):
        if value >= size:
            return f"{_plain(value / size)} {prefix}{unit}"
    return f"{value:.0f} {unit}"


def _bytes(amount: float) -> str:
    for unit, size in (("GB", 1e9), ("MB", 1e6), ("KB", 1e3)):
        if amount >= size:
            return f"{_plain(amount / size)} {unit}"
    return f"{amount:.0f} 字节"


def race(n: int, *, warmup: int | None = None, repeat: int | None = None) -> Race:
    """同一个 n×n 的 FP32 矩阵乘，CPU 算一种、GPU 算两种，比谁快（2-1 开工准备的挑战）。

    - CPU：两个输入在内存里，PyTorch 用 CPU 的全部线程算；
    - GPU，数据已在显存里：输入事先拷进显存，每次只启动矩阵乘、等它算完；
    - GPU，算上拷进拷回：每次把两个输入拷进显存，算完把结果拷回内存。
    三种都用墙钟计时（measurement.benchmark 的 CPU 计时），GPU 的两种都等它算完才停表，比的是调用方
    等到结果的时间；预热和重复次数不写时用 config.toml 的 [experiment]，取中位数。
    输入是固定种子（config.toml 的 seed）的标准正态分布；计时之前先核对 GPU 两种的结果和 CPU 的一致。
    n 是 1 到 RACE_MAX_N 的整数。
    """
    if isinstance(n, bool) or not isinstance(n, int) or not 1 <= n <= RACE_MAX_N:
        raise ValueError(f"n 要是 1 到 {RACE_MAX_N} 之间的整数，现在是 {n!r}：再大，CPU 那一边每次要算好几秒")
    _require_gpu("hg.race()")
    device = _race_device()
    generator = torch.Generator().manual_seed(settings()["seed"])
    a = torch.randn(n, n, generator=generator)
    b = torch.randn(n, n, generator=generator)
    da, db = a.to(device), b.to(device)
    expected = torch.mm(a, b)
    for label, actual in (("数据已在显存里", torch.mm(da, db).cpu()),
                          ("算上拷进拷回", torch.mm(a.to(device), b.to(device)).cpu())):
        error = _relative_error(actual, expected)
        if not error <= _RACE_TOLERANCE:
            raise RuntimeError(f"GPU（{label}）算出的矩阵乘和 CPU 的对不上（相对误差 {error:.2g}）："
                               "回到「准备」重新运行 hg.check_env()")

    sync = torch.cuda.synchronize if torch.device(device).type == "cuda" else (lambda: None)

    def on_gpu():
        torch.mm(da, db)
        sync()

    def round_trip():
        torch.mm(a.to(device), b.to(device)).cpu()  # 拷回 CPU 要等 GPU 算完

    cpu = _time(lambda: torch.mm(a, b), "CPU", warmup, repeat, "cpu", "hg.race()")
    gpu = _time(on_gpu, "GPU，数据已在显存里", warmup, repeat, "cpu", "hg.race()")
    trip = _time(round_trip, "GPU，算上拷进拷回", warmup, repeat, "cpu", "hg.race()")
    result = Race(n, cpu, gpu, trip)

    resident, carried = (cpu.median_ms / t.median_ms if t.median_ms > 0 else math.inf for t in (gpu, trip))
    measured = cpu.measurement
    print(f"{n}×{n} 的 FP32 矩阵乘：要算 2·n³ ≈ {_amount(2 * n**3, '次')}浮点运算，"
          f"拷进拷回的只有 3·n² 个数（{_bytes(3 * n * n * 4)}）")
    print(f"墙钟时间的中位数（预热 {measured.warmup} 次，计时 {measured.repeat} 次）：")
    print(f"  CPU（{torch.get_num_threads()} 个线程）：{cpu.median_ms:.4g} ms")
    print(f"  GPU，数据已在显存里：{gpu.median_ms:.4g} ms，CPU ÷ GPU = {_ratio_text(resident)}")
    print(f"  GPU，算上拷进拷回：{trip.median_ms:.4g} ms，CPU ÷ GPU = {_ratio_text(carried)}")
    if resident >= 1 and carried >= 1:
        print("两行的「CPU ÷ GPU」都不小于 1：数据已在显存里也好，算上拷进拷回也好，GPU 都比 CPU 快。")
    elif resident >= 1:
        print("数据已在显存里时 GPU 快，算上拷进拷回还是 CPU 快。把 n 改大再试。")
    elif carried >= 1:
        print("算上拷进拷回反倒比数据已在显存里快：两行差得不多，是计时的波动。再运行一次，或者把 n 改大。")
    else:
        print("这么小的矩阵，GPU 两种都没有 CPU 快。把 n 改大再试。")
    return result


def _ratio_text(value: float) -> str:
    """比值先写 3 位有效数字；四舍五入以后和「是不是 ≥ 1」对不上时多写几位（同网页 lab.ts 的 formatRatio）。"""
    for digits in range(3, 17):
        text = f"{value:.{digits}g}"
        if (float(text) >= 1) == (value >= 1):
            return text
    return repr(value)


# ---------------------------------------------------------------- 测得准（2-3）

class _EventTimer:
    """hg 自己的计时函数，也是 2-3 挑战里读者那个计时函数的参考答案：timer(fn) 调用 fn 一次，返回毫秒数。

    在当前 stream 上，fn 前后各记一个 GPU 事件，等 GPU 走到后一个，再读两个事件之间的毫秒数。两个事件只建一次，
    第一次用之前先各记一遍（同 measurement.benchmark），免得建事件的开销算进第一个样本。
    """

    def __init__(self) -> None:
        self._pair = None

    def __call__(self, fn: Callable[[], object]) -> float:
        stream = torch.cuda.current_stream()
        if self._pair is None:
            self._pair = _events(stream)
        start, end = self._pair
        start.record(stream)
        fn()
        end.record(stream)
        end.synchronize()
        return float(start.elapsed_time(end))


def _synchronize() -> None:
    """等 GPU 把排着的活都做完；没有 GPU 的单测换成什么也不做。"""
    torch.cuda.synchronize()


def _paired(first: Callable[[], object], second: Callable[[], object], *, warmup: int,
            repeat: int) -> tuple[list, list]:
    """轮流调用 first、second（各自计时一次，返回结果），每次调用之后等 GPU 空下来。

    前 warmup 轮是预热，结果不要；后面 repeat 轮的结果按顺序各收一份。轮流测，GPU 频率、温度的变化对两边一样。
    """
    results: tuple[list, list] = ([], [])
    for index in range(warmup + repeat):
        for once, collected in zip((first, second), results):
            value = once()
            _synchronize()
            if index >= warmup:
                collected.append(value)
    return results


def _real(value) -> float | None:
    """有限的实数（布尔值不算，numpy 的数也算）转成 float，不是就返回 None。"""
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        return None
    try:
        number = float(value)
    except (OverflowError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _milliseconds(value) -> float | None:
    """计时函数返回的毫秒数：不小于 0 的有限实数转成 float，不是就返回 None。"""
    number = _real(value)
    return number if number is not None and number >= 0 else None


#: hg.check_timer() 判「对得上」：读者的中位数和参考值的中位数，大的不超过小的这么多倍。
TIMER_TOLERANCE = 1.5
#: hg.check_timer() 用的数组长度：大数组加法要算一阵子，停表太早一比就看得出来；小数组加法一下就算完。
_TIMER_BIG = 1 << 24
_TIMER_SMALL = 1 << 18


class _TimerFailed(Exception):
    """读者的计时函数出了错（hg 自己的参考计时出错不算这个，照常抛出）。"""


def _timer_cases() -> list[tuple[str, Callable[[], object], Callable[[], object] | None]]:
    """hg.check_timer() 的三种情况：(名字, 要计时的调用, 每次计时之前做的事或 None)。输入输出事先放进显存。"""

    def prepared(n: int) -> Callable[[], object]:
        x = torch.ones(n, device="cuda")
        y = torch.ones(n, device="cuda")
        out = torch.empty_like(x)
        return lambda: torch.add(x, y, out=out)

    big, small = prepared(_TIMER_BIG), prepared(_TIMER_SMALL)

    def queue_two_big() -> None:
        big()  # 不等它们算完：开始计时的时候，GPU 前面还排着这两个加法
        big()

    return [("大数组加法（2²⁴ 个数）", big, None),
            ("小数组加法（2¹⁸ 个数）", small, None),
            ("小数组加法，前面还排着两个大数组加法", small, queue_two_big)]


def _timer_problem(mine: float, reference: float) -> str | None:
    """读者的中位数和参考值的中位数对不上时，说差在哪；对得上返回 None。"""
    if reference <= 0:
        return None if mine <= 0 else "参考值是 0 ms：GPU 事件量不出这么短的时间，这种情况没法比"
    ratio = mine / reference
    if 1 / TIMER_TOLERANCE <= ratio <= TIMER_TOLERANCE:
        return None
    if 1 / 1500 <= ratio <= 1 / 667:
        return "只有参考值的千分之一左右：返回的是秒吧？要的是毫秒，elapsed_time 给的就是毫秒"
    if 667 <= ratio <= 1500:
        return "是参考值的一千倍左右：返回的是微秒吧？要的是毫秒"
    if ratio < 1:
        return f"只有参考值的 {ratio * 100:.2g}%：停表的时候 GPU 还没算完。先等 GPU 走到 end，再读时间"
    return (f"是参考值的 {_plain(ratio)} 倍：多算了别的时间。CPU 计时会把 Python 调用、等待和 GPU 前面排着的活"
            "都算进去，每次调用都新建事件也要花时间；GPU 事件只量 begin 和 end 之间的那一段")


def _timer_case(label: str, fn: Callable[[], object], before: Callable[[], object] | None,
                timer: Callable[[Callable[[], object]], object], reference: Callable[[Callable[[], object]], float],
                *, warmup: int, repeat: int) -> tuple[CheckCase, str]:
    """一种情况：轮流用参考计时和读者的 timer 测 fn，比中位数。返回（这一种的校验结果，打印的那一行）。"""

    def with_reference() -> float:
        if before is not None:
            before()
        return reference(fn)

    def with_timer() -> object:
        if before is not None:
            before()
        try:
            return timer(fn)
        except Exception as failure:
            raise _TimerFailed from failure

    try:
        expected, got = _paired(with_reference, with_timer, warmup=warmup, repeat=repeat)
    except _TimerFailed as failed:
        _synchronize()
        message = _first_line(failed.__cause__)
        # 没等 GPU 走到 end 就读：PyTorch 2.13 先自己查，报 Both events must be completed before calculating
        # elapsed time（R-01 在真卡上看到的）；绕过这道检查直接问 HIP 时是 hipErrorNotReady（device not ready）。
        reason = f"运行出错：{message}"
        if any(text in message.lower() for text in ("not ready", "must be completed")):
            reason = f"{reason.rstrip('.')}。读 elapsed_time 之前，先等 GPU 走到 end"
        return CheckCase(label, False, reason=reason), f"  ✗ {label}：{reason}"
    values = [_milliseconds(value) for value in got]
    if None in values:
        value = got[values.index(None)]
        reason = ("还没写完：要返回 begin 到 end 的毫秒数" if value is None or value is Ellipsis
                  else f"要返回毫秒数（不小于 0 的有限实数），现在返回的是 {codes._show(value)[:80]}")
        return CheckCase(label, False, reason=reason), f"  ✗ {label}：{reason}"
    mine, wanted = statistics.median(values), statistics.median(expected)
    problem = _timer_problem(mine, wanted)
    shown = f"你的 {mine:.4g} ms，参考 {wanted:.4g} ms"
    if problem is None:
        return CheckCase(label, True), f"  ✓ {label}：{shown}"
    return CheckCase(label, False, reason=problem), f"  ✗ {label}：{shown}。{problem}"


def check_timer(timer: Callable[[Callable[[], object]], float]) -> CheckReport:
    """核对读者写的计时函数（2-3 测得准的挑战）：timer(fn) 调用 fn 一次，返回这一次用了多少毫秒。

    三种情况，每种轮流用 hg 自己的 GPU 事件计时（参考值）和 timer 各测 warmup + repeat 次（config.toml 的
    [experiment]，预热那几次不算）。两边的中位数相差不到 TIMER_TOLERANCE 倍，这种情况就算对上：
      - 大数组加法（2²⁴ 个数）：停表时 GPU 还没算完的话，测出来小很多；
      - 小数组加法（2¹⁸ 个数）：一次加法很短，CPU 计时多算进去的 Python 调用和等待显得多；
      - 同样的小数组加法，开始计时的时候 GPU 前面还排着两个大数组加法：CPU 计时会把它们也算进去，
        GPU 事件只量 begin 和 end 之间的那一段。
    timer 出错、返回的不是毫秒数（不小于 0 的有限实数），只算这种情况没对上，接着测下一种；参考计时出错直接抛出。
    返回 CheckReport，交成绩时当 checks。
    """
    if not callable(timer):
        raise TypeError("timer 要是计时函数：timer(fn) 调用 fn 一次，返回这一次用了多少毫秒")
    _require_gpu("hg.check_timer()")
    config = settings()
    warmup, repeat = config["warmup"], config["repeat"]
    reference = _EventTimer()
    results = [_timer_case(label, fn, before, timer, reference, warmup=warmup, repeat=repeat)
               for label, fn, before in _timer_cases()]
    report = CheckReport(tuple(case for case, _ in results))
    print(f"核对你的计时函数：{report.total} 种情况，各计时 {repeat} 次（先预热 {warmup} 次），"
          f"中位数和 hg 的 GPU 事件计时相差不到 {TIMER_TOLERANCE:g} 倍算对上")
    for _, line in results:
        print(line)
    print(f"通过 {report.passed}/{report.total}")
    return report


#: hg.warm_cold() 冷缓存那一遍，每次计时之前读一遍的缓冲区：比 GPU 上最大的一级缓存大得多，上一次留在缓存里的数
#: 才会都被换掉；只读不写，换出去的缓存行不用写回显存。取 512 MiB 和显存的 1/8 里小的那个。
_FLUSH_BYTES = 512 * 2**20


def _flusher(device: Mapping) -> tuple[Callable[[], object], int]:
    """冷缓存用的「换掉缓存」：返回（每次计时之前调用的函数，它读的字节数）。"""
    elements = min(_FLUSH_BYTES, device["memory_bytes"] // 8) // 4
    scratch = torch.zeros(elements, device="cuda")
    return scratch.sum, elements * 4


@dataclass(frozen=True, eq=False)
class WarmCold:
    """hg.warm_cold() 的结果：热缓存、冷缓存各自的计时（毫秒），metrics 是交成绩用的测量数据。"""

    warm: Timing
    cold: Timing
    flush_bytes: int
    bytes_moved: float | None = None

    @property
    def spread(self) -> float:
        """热缓存的 p10 ÷ p90：越接近 1，中间八成样本挨得越紧。"""
        return self.warm.p10_ms / self.warm.p90_ms if self.warm.p90_ms > 0 else math.nan

    @property
    def separation(self) -> float:
        """冷缓存的中位数 ÷ 热缓存的 p90：不小于 1，冷缓存的中位数就落在热缓存的波动范围之外。"""
        return self.cold.median_ms / self.warm.p90_ms if self.warm.p90_ms > 0 else math.nan

    @property
    def metrics(self) -> dict[str, float]:
        """交成绩用的测量数据：median_ms、p10_ms、p90_ms 是热缓存的，cold_ms、cold_p10_ms、cold_p90_ms 是冷缓存的；
        给了 bytes_moved 时再加按中位数算的有效带宽 gbps、cold_gbps（十进制 GB/s）。"""
        warm, cold = self.warm, self.cold
        result = {"median_ms": warm.median_ms, "p10_ms": warm.p10_ms, "p90_ms": warm.p90_ms,
                  "cold_ms": cold.median_ms, "cold_p10_ms": cold.p10_ms, "cold_p90_ms": cold.p90_ms}
        if self.bytes_moved is not None:
            result["gbps"] = _rate(self.bytes_moved, warm.median_ms, 1e6)
            result["cold_gbps"] = _rate(self.bytes_moved, cold.median_ms, 1e6)
        return result

    def __repr__(self) -> str:
        return f"WarmCold(热缓存 {self.warm.median_ms:.4g} ms，冷缓存 {self.cold.median_ms:.4g} ms)"


def warm_cold(fn: Callable[[], object], *, bytes_moved: float | None = None, warmup: int | None = None,
              repeat: int | None = None) -> WarmCold:
    """同一个调用，热缓存和冷缓存轮流测（2-3 测得准）。

    fn 是准备好输入和输出的无参函数。每次都用 GPU 事件计时一次调用（同 hg.bench），开始计时的时候 GPU 没有排着别的活：
      - 冷缓存：先读一遍 512 MiB（显存不到 4 GiB 时取显存的 1/8）的缓冲区，把缓存里的数换掉，等它读完再计时；
      - 热缓存：紧接着冷缓存那一次再测一次，同一组数据刚用过，装得下的都还在缓存里。
    预热和计时的次数不写时用 config.toml 的 [experiment]；bytes_moved 是一次调用按算法搬的字节数，给了才算有效带宽。
    打印两种的中位数、p10、p90，热缓存的 p10 ÷ p90（越接近 1 波动越小），冷缓存的中位数 ÷ 热缓存的 p90
    （不小于 1，冷热分得开）。
    """
    if not callable(fn):
        raise TypeError("fn 要是准备好输入和输出的无参函数，例如 lambda: torch.add(x, y, out=out)")
    if bytes_moved is not None and codes.positive(bytes_moved) is None:
        raise ValueError("bytes_moved 要是有限的正数")
    warmup, repeat = _counts_or_config(warmup, repeat)
    _counts(warmup, repeat)
    _require_gpu("hg.warm_cold()")
    flush, flush_bytes = _flusher(_device())
    timer = _EventTimer()

    def cold_once() -> float:
        flush()
        _synchronize()  # 等它读完、GPU 空下来再计时，和热缓存一样从空队列开始
        return timer(fn)

    cold_samples, warm_samples = _paired(cold_once, lambda: timer(fn), warmup=warmup, repeat=repeat)
    device, threads = f"cuda:{torch.cuda.current_device()}", torch.get_num_threads()
    flushed = f"{flush_bytes / 2**20:.0f} MiB"
    warm = _timing_of(Measurement("热缓存", tuple(warm_samples), "GPU 事件", device, warmup, repeat, threads,
                                  "紧接着冷缓存那一次再调用一次，同一组数据刚用过；开始计时时 GPU 没有排着别的活"))
    cold = _timing_of(Measurement("冷缓存", tuple(cold_samples), "GPU 事件", device, warmup, repeat, threads,
                                  f"计时之前先读一遍 {flushed} 的缓冲区换掉缓存，等它读完、GPU 空下来再计时"))
    result = WarmCold(warm, cold, flush_bytes, None if bytes_moved is None else float(bytes_moved))

    metrics = result.metrics
    print(f"热缓存、冷缓存轮流测，各预热 {warmup} 次、计时 {repeat} 次；冷缓存每次计时之前先读一遍 {flushed} 的缓冲区")
    for name, timing, key in (("热缓存", warm, "gbps"), ("冷缓存", cold, "cold_gbps")):
        rate = f"，有效带宽 {metrics[key]:.1f} GB/s" if key in metrics else ""
        print(f"  {name}：中位数 {timing.median_ms:.4g} ms（p10 {timing.p10_ms:.4g}，p90 {timing.p90_ms:.4g}）{rate}")
    print(f"热缓存的 p10 ÷ p90 = {result.spread:.4g}：越接近 1，中间八成样本挨得越紧，测得越稳")
    separation = result.separation
    if separation >= 1:
        print(f"冷缓存的中位数 ÷ 热缓存的 p90 = {_ratio_text(separation)}：不小于 1，冷缓存的中位数落在热缓存的"
              "波动范围之外，冷热分得开")
    else:
        print(f"冷缓存的中位数 ÷ 热缓存的 p90 = {_ratio_text(separation)}：小于 1，冷缓存的中位数还在热缓存的"
              "波动范围里，冷热分不开。数组太大，缓存装不下；或者一次调用太短，差别被启动的开销盖住了")
    return result


# ---------------------------------------------------------------- 性能的天花板（2-4）

#: hg.check_mm_cost() 核对的矩阵乘形状 (m, k, n)：方阵、很扁的（挑战里矩阵乘的起点）、矩阵乘向量、三条边都不一样的、
#: 最小的。只看方阵，查不出把 m·k·n 写成 n³ 这类错。
_MM_SHAPES = ((4096, 4096, 4096), (4096, 16, 4096), (8192, 8192, 1), (512, 64, 2048), (1, 1, 1))


def _same(value: float, expected: float) -> bool:
    return math.isclose(value, expected, rel_tol=1e-9)


def _mm_flops_problem(value, m: int, k: int, n: int) -> str | None:
    """读者写的浮点运算次数：对的返回 None，不对时说差在哪，不直接给出答案。"""
    if value is None or value is Ellipsis:
        return "浮点运算次数还没写"
    number = _real(value)
    if number is None:
        return f"浮点运算次数要是一个数，现在是 {codes._show(value)[:80]}"
    if _same(number, 2 * m * k * n):
        return None
    if _same(number, m * k * n):
        return "浮点运算次数少了一半：一次乘加是乘一次、加一次，算 2 次浮点运算"
    return "浮点运算次数不对：C 有 m×n 个数，每个数要做 k 次乘加"


def _mm_bytes_problem(value, m: int, k: int, n: int) -> str | None:
    """读者写的字节数：对的返回 None，不对时说差在哪。按算法算：A、B 各读一遍，C 写一遍，每个 FP32 数 4 字节。"""
    if value is None or value is Ellipsis:
        return "字节数还没写"
    number = _real(value)
    if number is None:
        return f"字节数要是一个数，现在是 {codes._show(value)[:80]}"
    inputs, output = m * k + k * n, m * n
    if _same(number, 4 * (inputs + output)):
        return None
    if _same(number, inputs + output):
        return "字节数是对的 1/4：这是数的个数，每个 FP32 数占 4 字节"
    if _same(number, 8 * (inputs + output)):
        return "字节数多了一倍：一个 FP32 数占 4 字节，不是 8 字节"
    if _same(number, 4 * inputs):
        return "少算了 C：算完的 m×n 个数要写回显存"
    if _same(number, 4 * (inputs + 2 * output)):
        return "多算了一遍 C：torch.mm(a, b, out=c) 只写 C，不读它"
    return "字节数不对：A 有 m×k 个数，B 有 k×n 个，C 有 m×n 个，每个都读或写一遍"


def _mm_cost_case(cost: Callable, m: int, k: int, n: int) -> tuple[CheckCase, str]:
    """一种形状：调用 cost(m, k, n)，核对两个数。返回（这种形状的校验结果，打印的那一行）。"""
    label = f"{m}×{k} 乘 {k}×{n}"
    try:
        result = cost(m, k, n)
    except Exception as error:  # 读者的函数出错，只算这种形状没通过
        reason = f"运行出错：{_first_line(error)}"
    else:
        if result is None or result is Ellipsis:
            reason = "还没写完：要返回 (浮点运算次数, 字节数)"
        elif not isinstance(result, (tuple, list)) or len(result) != 2:
            reason = f"要返回两个数 (浮点运算次数, 字节数)，现在返回的是 {codes._show(result)[:80]}"
        else:
            problems = [problem for problem in (_mm_flops_problem(result[0], m, k, n),
                                                _mm_bytes_problem(result[1], m, k, n)) if problem is not None]
            if not problems:
                shown = f"{_amount(2 * m * k * n, '次')}浮点运算，{_bytes(4 * (m * k + k * n + m * n))}"
                return CheckCase(label, True), f"  ✓ {label}：{shown}"
            reason = "；".join(problems)
    return CheckCase(label, False, reason=reason), f"  ✗ {label}：{reason}"


def check_mm_cost(cost: Callable[[int, int, int], tuple]) -> CheckReport:
    """核对读者写的矩阵乘工作量（2-4 性能的天花板的挑战）：cost(m, k, n) 返回 (浮点运算次数, 字节数)。

    (m×k) 乘 (k×n) 的 FP32 矩阵乘做 2·m·k·n 次浮点运算（一次乘加算 2 次）；字节数按算法算：A、B 各读一遍，
    C 写一遍，4·(m·k + k·n + m·n)。拿 _MM_SHAPES 的五种形状核对，两个数都对，这种形状才算通过；不对时说差在哪
    （少了一半、数的是个数、少算了 C……），不直接给出答案。cost 出错、没写完，只算这种形状没通过。
    不用 GPU。返回 CheckReport，交成绩时当 checks。
    """
    if not callable(cost):
        raise TypeError("cost 要是函数：cost(m, k, n) 返回 (浮点运算次数, 字节数)")
    results = [_mm_cost_case(cost, m, k, n) for m, k, n in _MM_SHAPES]
    report = CheckReport(tuple(case for case, _ in results))
    name = getattr(cost, "__name__", "")
    shown = name if isinstance(name, str) and name.isidentifier() else "你的函数"
    print(f"核对 {shown}：{report.total} 种形状，浮点运算次数和字节数都对，这种形状才算通过")
    for _, line in results:
        print(line)
    print(f"通过 {report.passed}/{report.total}")
    return report


@dataclass(frozen=True)
class RooflinePoint:
    """屋顶线上的一个算子：计时（毫秒），一次调用的浮点运算次数和按算法搬运的字节数。"""

    timing: Timing
    flops: float
    bytes_moved: float

    @property
    def intensity(self) -> float:
        """算术强度：每搬 1 字节做几次浮点运算（FLOP/字节）。"""
        return self.flops / self.bytes_moved

    @property
    def tflops(self) -> float:
        """按中位数算的算力（TFLOPS）。"""
        return _rate(self.flops, self.timing.median_ms, 1e9)

    @property
    def gbps(self) -> float:
        """按中位数算的有效带宽（十进制 GB/s）。"""
        return _rate(self.bytes_moved, self.timing.median_ms, 1e6)


#: hg.roofline() 打印的表：列名和每个数的写法。
_ROOF_HEADERS = {
    "intensity": ("算术强度", _plain), "median_ms": ("中位数 ms", "{:.4g}".format),
    "tflops": ("算力 TFLOPS", _plain), "gbps": ("带宽 GB/s", "{:.1f}".format),
    "roof_tflops": ("屋顶 TFLOPS", _plain), "of_roof": ("占屋顶", "{:.1%}".format), "bound": ("归谁管", str),
}


@dataclass(frozen=True, eq=False)
class Roofline:
    """hg.roofline() 的结果：这张卡的两个峰值和每个算子的点；metrics 是交成绩用的测量数据。"""

    peak_gbps: float
    peak_tflops: float
    points: dict[str, RooflinePoint]

    @property
    def ridge(self) -> float:
        """拐点的算术强度（FLOP/字节）= 峰值算力 ÷ 峰值带宽：左边的算子归带宽管，右边的归算力管。"""
        return self.peak_tflops * 1000 / self.peak_gbps

    def roof(self, intensity: float) -> float:
        """算术强度为 intensity 的算子最快多快（TFLOPS）：峰值带宽 × 算术强度，和峰值算力取小的那个。"""
        return min(self.peak_gbps * intensity / 1000, self.peak_tflops)

    @property
    def table(self) -> pd.DataFrame:
        """每个点一行：算术强度、中位数、算力、有效带宽、这一点的屋顶、占屋顶的比例、归谁管（带宽或算力）。"""
        rows = {}
        for name, point in self.points.items():
            roof = self.roof(point.intensity)
            rows[name] = {"intensity": point.intensity, "median_ms": point.timing.median_ms, "tflops": point.tflops,
                          "gbps": point.gbps, "roof_tflops": roof, "of_roof": point.tflops / roof,
                          "bound": "带宽" if point.intensity < self.ridge else "算力"}
        return pd.DataFrame.from_dict(rows, orient="index").reindex(columns=list(_ROOF_HEADERS))

    @property
    def metrics(self) -> dict[str, float]:
        """交成绩用的测量数据。名字能当测量项前缀的点（例如 add、mm）各有 <名字>_ms（中位数）、<名字>_gbps、
        <名字>_tflops、<名字>_intensity（算术强度）和 <名字>_roof_tflops（这个算术强度下的屋顶）；
        再加上 ridge（拐点的算术强度）、peak_gbps、peak_tflops。算不出有限正数的项不写。"""
        result = {}
        for name, point in self.points.items():
            if not codes.METRIC_NAME.fullmatch(f"{name}_ms"):
                continue
            values = {"ms": point.timing.median_ms, "gbps": point.gbps, "tflops": point.tflops,
                      "intensity": point.intensity, "roof_tflops": self.roof(point.intensity)}
            for key, value in values.items():
                if codes.positive(value) is not None:
                    result[f"{name}_{key}"] = float(value)
        result.update({"ridge": self.ridge, "peak_gbps": self.peak_gbps, "peak_tflops": self.peak_tflops})
        return result

    def __repr__(self) -> str:
        return f"Roofline({len(self.points)} 个点，拐点 {_plain(self.ridge)} FLOP/字节)"


def _point_spec(name, item) -> tuple[Callable[[], object] | Timing, float, float] | None:
    """检查一个点的写法 (调用, 浮点运算次数, 字节数)，返回同样的三项；浮点运算次数或字节数还没写（... 或 None）
    时返回 None，这个点先不画，免得没补完 TODO 的 Notebook 一运行就报错。"""
    if not isinstance(name, str) or not name:
        raise ValueError("每个点都要有名字（非空字符串）")
    if name == "peak":
        raise ValueError("点的名字不能叫 peak：交成绩时 peak_gbps、peak_tflops 是这张卡的峰值")
    if not isinstance(item, (tuple, list)) or len(item) != 3:
        raise TypeError(f"{name}：要写成 (调用, 浮点运算次数, 字节数) 三项")
    call, flops, moved = item
    if not isinstance(call, Timing) and not callable(call):
        raise TypeError(f"{name}：第一项要是准备好的无参函数，或者 hg.bench() 的结果")
    if any(value is None or value is Ellipsis for value in (flops, moved)):
        return None
    flops, moved = _real(flops), _real(moved)
    if flops is None or flops <= 0:
        raise ValueError(f"{name}：浮点运算次数要是有限的正数（拷贝这种不做浮点运算的算子，画不到屋顶线上）")
    if moved is None or moved <= 0:
        raise ValueError(f"{name}：字节数要是有限的正数")
    return call, flops, moved


def _peak_mapping(value) -> dict:
    """hg.roofline(peak=...) 给的峰值：{"gbps": 峰值带宽, "tflops": 峰值算力}，两个都要是有限的正数。"""
    if isinstance(value, Mapping):
        gbps, tflops = codes.positive(value.get("gbps")), codes.positive(value.get("tflops"))
        if gbps is not None and tflops is not None:
            return {"gbps": gbps, "tflops": tflops}
    raise ValueError('peak 要写成 {"gbps": 峰值带宽, "tflops": 峰值算力}，两个都是有限的正数，例如 hg.peak() 的结果')


def _card_peak() -> dict:
    """hg.roofline() 默认用的峰值：这张卡有缓存就读（不打印）；还没测过就先测一次，同 hg.peak()。"""
    record = _cached_peak(_device())
    if record is None:
        return peak()
    return {"gbps": record["gbps"], "tflops": record["tflops"]}


def _print_roofline(result: Roofline, unfinished: list[str]) -> None:
    print(f"屋顶线（这张卡的实测峰值）：带宽 {result.peak_gbps:.1f} GB/s，算力 {result.peak_tflops:.2f} TFLOPS")
    print(f"拐点在算术强度 {_plain(result.ridge)} FLOP/字节：左边的算子归带宽管，最快是峰值带宽 × 算术强度；"
          "右边的归算力管，最快是峰值算力")
    if result.points:
        table = result.table
        formatters = {column: _ROOF_HEADERS[column][1] for column in table.columns}
        with pd.option_context("display.unicode.east_asian_width", True):
            print(table.to_string(formatters=formatters, header=[_ROOF_HEADERS[column][0] for column in table.columns]))
    for name, point in result.points.items():
        if not point.tflops > result.roof(point.intensity):
            continue
        if point.intensity < result.ridge:
            print(f"{name} 比带宽屋顶还快：屋顶是拷贝测试量出来的参考，不是硬上限。高出一点，可能是测量的波动；"
                  "高出很多，多半是数据装进了缓存（2-3 的缓存冷热），或者字节数数多了")
        else:
            print(f"{name} 比算力屋顶还快：FMA 测试量的是 FP32 的向量运算，低精度的矩阵乘可能用上矩阵核心，"
                  "不归这条线管。也检查一下浮点运算次数有没有数多")
    if unfinished:
        print(f"{'、'.join(unfinished)}：浮点运算次数或字节数还没写完，这次先不画")


def _plot_roofline(result: Roofline):
    """双对数坐标的屋顶线和每个点。图上的字用英文：不少 Jupyter 环境没有中文字体。返回 matplotlib 的 Axes。"""
    import matplotlib.pyplot as plt
    import numpy as np

    ridge = result.ridge
    xs = [point.intensity for point in result.points.values()]
    grid = np.geomspace(min([ridge / 300, *(x / 3 for x in xs)]), max([ridge * 30, *(x * 3 for x in xs)]), 400)
    grid = np.unique(np.append(grid, ridge))  # 让折线正好折在拐点上
    figure, axes = plt.subplots(figsize=(7, 4.5), layout="constrained")
    axes.loglog(grid, np.minimum(grid * result.peak_gbps / 1000, result.peak_tflops), color="#2f6f83", linewidth=2.5,
                label=f"roof = min({result.peak_gbps:.0f} GB/s × intensity, {result.peak_tflops:.3g} TFLOPS)")
    axes.axvline(ridge, color="#94a3b8", linestyle="--", linewidth=1, label=f"ridge: {ridge:.3g} FLOP/byte")
    side = axes.get_xaxis_transform()  # x 按数据，y 按图高的比例：两行字贴着底边，分在拐点两边
    axes.text(ridge / 1.15, 0.03, "← bandwidth-bound", transform=side, ha="right", fontsize=8, color="#475569")
    axes.text(ridge * 1.15, 0.03, "compute-bound →", transform=side, ha="left", fontsize=8, color="#475569")
    for name, point in result.points.items():
        if not point.tflops > 0:  # 中位数是 0 时算不出算力，对数坐标上画不了
            continue
        axes.scatter([point.intensity], [point.tflops], s=36, color="#b35b30", zorder=3)
        axes.annotate(name, (point.intensity, point.tflops), xytext=(5, 5), textcoords="offset points", fontsize=9)
    axes.set_xlabel("Arithmetic intensity (FLOP/byte)")
    axes.set_ylabel("Performance (TFLOPS)")
    axes.set_title("Roofline from this GPU's measured peaks (copy test, FP32 FMA test)", fontsize=10)
    axes.grid(which="both", alpha=0.2)
    axes.legend(fontsize=8, loc="upper left")
    return axes


def roofline(points: Mapping[str, tuple] | None = None, *, peak: Mapping | None = None,
             warmup: int | None = None, repeat: int | None = None, plot: bool = True) -> Roofline:
    """用这张卡的实测峰值画屋顶线（2-4 性能的天花板），把算子按实测耗时放上去。

    points：{名字: (准备好的无参函数, 一次调用的浮点运算次数, 一次调用按算法搬运的字节数)}；函数按 hg.bench 的协议
    计时（预热和计时的次数不写时用 config.toml 的 [experiment]），也可以直接给 hg.bench() 的结果。不写 points 就只画
    屋顶线；浮点运算次数或字节数是 ...（还没写完）的点先不画。peak：{"gbps", "tflops"}，默认用 hg.peak() 的缓存，
    这张卡还没测过就先测一次。
    屋顶：算术强度 I（FLOP/字节）的算子最快 min(峰值带宽 × I, 峰值算力)。两条线交在拐点 I = 峰值算力 ÷ 峰值带宽，
    左边的算子归带宽管，右边的归算力管。打印每个点的算术强度、中位数、算力、有效带宽、这一点的屋顶、占屋顶的比例
    和归谁管；plot=True 时再画一张双对数坐标的图（图上的字是英文，点的名字也最好用英文）。返回 Roofline。
    """
    if points is None:
        points = {}
    if not isinstance(points, Mapping):
        raise TypeError('points 要写成 {名字: (调用, 浮点运算次数, 字节数)}，例如 {"add": (add, n, 12 * n)}')
    specs, unfinished = {}, []
    for name, item in points.items():
        spec = _point_spec(name, item)
        if spec is None:
            unfinished.append(name)
        else:
            specs[name] = spec
    values = None if peak is None else _peak_mapping(peak)
    warmup, repeat = _counts_or_config(warmup, repeat)
    _counts(warmup, repeat)
    if values is None or any(not isinstance(call, Timing) for call, _, _ in specs.values()):
        _require_gpu("hg.roofline()")
    if values is None:
        values = _card_peak()
    measured = {
        name: RooflinePoint(call if isinstance(call, Timing)
                            else _time(call, name, warmup, repeat, "cuda", "hg.roofline()"), flops, moved)
        for name, (call, flops, moved) in specs.items()
    }
    result = Roofline(values["gbps"], values["tflops"], measured)
    _print_roofline(result, unfinished)
    if plot:
        _plot_roofline(result)
    return result


# ---------------------------------------------------------------- 一行 PyTorch 背后（2-5）

#: trace 格式的版本（docs/lab/schema.json 的 trace）。改格式时 schema、网页和这里一起改。
TRACE_VERSION = 1
#: hg.trace() 给每一遍套的 record_function 名字的开头。GPU 上同名的「标注」只是一段时间范围，不是 kernel，不收。
_TRACE_TAG = "hg.trace"
#: CPU 上的运行时调用（HIP / CUDA 的运行时和驱动 API，例如 hipLaunchKernel）在 torch.profiler 里的 activity_type。
_RUNTIME_ACTIVITIES = frozenset({"cuda_runtime", "cuda_driver", "xpu_runtime", "privateuse1_runtime",
                                 "privateuse1_driver"})
#: GPU 上的事件：torch.profiler 的 activity_type → trace 里的 kind。别的（GPU 上的标注、同步）不收。
_GPU_ACTIVITIES = {"kernel": "kernel", "gpu_memcpy": "memcpy", "gpu_memset": "memset"}
#: 时间线上每个顶层算子一种颜色，它启动的运行时调用和 kernel 用同一种；找不到算子的用灰色。
_TRACE_COLORS = ("#2f6f83", "#b35b30", "#6b8e23", "#8e5ea2", "#c49a29", "#3f7fbf", "#b2456e", "#5f7f6f")
_TRACE_GRAY = "#94a3b8"


def _cpu_role(event) -> str | None:
    """CPU 上的一个事件在 trace 里算什么：PyTorch 算子 "op"、运行时调用 "runtime"；别的（Python 函数、
    profiler 自己的开销……）不收，返回 None。

    新版 PyTorch 的事件带 activity_type（cpu_op、cuda_runtime……，同 Chrome trace 的 cat）；旧版没有，按名字认：
    带 :: 的是算子（aten::add），hip、cuda 开头的是运行时调用（hipLaunchKernel），其余按算子收（例如库自己加的标注）。
    """
    activity = getattr(event, "activity_type", None)
    if isinstance(activity, str):
        if activity in ("cpu_op", "user_annotation"):
            return "op"
        return "runtime" if activity in _RUNTIME_ACTIVITIES else None
    name = str(event.name)
    if "::" in name:
        return "op"
    return "runtime" if name.startswith(("hip", "cuda")) else "op"


def _gpu_kind(event) -> str | None:
    """GPU 上的一个事件是 kernel、拷贝（memcpy）还是填充（memset）；GPU 上的标注、同步这类不收，返回 None。
    没有 activity_type 的旧版 PyTorch 按名字认（Memcpy …、Memset …）。"""
    activity = getattr(event, "activity_type", None)
    if isinstance(activity, str):
        return _GPU_ACTIVITIES.get(activity)
    name = str(event.name)
    if name.startswith(_TRACE_TAG):
        return None
    lowered = name.lower()
    if lowered.startswith("memcpy"):
        return "memcpy"
    return "memset" if lowered.startswith("memset") else "kernel"


def _busy_us(intervals) -> float:
    """几段时间合在一起有多长：重叠的部分只算一次。intervals 是 (开始, 结束)。"""
    total, reached = 0.0, -math.inf
    for start, stop in sorted(intervals):
        if stop > reached:
            total += stop - max(start, reached)
            reached = stop
    return total


def _run_line(anchor, members: list, roles: dict, gpu: list) -> dict:
    """一遍整理成 trace 格式的一行（docs/lab/schema.json 的 traceLine，name、runs 由调用方填）。

    anchor 是这一遍的 record_function；members 是挂在它下面的 CPU 事件，roles 是它们各自算什么（id → op / runtime）；
    gpu 是这一遍的 GPU 事件 [(事件, kind, 启动它的运行时调用或 None, 启动它的算子或 None)]。时间从 anchor 开始算，微秒。
    """
    origin = anchor.time_range.start

    def nearest_op(event):
        node = event.cpu_parent
        while node is not None and node is not anchor:
            if roles.get(id(node)) == "op":
                return node
            node = node.cpu_parent
        return None

    def timed(event) -> dict:
        return {"name": str(event.name), "start": round(event.time_range.start - origin, 3),
                "dur": round(event.time_range.end - event.time_range.start, 3)}

    ops = [event for event in members if roles[id(event)] == "op"]
    launches = sorted((event for event in members if roles[id(event)] == "runtime"),
                      key=lambda event: event.time_range.start)
    # 收哪些算子：这一行直接调用的，以及启动过东西的算子连同它们的上层算子
    needed = {id(op): op for op in ops if nearest_op(op) is None}
    for op in [nearest_op(launch) for launch in launches] + [owner for _, _, _, owner in gpu]:
        while op is not None and id(op) not in needed:
            needed[id(op)] = op
            op = nearest_op(op)

    def depth(op) -> int:
        count, node = 0, nearest_op(op)
        while node is not None:
            count, node = count + 1, nearest_op(node)
        return count

    # 按开始时间排；同时开始的，长的（上层）在前，一样长的按层数：上层算子总排在它下面的算子前面
    kept = sorted(needed.values(), key=lambda op: (op.time_range.start, -op.time_range.end, depth(op)))
    op_index = {id(op): index for index, op in enumerate(kept)}
    launch_index = {id(launch): index for index, launch in enumerate(launches)}

    def op_of(op) -> int | None:
        return None if op is None else op_index[id(op)]

    streams: dict = {}
    gpu_rows = []
    for event, kind, launch, owner in sorted(gpu, key=lambda item: item[0].time_range.start):
        stream = streams.setdefault(getattr(event, "device_resource_id", 0), len(streams))
        gpu_rows.append({**timed(event), "kind": kind, "stream": stream, "op": op_of(owner),
                         "launch": None if launch is None else launch_index[id(launch)]})
    cpu_us = round(anchor.time_range.end - origin, 3)
    return {
        "span_us": round(max([cpu_us] + [row["start"] + row["dur"] for row in gpu_rows]), 3),
        "cpu_us": cpu_us,
        "gpu_us": round(_busy_us((row["start"], row["start"] + row["dur"]) for row in gpu_rows), 3),
        "ops": [{**timed(op), "parent": op_of(nearest_op(op))} for op in kept],
        "launches": [{**timed(launch), "op": op_of(nearest_op(launch))} for launch in launches],
        "gpu": gpu_rows,
    }


def _trace_runs(events, labels: list[str]) -> list[dict]:
    """把 profiler 记下的事件按遍拆开：labels 是每一遍套的 record_function 名字，返回每一遍整理好的一行（_run_line）。

    events 是 torch.profiler 的 FunctionEvent（prof.events()），CPU 上的事件已经按时间嵌套好（cpu_parent）。一遍里有：
      - 挂在这一遍标注下面的 PyTorch 算子和运行时调用（profiler 把运行时调用挂在启动它的算子下面）；
      - GPU 上的事件：id 和这一遍里某个运行时调用相同（同一个 correlation id，就是它启动的），或者
        linked_correlation_id 指向这一遍里的算子（新版 PyTorch 才有）；两样都对不上时按开始时间归到这一遍
        （每一遍之后都等 GPU 算完，下一遍的事件不会早于下一遍开始）。
    """
    order = {label: index for index, label in enumerate(labels)}
    cpu = [event for event in events
           if event.device_type == DeviceType.CPU and not getattr(event, "is_async", False)]
    anchors: dict[int, object] = {}
    for event in cpu:
        if event.name in order:
            anchors.setdefault(order[event.name], event)
    anchored = {id(anchor): index for index, anchor in anchors.items()}

    members: dict[int, list] = {index: [] for index in anchors}
    roles: dict[int, str] = {}
    for event in cpu:
        if id(event) in anchored:
            continue
        node = event.cpu_parent
        while node is not None and id(node) not in anchored:
            node = node.cpu_parent
        role = _cpu_role(event) if node is not None else None
        if role is not None:
            members[anchored[id(node)]].append(event)
            roles[id(event)] = role

    def nearest_op(event):
        node = event.cpu_parent
        while node is not None and id(node) not in anchored:
            if roles.get(id(node)) == "op":
                return node
            node = node.cpu_parent
        return None

    launched: dict = {}  # correlation id → (第几遍, 运行时调用)
    owned: dict = {}  # 算子的 id → (第几遍, 算子)
    for index, group in members.items():
        for event in group:
            table = launched if roles[id(event)] == "runtime" else owned
            table.setdefault(event.id, (index, event))
    starts = sorted((anchor.time_range.start, index) for index, anchor in anchors.items())
    gpu: dict[int, list] = {index: [] for index in anchors}
    for event in events:
        if event.device_type == DeviceType.CPU:
            continue
        kind = _gpu_kind(event)
        if kind is None:
            continue
        linked = getattr(event, "linked_correlation_id", 0) or 0
        if event.id in launched:
            index, launch = launched[event.id]
            gpu[index].append((event, kind, launch, nearest_op(launch)))
        elif linked and linked in owned:
            index, op = owned[linked]
            gpu[index].append((event, kind, None, op))
        else:
            earlier = [index for start, index in starts if start <= event.time_range.start]
            if earlier:
                gpu[earlier[-1]].append((event, kind, None, None))
    return [_run_line(anchors[index], members[index], roles, gpu[index]) for index in sorted(anchors)]


def _trace_activities() -> list:
    """profiler 记哪几类事件：CPU 和 GPU（ROCm 版 PyTorch 里 GPU 也叫 CUDA）。没有 GPU 的单测换成只记 CPU。"""
    from torch.profiler import ProfilerActivity
    return [ProfilerActivity.CPU, ProfilerActivity.CUDA]


def _record(fn: Callable[[], object], labels: list[str]) -> list:
    """在 profiler 里把 fn 调用 len(labels) 遍，每遍套一个 record_function（名字是 labels 里的一个），
    每遍之后等 GPU 算完；返回 profiler 记下的全部事件（FunctionEvent）。"""
    from torch.profiler import profile, record_function

    with profile(activities=_trace_activities()) as recorder:
        for label in labels:
            with record_function(label):
                fn()
            _synchronize()
    return list(recorder.events())


def _trace_line(name: str, fn: Callable[[], object], *, warmup: int, repeat: int) -> dict:
    """记一行：先调用 warmup 次（不记），等 GPU 算完；再在 profiler 里调用 repeat 遍，
    留下「从开始到算完」排在中间的那一遍（偶数遍取中间偏快的那一遍）。"""
    for _ in range(warmup):
        fn()
    _synchronize()
    labels = [f"{_TRACE_TAG} {name} #{index + 1}" for index in range(repeat)]
    runs = _trace_runs(_record(fn, labels), labels)
    if not runs:
        raise RuntimeError("profiler 没有记下这一行：找不到 hg.trace 套在每一遍外面的标注")
    chosen = sorted(runs, key=lambda run: run["span_us"])[(len(runs) - 1) // 2]
    return {"name": name, "runs": len(runs), **chosen}


def _line_summary(line: Mapping) -> dict:
    """一行的汇总：kernel 数、GPU 忙的时间、从开始到算完、GPU 忙的比例、CPU 交完这一行用的时间（毫秒）。"""
    span = line["span_us"]
    return {"kernels": sum(1 for event in line["gpu"] if event["kind"] == "kernel"),
            "gpu_ms": line["gpu_us"] / 1000, "span_ms": span / 1000,
            "busy": line["gpu_us"] / span if span > 0 else 0.0, "cpu_ms": line["cpu_us"] / 1000}


@dataclass(frozen=True, eq=False)
class Trace:
    """hg.trace() 的结果：data 是存成 JSON 的那份 trace（格式见 docs/lab/schema.json 的 trace），path 是保存的位置；
    table 每行一条汇总，metrics 是交成绩用的测量数据。"""

    data: dict
    path: Path

    @property
    def lines(self) -> dict[str, dict]:
        """{名字: 这一行}，每一行同 trace 格式（ops、launches、gpu 三类事件，时间单位是微秒）。"""
        return {line["name"]: line for line in self.data["lines"]}

    @property
    def table(self) -> pd.DataFrame:
        """每行一条：kernel 数、GPU 忙的毫秒数、从开始到算完的毫秒数、GPU 忙的比例、CPU 交完这一行的毫秒数。"""
        return pd.DataFrame.from_dict({line["name"]: _line_summary(line) for line in self.data["lines"]},
                                      orient="index")

    @property
    def metrics(self) -> dict[str, float]:
        """交成绩用的测量数据。名字能当测量项前缀的行（例如 steps、mine_small）各有 <名字>_kernels（kernel 数）、
        <名字>_gpu_ms（GPU 忙的时间）、<名字>_span_ms（从开始到算完）。GPU 上一个事件也没有的行不交：
        什么也没算，「从开始到算完」最短，不能算快。"""
        result = {}
        for line in self.data["lines"]:
            if not line["gpu"] or not codes.METRIC_NAME.fullmatch(f"{line['name']}_kernels"):
                continue
            summary = _line_summary(line)
            for key in ("kernels", "gpu_ms", "span_ms"):
                if codes.positive(summary[key]) is not None:
                    result[f"{line['name']}_{key}"] = float(summary[key])
        return result

    def __repr__(self) -> str:
        return f"Trace({len(self.data['lines'])} 行：{'、'.join(self.lines)})"


def _short_kernel(name: str, width: int = 40) -> str:
    """kernel 的名字去掉返回类型、模板参数、参数表和命名空间，太长的截断：
    void at::native::vectorized_elementwise_kernel<4, …>(int, …) → vectorized_elementwise_kernel。"""
    text = name.replace("(anonymous namespace)", "").strip().removeprefix("void ").strip()
    depth, kept = 0, []
    for char in text:
        if char == "<":
            depth += 1
        elif char == ">":
            depth = max(depth - 1, 0)
        elif depth == 0:
            if char == "(":
                break
            kept.append(char)
    short = "".join(kept).strip().rsplit("::", 1)[-1].strip() or name.strip()
    return short if len(short) <= width else short[:width - 1] + "…"


def _top_op(line: Mapping, index: int | None) -> int | None:
    """ops 里第 index 个算子往上找，找到这一行直接调用的那个（parent 是 null）。"""
    while index is not None and line["ops"][index]["parent"] is not None:
        index = line["ops"][index]["parent"]
    return index


def _span_text(us: float, *, english: bool = False) -> str:
    """微秒数写成 µs 或 ms：不到 1 ms 写 µs。"""
    if us < 1000:
        return f"{us:.1f} µs"
    return f"{us / 1000:.3f} ms" if not english else f"{us / 1000:.3g} ms"


def _text_width(text: str) -> int:
    """等宽字体里占几格：中文（东亚宽字符）占两格。"""
    return sum(2 if unicodedata.east_asian_width(char) in "WF" else 1 for char in text)


def _aligned(rows: list[list[str]], right: set[int], indent: str = "") -> str:
    """几行文字排成表：第一行是表头；right 里的列靠右（数），其余靠左（名字）。"""
    widths = [max(_text_width(cell) for cell in column) for column in zip(*rows)]
    lines = []
    for cells in rows:
        padded = [" " * (width - _text_width(cell)) for cell, width in zip(cells, widths)]
        lines.append(indent + "  ".join(pad + cell if index in right else cell + pad
                                        for index, (cell, pad) in enumerate(zip(cells, padded))).rstrip())
    return "\n".join(lines)


def _print_line(line: Mapping) -> None:
    summary, events = _line_summary(line), line["gpu"]
    if not events:
        print(f"{line['name']}：GPU 上一个事件也没有，这一行没有启动 kernel（还没写完，或者算的东西不在 GPU 上）；"
              f"CPU 上用了 {_span_text(line['cpu_us'])}")
        return
    others = "".join(f"，另有 {count} 次{label}" for kind, label in (("memcpy", "拷贝"), ("memset", "填充"))
                     if (count := sum(1 for event in events if event["kind"] == kind)))
    print(f"{line['name']}：启动了 {summary['kernels']} 个 kernel{others}，GPU 忙了 {_span_text(line['gpu_us'])}")
    print(f"  这一行从开始到算完 {_span_text(line['span_us'])}，GPU 忙的时间占 {summary['busy']:.0%}；"
          f"CPU 交完这一行用了 {_span_text(line['cpu_us'])}（记了 {line['runs']} 遍，这是从开始到算完排在中间的一遍）")
    total = sum(event["dur"] for event in events) or 1.0
    named = []
    for event in events:
        top = _top_op(line, event["op"])
        named.append(("—" if top is None else line["ops"][top]["name"], _short_kernel(event["name"])))
    rows = [["#", "算子", "kernel", "GPU 上开始 µs", "耗时 µs", "占 GPU 时间"]]
    rows += [[str(number), op, kernel, f"{event['start']:.1f}", f"{event['dur']:.1f}", f"{event['dur'] / total:.1%}"]
             for number, (event, (op, kernel)) in enumerate(zip(events, named), 1)]
    print(_aligned(rows, right={0, 3, 4, 5}, indent="  "))
    slowest = max(range(len(events)), key=lambda index: events[index]["dur"])
    op, kernel = named[slowest]
    print(f"最耗时的是第 {slowest + 1} 个：{op} 启动的 {kernel}，占 GPU 时间的 {events[slowest]['dur'] / total:.1%}")


def _print_trace(result: Trace) -> None:
    for line in result.data["lines"]:
        _print_line(line)
        print()
    if len(result.data["lines"]) > 1:
        rows = [["", "kernel 数", "GPU 忙", "从开始到算完", "GPU 忙的比例", "CPU 交完"]]
        for line in result.data["lines"]:
            summary = _line_summary(line)
            rows.append([line["name"], str(summary["kernels"]), _span_text(line["gpu_us"]),
                         _span_text(line["span_us"]), f"{summary['busy']:.0%}", _span_text(line["cpu_us"])])
        print(_aligned(rows, right={1, 2, 3, 4, 5}))
    if not any(line["gpu"] for line in result.data["lines"]):
        print("这几行在 GPU 上一个事件都没记到。张量确实在 GPU 上的话，可能是这个 PyTorch 的 profiler 没带 GPU 支持："
              "回到「准备」看 hg.check_env() 的 PyTorch 那一项")
    print(f"trace 已保存：{result.path}（格式见实验档案馆 docs/lab/schema.json 的 trace）")


def _plot_trace(result: Trace):
    """每一行一张时间线：三条道是 CPU 上的算子、CPU 上的启动、GPU 上的 kernel。同一个算子和它启动的东西同一种颜色。
    图上的字用英文：不少 Jupyter 环境没有中文字体。返回每一行的 Axes。"""
    from matplotlib.patches import Patch
    import matplotlib.pyplot as plt

    lines = result.data["lines"]
    figure, grid = plt.subplots(len(lines), 1, figsize=(9, 1.9 * len(lines)), layout="constrained", squeeze=False)
    for axes, line in zip(grid[:, 0], lines):
        tops = [index for index, op in enumerate(line["ops"]) if op["parent"] is None]
        colors = {index: _TRACE_COLORS[order % len(_TRACE_COLORS)] for order, index in enumerate(tops)}
        span = max(line["span_us"], 1e-3)
        thinnest = span * 0.002  # 太短的事件也画出一条细线
        lanes = ((2, [(line["ops"][index], colors[index]) for index in tops]),
                 (1, [(event, colors.get(_top_op(line, event["op"]), _TRACE_GRAY)) for event in line["launches"]]),
                 (0, [(event, colors.get(_top_op(line, event["op"]), _TRACE_GRAY)) for event in line["gpu"]]))
        for row, items in lanes:
            if items:
                axes.broken_barh([(event["start"], max(event["dur"], thinnest)) for event, _ in items],
                                 (row - 0.35, 0.7), facecolors=[color for _, color in items])
        for index in tops:  # 放得下才把算子名写在条里
            op = line["ops"][index]
            if op["dur"] > span * 0.08:
                axes.text(op["start"] + op["dur"] / 2, 2, op["name"].rsplit("::", 1)[-1], ha="center",
                          va="center", fontsize=7, color="white", clip_on=True)
        legend = [Patch(color=colors[index], label=line["ops"][index]["name"].rsplit("::", 1)[-1])
                  for index in tops[:8]]
        if len(tops) > 8:
            legend.append(Patch(color="none", label=f"… {len(tops) - 8} more"))
        if legend:
            axes.legend(handles=legend, loc="center left", bbox_to_anchor=(1.01, 0.5), fontsize=7, frameon=False)
        earliest = min([0.0, *(event["start"] for event in line["gpu"])])
        axes.set_xlim(earliest, span * 1.01)
        axes.set_ylim(-0.6, 2.6)
        axes.set_yticks([0, 1, 2], ["GPU kernels", "CPU launches", "CPU ops"])
        summary = _line_summary(line)
        count = summary["kernels"]
        axes.set_title(f"{line['name']}: {count} kernel{'' if count == 1 else 's'}, GPU busy {summary['busy']:.0%} "
                       f"of {_span_text(span, english=True)}", fontsize=9, loc="left")
        axes.grid(axis="x", alpha=0.2)
    grid[-1, 0].set_xlabel("time since the line started (µs)")
    return list(grid[:, 0])


def trace(lines: Mapping[str, Callable[[], object]], *, warmup: int = 1, repeat: int = 5,
          plot: bool = True) -> Trace:
    """用 torch.profiler 记下几行 PyTorch 代码在 CPU 和 GPU 上各做了什么（2-5 一行 PyTorch 背后）。

    lines：{名字: 准备好输入的无参函数}，一个函数就是要看的那一行，例如 {"mlp": lambda: F.gelu(x @ w + b)}。
    每一行先调用 warmup 次（不记：第一次调用要加载 kernel、初始化计算库），等 GPU 算完；再在 profiler 里调用 repeat 遍，
    每遍之后都等 GPU 算完，留下「从开始到算完」排在中间的那一遍。记三类事件：CPU 上的 PyTorch 算子、CPU 上的运行时调用
    （启动 kernel 的 hipLaunchKernel 等）、GPU 上的 kernel（和拷贝、填充）。
    打印每一行启动了几个 kernel，每个 kernel 是哪个算子启动的、在 GPU 上跑了多久，GPU 忙的时间占这一行的多少；
    plot=True 时再画时间线（图上的字是英文）。trace 存成 JSON，放在 artifact 目录的 traces/ 下，格式见
    docs/lab/schema.json 的 trace，实验档案馆收录的就是这份文件。某一行运行出错时打印原因、跳过这一行。
    profiler 自己也要记账：CPU 上的时间比不开 profiler 时长一些，GPU 上 kernel 的时间不受影响。返回 Trace。
    """
    if not isinstance(lines, Mapping) or not lines:
        raise TypeError('lines 要写成 {名字: 无参函数}，至少一行，例如 {"mlp": lambda: F.gelu(x @ w + b)}')
    for name, fn in lines.items():
        if not isinstance(name, str) or not name.strip():
            raise ValueError("每一行都要有名字（非空字符串）")
        if not callable(fn):
            raise TypeError(f"{name}：要是准备好输入的无参函数，例如 lambda: F.gelu(x @ w + b)")
    for value, key, least in ((warmup, "warmup", 0), (repeat, "repeat", 1)):
        if isinstance(value, bool) or not isinstance(value, int) or value < least:
            raise ValueError(f"{key} 要是不小于 {least} 的整数，现在是 {value!r}")
    _require_gpu("hg.trace()")
    moment = _now()
    recorded = []
    for name, fn in lines.items():
        try:
            recorded.append(_trace_line(name, fn, warmup=warmup, repeat=repeat))
        except Exception as error:  # 读者的那一行出错，只是这一行没记下来，接着记后面的
            print(f"{name}：运行出错，这一行没记下来：{type(error).__name__}: {_first_line(error)}")
    if not recorded:
        raise RuntimeError("hg.trace()：每一行都运行出错，什么也没记下来，原因见上面")
    data = {"v": TRACE_VERSION, "at": _stamp(moment), "device": _identity(_device()), "env": _versions(),
            "lines": recorded}
    # 文件名带到微秒：同一秒里记了好几次，按文件名排也是 Notebook 里的先后（档案馆按这个顺序收）
    path = artifact_root() / "traces" / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}-{uuid4().hex[:8]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    result = Trace(data, path)
    _print_trace(result)
    if plot:
        _plot_trace(result)
    return result
