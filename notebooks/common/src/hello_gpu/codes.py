"""通关码（HGPU1.）和「我的 GPU 卡片」导入码（HGCARD1.）：编码、解码和校验。

编码方式见 课程规则：JSON → UTF-8 → raw deflate → base64url（不补 =），前面加前缀。
网页端（L-02 通关码、L-07 卡片）用同一种编码；两边都解一遍
docs/course/lab-rules.fixtures.json 里 codes 的样例，保证互通。
本模块只用标准库，不导入 torch，没有 GPU 的机器上也能用。

通关凭证 v1（HGPU1.）::

    {"v": 1, "stage": 关卡 id, "route": "hip" | "triton" | "shared",
     "at": "2026-11-08T10:00:00Z"（UTC，精确到秒）,
     "device": {"name": GPU 名称, "gfx": gfx 架构, "cus": CU 数},
     "env": {"rocm": 版本或 null, "torch": 版本或 null, "triton": 版本或 null},
     "checks": {"passed": 通过的形状数, "total": 形状总数},
     "metrics": {测量项: 有限的正数, ...}}

GPU 卡片 v1（HGCARD1.）::

    {"v": 1, "at": 同上,
     "device": {"name", "gfx", "cus", "wave": wave 大小或 null, "memory_bytes": 显存字节数},
     "env": 同上,
     "peak": {"gbps": 峰值带宽, "tflops": 峰值算力}（可选：hg.peak() 测过才有）}

校验失败抛 CodeError，kind 是 format（不是完整的码）、version（版本不对）、
stage（不是这一关的）或 data（数据异常），对应网页上的几类中文提示。
多出来的字段不算错，但网页和本包都不会读它（星级只按规则重新计算）。
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Mapping
from datetime import datetime
import json
import math
import re
import zlib

CREDENTIAL = "HGPU1."
CARD = "HGCARD1."
VERSION = 1
ROUTES = ("hip", "triton", "shared")
#: 关卡 id：区域（或 dungeon）加 slug，例如 forge-softmax、dungeon-spmv。
STAGE_ID = re.compile(r"[a-z]+(?:-[a-z0-9]+)+")
#: 测量项的名字：小写字母开头，只用小写字母、数字和下划线，例如 median_ms、peak_gbps。
METRIC_NAME = re.compile(r"[a-z][a-z0-9_]*")

_GFX = re.compile(r"gfx[0-9a-f]+")
_PREFIX = re.compile(r"(?:HGPU|HGCARD)\d+\.")
_BODY = re.compile(r"[A-Za-z0-9_-]+")
_ENV_KEYS = ("rocm", "torch", "triton")
# 正常的码解开不到 1 KB；限制解压后的大小，免得一串恶意的码解出几个 GB。
_MAX_JSON_BYTES = 64 * 1024


class CodeError(ValueError):
    """码解不开或内容不合格；kind 是 format、version、stage 或 data。"""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def number(value) -> float | None:
    """JSON 里的有限数（布尔值不算）转成 float；不是就返回 None。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        result = float(value)
    except OverflowError:
        return None
    return result if math.isfinite(result) else None


def positive(value) -> float | None:
    """有限的正数转成 float，否则返回 None。"""
    result = number(value)
    return result if result is not None and result > 0 else None


def count(value) -> int | None:
    """非负整数，否则返回 None。5.0 也算 5：网页上 JSON 的 5 和 5.0 是同一个数。"""
    result = number(value)
    return int(result) if result is not None and result >= 0 and result.is_integer() else None


def _show(value) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return repr(value)


def _check_common(payload) -> None:
    if not isinstance(payload, Mapping):
        raise CodeError("format", "码里装的不是一个 JSON 对象")
    if number(payload.get("v")) != VERSION:
        raise CodeError("version", f"版本不对：这里只认识 v = {VERSION}，这个码是 v = {_show(payload.get('v'))}")
    at = payload.get("at")
    try:
        valid = isinstance(at, str) and len(at) == 20 and bool(datetime.strptime(at, "%Y-%m-%dT%H:%M:%SZ"))
    except ValueError:
        valid = False
    if not valid:
        raise CodeError("data", "生成时间 at 应该是 2026-11-08T10:00:00Z 这样的 UTC 时间")


def _check_device(device, *, card: bool) -> None:
    if not isinstance(device, Mapping):
        raise CodeError("data", "缺少设备信息 device")
    name = device.get("name")
    if not isinstance(name, str) or not name.strip():
        raise CodeError("data", "device.name（GPU 名称）应该是一段文字")
    gfx = device.get("gfx")
    if not isinstance(gfx, str) or not _GFX.fullmatch(gfx):
        raise CodeError("data", "device.gfx（架构）应该是 gfx 加架构编号")
    cus = count(device.get("cus"))
    if cus is None or cus < 1:
        raise CodeError("data", "device.cus（CU 数）应该是正整数")
    if not card:
        return
    wave = device.get("wave")
    if wave is not None and (count(wave) or 0) < 1:
        raise CodeError("data", "device.wave（wave 大小）应该是正整数，不知道时写 null")
    memory = count(device.get("memory_bytes"))
    if memory is None or memory < 1:
        raise CodeError("data", "device.memory_bytes（显存字节数）应该是正整数")


