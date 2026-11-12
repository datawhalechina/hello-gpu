"""通关码和导入码：网页会拒绝的内容，这里既不生成，也解不出来；错误分成几类，网页按类给中文提示。"""

import base64
import json
import zlib

import pytest

from hello_gpu import codes


def credential(**changes):
    payload = {
        "v": 1, "stage": "forge-softmax", "route": "hip", "at": "2026-11-08T10:00:00Z",
        "device": {"name": "Fixture GPU", "gfx": "gfx9999", "cus": 10},
        "env": {"rocm": None, "torch": "0.0.0+fixture", "triton": None},
        "checks": {"passed": 5, "total": 5},
        "metrics": {"median_ms": 0.123, "torch_ms": 0.15},
    }
    return payload | changes


def card(**changes):
    payload = {
        "v": 1, "at": "2026-11-08T10:00:00Z",
        "device": {"name": "Fixture GPU", "gfx": "gfx9999", "cus": 10, "wave": 32, "memory_bytes": 1 << 30},
        "env": {"rocm": None, "torch": "0.0.0+fixture", "triton": None},
    }
    return payload | changes


def pack(prefix: str, text: str) -> str:
    """不经过检查直接打包：模拟别处生成或者被改过的码。"""
    packer = zlib.compressobj(9, zlib.DEFLATED, -15)
    packed = packer.compress(text.encode("utf-8")) + packer.flush()
    return prefix + base64.urlsafe_b64encode(packed).decode("ascii").rstrip("=")


def test_round_trip_is_url_safe_and_ignores_whitespace_from_copying():
    code = codes.encode(codes.CREDENTIAL, credential())
    assert not set(code) & set("+/= ")
    pasted = f"  {code[:30]}\n{code[30:]}\n"
    assert codes.decode(pasted, stage="forge-softmax") == (codes.CREDENTIAL, credential())
    with_peak = card(peak={"gbps": 610.0, "tflops": 40.0})
    assert codes.decode(codes.encode(codes.CARD, with_peak)) == (codes.CARD, with_peak)


BAD_CREDENTIALS = [
    ({"v": 2}, "version"),
    ({"v": True}, "version"),  # Python 里 True == 1，JSON 和网页里不是
    ({"stage": "forge-norm"}, "stage"),
    ({"stage": "Forge Softmax"}, "data"),
    ({"route": "cuda"}, "data"),
    ({"at": "2026-11-08 10:00:00"}, "data"),
    ({"at": "2026-13-08T10:00:00Z"}, "data"),
    ({"device": {"name": "Fixture GPU", "gfx": "9999", "cus": 10}}, "data"),
    ({"device": {"name": "Fixture GPU", "gfx": "gfx9999", "cus": 0}}, "data"),
    ({"env": {"rocm": 10}}, "data"),
    ({"checks": {"passed": 6, "total": 5}}, "data"),
    ({"checks": {"passed": 0, "total": 0}}, "data"),
    ({"checks": {"passed": 1.5, "total": 2}}, "data"),
    ({"metrics": {"median_ms": 0}}, "data"),
    ({"metrics": {"median_ms": -0.1}}, "data"),
    ({"metrics": {"median_ms": "0.1"}}, "data"),
    ({"metrics": {"median_ms": True}}, "data"),
    ({"metrics": {"median_ms": None}}, "data"),
    ({"metrics": {"Median": 0.1}}, "data"),
    ({"metrics": [0.1]}, "data"),
]


@pytest.mark.parametrize("changes,kind", BAD_CREDENTIALS)
def test_decode_rejects_bad_credentials_with_a_kind(changes, kind):
    code = pack(codes.CREDENTIAL, json.dumps(credential(**changes)))
    with pytest.raises(codes.CodeError) as caught:
        codes.decode(code, stage="forge-softmax")
    assert caught.value.kind == kind


# 关卡对不对只有导入的那一页知道，其他问题生成时就要拦下。
@pytest.mark.parametrize("changes", [changes for changes, kind in BAD_CREDENTIALS if kind != "stage"])
def test_encode_never_produces_a_code_the_page_would_reject(changes):
    with pytest.raises(codes.CodeError):
        codes.encode(codes.CREDENTIAL, credential(**changes))


@pytest.mark.parametrize("value", [float("nan"), float("inf"), 10**400])
def test_encode_rejects_non_finite_metrics(value):
    with pytest.raises(codes.CodeError) as caught:
        codes.encode(codes.CREDENTIAL, credential(metrics={"median_ms": value}))
    assert caught.value.kind == "data"


@pytest.mark.parametrize("changes", [
    {"device": {"name": "Fixture GPU", "gfx": "gfx9999", "cus": 10, "wave": 0, "memory_bytes": 1}},
    {"device": {"name": "Fixture GPU", "gfx": "gfx9999", "cus": 10, "wave": None}},
    {"peak": {"gbps": 610.0}},
    {"peak": {"gbps": 610.0, "tflops": 0}},
    {"env": None},
])
def test_bad_cards_are_neither_encoded_nor_decoded(changes):
    with pytest.raises(codes.CodeError):
        codes.encode(codes.CARD, card(**changes))
    with pytest.raises(codes.CodeError) as caught:
        codes.decode(pack(codes.CARD, json.dumps(card(**changes))))
    assert caught.value.kind == "data"


def test_card_may_leave_wave_size_unknown():
    unknown_wave = card(device=card()["device"] | {"wave": None})
    assert codes.decode(codes.encode(codes.CARD, unknown_wave)) == (codes.CARD, unknown_wave)


def test_decode_reports_damaged_or_foreign_codes():
    good = codes.encode(codes.CREDENTIAL, credential())
    oversized = credential(metrics={"median_ms": 0.1}, note="x" * 70_000)
    cases = [
        ("HGX1.abc", "format"),
        ("HGPU2." + good.removeprefix(codes.CREDENTIAL), "version"),
        (good[:-12], "format"),
        (good + "AAAA", "format"),
        (good[:20] + "+" + good[21:], "format"),
        (pack(codes.CREDENTIAL, "[1, 2]"), "format"),
        (pack(codes.CREDENTIAL, json.dumps(credential()).replace("0.123", "NaN")), "format"),
        (pack(codes.CREDENTIAL, json.dumps(credential()).replace("0.123", "1e999")), "data"),
        (pack(codes.CREDENTIAL, json.dumps(oversized)), "format"),
        (pack(codes.CARD, json.dumps(credential())), "data"),
        (pack(codes.CREDENTIAL, json.dumps(card())), "data"),
    ]
    for code, kind in cases:
        with pytest.raises(codes.CodeError) as caught:
            codes.decode(code)
        assert caught.value.kind == kind, code[:40]


def test_unknown_fields_do_not_break_decoding():
    claimed = credential(stars=3, comment="凭证里的结论不会被采用")
    assert codes.decode(codes.encode(codes.CREDENTIAL, claimed))[1] == claimed
