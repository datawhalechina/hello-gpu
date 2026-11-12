"""实验室共享样例（docs/course/lab-rules.fixtures.json）在 Python 这边的结果。

网页的 TypeScript（L-02）跑同一份样例；两边对同一条样例的结果不一致，就是其中一边写错了。
"""

import json
from pathlib import Path

import pytest

from hello_gpu import codes, stars

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = json.loads((ROOT / "docs" / "course" / "lab-rules.fixtures.json").read_text(encoding="utf-8"))
OUTLINE = json.loads((ROOT / "docs" / "course" / "outline.json").read_text(encoding="utf-8"))
LAB_STAGES = {stage["id"]: stage["lab"] for stage in OUTLINE["stages"] if "lab" in stage}


def _rules(case):
    if "stage" not in case:
        return case["stars"]
    assert case["stage"] in LAB_STAGES, f"outline.json 里的 {case['stage']} 没有 lab.stars"
    return LAB_STAGES[case["stage"]]["stars"]


@pytest.mark.parametrize("case", FIXTURES["cases"], ids=lambda case: case["name"])
def test_star_cases(case):
    assert stars.evaluate(_rules(case), case["credential"]) == case["earned"]


@pytest.mark.parametrize("case", FIXTURES["invalid"], ids=lambda case: case["name"])
def test_invalid_rules_are_rejected(case):
    credential = {"checks": {"passed": 1, "total": 1}, "metrics": {"median_ms": 1.0}}
    with pytest.raises(ValueError):
        stars.evaluate(case["stars"], credential)


@pytest.mark.parametrize("sample", FIXTURES["codes"], ids=lambda sample: sample["name"])
def test_codes_from_python_and_node_decode_to_the_same_payload(sample):
    prefix, payload = codes.decode(sample["code"])
    assert prefix == (codes.CREDENTIAL if "stage" in sample["payload"] else codes.CARD)
    assert payload == sample["payload"]
    # 压缩出来的字节可以和别的实现不同，解回来的内容必须相同。
    assert codes.decode(codes.encode(prefix, payload)) == (prefix, payload)


def test_every_lab_stage_has_valid_rules_and_shared_cases():
    covered = {case["stage"] for case in FIXTURES["cases"] if "stage" in case}
    for stage, lab in LAB_STAGES.items():
        stars.check_stars(lab["stars"])
        assert stage in covered, f"{stage} 写了 lab.stars，lab-rules.fixtures.json 里还没有这一关的样例"