def _check_env(env) -> None:
    if not isinstance(env, Mapping):
        raise CodeError("data", "缺少软件版本 env")
    for key in _ENV_KEYS:
        value = env.get(key)
        if value is not None and not isinstance(value, str):
            raise CodeError("data", f"env.{key} 应该是版本号文字，查不到时写 null")


def check_credential(payload, *, stage: str | None = None) -> None:
    """检查通关凭证；给出 stage 时还要求是这一关的凭证。不合格时抛 CodeError。"""
    _check_common(payload)
    found = payload.get("stage")
    if not isinstance(found, str) or not STAGE_ID.fullmatch(found):
        raise CodeError("data", "关卡 id（stage）缺失或写法不对")
    if stage is not None and found != stage:
        raise CodeError("stage", f"这是关卡 {found} 的通关码，不是本关（{stage}）的")
    if payload.get("route") not in ROUTES:
        raise CodeError("data", "路线（route）只能是 hip、triton 或 shared")
    _check_device(payload.get("device"), card=False)
    _check_env(payload.get("env"))
    checks = payload.get("checks")
    passed = count(checks.get("passed")) if isinstance(checks, Mapping) else None
    total = count(checks.get("total")) if isinstance(checks, Mapping) else None
    if passed is None or total is None or total < 1 or passed > total:
        raise CodeError("data", "校验结果 checks 应该是 {passed, total}，0 ≤ passed ≤ total，total ≥ 1")
    metrics = payload.get("metrics")
    if not isinstance(metrics, Mapping):
        raise CodeError("data", "缺少测量数据 metrics")
    for name, value in metrics.items():
        if not isinstance(name, str) or not METRIC_NAME.fullmatch(name):
            raise CodeError("data", f"测量项的名字 {_show(name)} 只能用小写字母、数字和下划线，并以字母开头")
        if positive(value) is None:
            raise CodeError("data", f"测量项 {name} 应该是有限的正数，现在是 {_show(value)}")


def check_card(payload) -> None:
    """检查 GPU 卡片；不合格时抛 CodeError。"""
    _check_common(payload)
    _check_device(payload.get("device"), card=True)
    _check_env(payload.get("env"))
    peak = payload.get("peak")
    if peak is not None and not (
        isinstance(peak, Mapping) and positive(peak.get("gbps")) and positive(peak.get("tflops"))
    ):
        raise CodeError("data", "peak 应该是 {gbps, tflops}，两个都是有限的正数")


def encode(prefix: str, payload: Mapping) -> str:
    """把凭证（CREDENTIAL）或卡片（CARD）编码成码；先按格式检查，保证网页能导入。"""
    if prefix == CREDENTIAL:
        check_credential(payload)
    elif prefix == CARD:
        check_card(payload)
    else:
        raise ValueError(f"前缀只能是 {CREDENTIAL} 或 {CARD}")
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    packer = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = packer.compress(text.encode("utf-8")) + packer.flush()
    return prefix + base64.urlsafe_b64encode(packed).decode("ascii").rstrip("=")


def _reject_constant(name: str):
    raise ValueError(f"JSON 里不能有 {name}")


def decode(code: str, *, stage: str | None = None) -> tuple[str, dict]:
    """解开通关码或导入码，返回 (前缀, 内容)；内容已按前缀对应的格式检查过。

    复制时混进来的空白会被忽略。给出 stage 时，通关码必须是这一关的。
    """
    if not isinstance(code, str):
        raise CodeError("format", "码应该是一串文字")
    text = "".join(code.split())
    match = _PREFIX.match(text)
    if match is None:
        raise CodeError("format", f"不是 Hello GPU 的码：开头应该是 {CREDENTIAL} 或 {CARD}")
    prefix = match.group(0)
    if prefix not in (CREDENTIAL, CARD):
        raise CodeError("version", f"版本不对：这里只认识 {CREDENTIAL} 和 {CARD} 开头的码，这个码是 {prefix}")
    body = text[match.end():]
    if not _BODY.fullmatch(body):
        raise CodeError("format", "码里有不该出现的字符，或者没有复制完整")
    try:
        packed = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
        unpacker = zlib.decompressobj(-15)
        raw = unpacker.decompress(packed, _MAX_JSON_BYTES + 1)
    except (binascii.Error, ValueError, zlib.error):
        raise CodeError("format", "码不完整或被改动过，解不开") from None
    if len(raw) > _MAX_JSON_BYTES:
        raise CodeError("format", "码里的内容太长，不是 Hello GPU 生成的")
    if not unpacker.eof or unpacker.unused_data:
        raise CodeError("format", "码不完整或被改动过，解不开")
    try:
        payload = json.loads(raw.decode("utf-8"), parse_constant=_reject_constant)
    except ValueError:
        raise CodeError("format", "码里的内容不是有效的 JSON") from None
    if prefix == CREDENTIAL:
        check_credential(payload, stage=stage)
    else:
        check_card(payload)
    return prefix, payload
