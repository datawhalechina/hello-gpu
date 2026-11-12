"""星级规则求值器（课程规则）。

规则写在 outline.json 对应关卡的 lab.stars 里，每颗星是 {"text": 说明, "rule": 规则}。规则只有两种：

- {"checksAll": true}：校验全部通过，即 checks.total ≥ 1 且 checks.passed == checks.total；
- {"ratio": [a, b], "gte": x}：metrics[a] / metrics[b] ≥ x，a、b 都必须是凭证里有限的正数。

网页（L-02，TypeScript）和这里各实现一份，docs/course/lab-rules.fixtures.json 里的样例两边都跑，
结果必须一致。规则写错是作者的数据问题，直接抛 ValueError；凭证里缺数或者数不合格是读者的数据，
只算这颗星没拿到，不报错。星级从不读凭证里自带的结论。
"""

from __future__ import annotations

from collections.abc import Mapping

from .codes import METRIC_NAME, _show, count, positive


def check_rule(rule) -> None:
    """规则写错时抛 ValueError（中文说明）。"""
    if isinstance(rule, Mapping) and set(rule) == {"checksAll"}:
        if rule["checksAll"] is not True:
            raise ValueError("checksAll 只能写 true")
        return
    if isinstance(rule, Mapping) and set(rule) == {"ratio", "gte"}:
        ratio = rule["ratio"]
        if not (isinstance(ratio, (list, tuple)) and len(ratio) == 2
                and all(isinstance(name, str) and METRIC_NAME.fullmatch(name) for name in ratio)):
            raise ValueError('ratio 要写成两个测量项的名字，例如 ["gbps", "peak_gbps"]')
        if ratio[0] == ratio[1]:
            raise ValueError("ratio 的两个测量项不能相同")
        if positive(rule["gte"]) is None:
            raise ValueError("gte 要是有限的正数")
        return
    raise ValueError(f'不认识的规则 {_show(rule)}：只支持 {{"checksAll": true}} 和 {{"ratio": [a, b], "gte": x}}')


def check_stars(stars) -> None:
    """检查一关的 lab.stars；写错时抛 ValueError，说明是第几颗星。"""
    if not isinstance(stars, (list, tuple)):
        raise ValueError("lab.stars 要是一个列表")
    for index, star in enumerate(stars, 1):
        if not isinstance(star, Mapping):
            raise ValueError(f'第 {index} 颗星要写成 {{"text": 说明, "rule": 规则}}')
        text = star.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"第 {index} 颗星缺少说明 text")
        try:
            check_rule(star.get("rule"))
        except ValueError as error:
            raise ValueError(f"第 {index} 颗星：{error}") from None


def evaluate(stars, credential) -> list[bool]:
    """按规则逐颗判断这份凭证拿到了哪些星，返回和 stars 一样长的 True / False 列表。"""
    check_stars(stars)
    return [_earned(star["rule"], credential) for star in stars]


def _earned(rule: Mapping, credential) -> bool:
    if not isinstance(credential, Mapping):
        return False
    if "checksAll" in rule:
        checks = credential.get("checks")
        if not isinstance(checks, Mapping):
            return False
        passed, total = count(checks.get("passed")), count(checks.get("total"))
        return passed is not None and total is not None and total >= 1 and passed == total
    metrics = credential.get("metrics")
    if not isinstance(metrics, Mapping):
        return False
    top, bottom = (positive(metrics.get(name)) for name in rule["ratio"])
    return top is not None and bottom is not None and top / bottom >= positive(rule["gte"])
