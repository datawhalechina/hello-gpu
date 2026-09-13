"""把 trajectory.jsonl 画成优化过程图。

输出：
- rounds_overview.png   延迟 / 改进比例 / 接受标记
- status_breakdown.png  状态分布
- process_timeline.png  每轮改动时间线（文字标注）
"""

from __future__ import annotations

import json
import math
import textwrap
from pathlib import Path
from typing import Any


def load_trajectory(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.is_file():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def _status_key(row: dict[str, Any]) -> str:
    if row.get("accepted"):
        return "accepted"
    status = str(row.get("status") or "unknown")
    reason = str(row.get("reason") or "")
    if status == "compile_error" or "compile_error" in reason:
        return "compile_error"
    if "below_threshold" in reason or status == "below_threshold":
        return "below_threshold"
    if status != "ok":
        return status
    return "rejected"


def _recorded_number(value: Any) -> float | None:
    """缺失或非有限数值不参与绘图，尤其不能补成零延迟。"""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _accepted_latency_series(rows: list[dict[str, Any]]) -> list[float | None]:
    """逐轮保留当前接受版本的记录值，不取所有候选的历史最小值。

    首次接受前没有可推断的 baseline。接受新版本但缺少延迟时，旧版本
    的延迟也不再代表当前版本，因此断线；拒绝轮则沿用当前版本的记录。
    各轮记录来自各自的评测，后接受版本的记录值不保证单调下降。
    """
    current = None
    values: list[float | None] = []
    for row in rows:
        if row.get("accepted"):
            current = _recorded_number(row.get("latencyMs"))
        values.append(current)
    return values


# 同一状态在三幅图中使用同一颜色、点形和纹理；不只依赖颜色。
_STATUS_STYLES = {
    "accepted": ("接受", "#087f8c", "o", ""),
    "below_threshold": ("未达阈值", "#b7791f", "^", "///"),
    "rejected": ("拒绝", "#64748b", "^", "///"),
    "compile_error": ("编译失败", "#b64b4b", "X", "xx"),
    "wrong_answer": ("答案错误", "#b64b4b", "X", "xx"),
    "runtime_error": ("运行失败", "#b64b4b", "X", "xx"),
    "timeout": ("超时", "#b64b4b", "X", "xx"),
    "unknown": ("未知状态", "#74648b", "D", ".."),
}


def _status_style(status: str) -> tuple[str, str, str, str]:
    if status in _STATUS_STYLES:
        return _STATUS_STYLES[status]
    if "error" in status or "fail" in status:
        return status, "#b64b4b", "X", "xx"
    return status, "#74648b", "D", ".."


def _setup_cjk_font() -> None:
    """尽量启用本机中文字体，避免 timeline 中文缺字。"""
    from matplotlib import font_manager, rcParams

    candidates = [
        "PingFang SC",
        "Hiragino Sans GB",
        "Noto Sans CJK SC",
        "Noto Sans CJK JP",
        "Source Han Sans SC",
        "WenQuanYi Micro Hei",
        "WenQuanYi Zen Hei",
        "SimHei",
        "Microsoft YaHei",
        "Arial Unicode MS",
    ]
    available = {f.name for f in font_manager.fontManager.ttflist}
    for name in candidates:
        if name in available:
            rcParams["font.sans-serif"] = [name, "DejaVu Sans"]
            rcParams["axes.unicode_minus"] = False
            return
    # 常见路径兜底
    for path in (
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Hiragino Sans GB.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
    ):
        p = Path(path)
        if p.is_file():
            font_manager.fontManager.addfont(str(p))
            # TTC 可能含多 face；优先挑 CJK SC / CN
            matched = None
            for f in font_manager.fontManager.ttflist:
                if str(p) in getattr(f, "fname", "") and (
                    "CJK SC" in f.name or "CN" in f.name or "Micro Hei" in f.name or "UMing" in f.name
                ):
                    matched = f.name
                    break
            name = matched or font_manager.FontProperties(fname=str(p)).get_name()
            rcParams["font.sans-serif"] = [name, "DejaVu Sans"]
            rcParams["axes.unicode_minus"] = False
            return
    rcParams["axes.unicode_minus"] = False


def render_visualizations(
    workspace: Path,
    out_dir: Path | None = None,
    threshold: float = 0.01,
    title: str = "Kernel Optimize Agent · vector_add",
) -> list[Path]:
    import matplotlib

    matplotlib.use("Agg")
    # 独立于调用方的深色主题；退出后恢复调用方的绘图配置。
    with matplotlib.rc_context({
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "savefig.facecolor": "white",
        "text.color": "#243244",
        "axes.labelcolor": "#243244",
        "axes.edgecolor": "#94a3b8",
        "xtick.color": "#475569",
        "ytick.color": "#475569",
        "grid.color": "#cbd5e1",
        "axes.spines.top": False,
        "axes.spines.right": False,
        "font.family": "sans-serif",
        "font.size": 10,
        "legend.frameon": False,
    }):
        _setup_cjk_font()
        return _render_visualizations(workspace, out_dir, threshold, title)


def _render_visualizations(
    workspace: Path,
    out_dir: Path | None,
    threshold: float,
    title: str,
) -> list[Path]:
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    from matplotlib.patches import FancyBboxPatch, Patch
    from matplotlib.ticker import MaxNLocator

    traj_path = workspace / "trajectory.jsonl"
    rows = load_trajectory(traj_path)
    out_dir = out_dir or (workspace / "viz")
    out_dir.mkdir(parents=True, exist_ok=True)

    if not rows:
        empty = out_dir / "EMPTY.txt"
        empty.write_text("trajectory.jsonl 为空，无法绘图。\n", encoding="utf-8")
        return [empty]

    rounds = list(range(1, len(rows) + 1))
    latencies = [_recorded_number(r.get("latencyMs")) for r in rows]
    improvements = [_recorded_number(r.get("improvementFraction")) for r in rows]
    statuses = [_status_key(r) for r in rows]
    changes = [str(r.get("change") or "") for r in rows]
    ordered_statuses = [s for s in _STATUS_STYLES if s in statuses]
    ordered_statuses += [s for s in dict.fromkeys(statuses) if s not in ordered_statuses]
    status_handles = []
    hatch_handles = []
    for status in ordered_statuses:
        label, color, marker, hatch = _status_style(status)
        status_handles.append(Line2D(
            [], [], marker=marker, linestyle="none", color=color,
            markersize=8, label=label,
        ))
        hatch_handles.append(Patch(
            facecolor=color, edgecolor="#334155", hatch=hatch, label=label,
        ))

    saved: list[Path] = []

    # ── 1) 总览：延迟 + 改进 ──────────────────────────────────────
    fig, axes = plt.subplots(2, 1, figsize=(12, 9), sharex=True)
    fig.suptitle(title, fontsize=14, fontweight=600)

    ax0 = axes[0]
    accepted_latencies = _accepted_latency_series(rows)
    current_label = "当前接受版本的记录延迟"
    current_color = "#243244"
    if any(v is not None for v in latencies):
        ax0.step(
            rounds, [v if v is not None else float("nan") for v in accepted_latencies],
            where="post", color=current_color, linewidth=1.8,
            label=current_label, zorder=2,
        )
        for status in ordered_statuses:
            _, color, marker, _ = _status_style(status)
            points = [(i, v) for i, v, s in zip(rounds, latencies, statuses)
                      if v is not None and s == status]
            if points:
                ax0.scatter(
                    [i for i, _ in points], [v for _, v in points],
                    color=color, marker=marker, s=70, zorder=3,
                    edgecolors="#334155", linewidths=0.6,
                )
    else:
        ax0.text(0.5, 0.5, "未记录有效延迟", ha="center", va="center", transform=ax0.transAxes)
    # 缺失延迟用轴下方的状态点表示，不假装成 y=0 的测量。
    for i, value, status in zip(rounds, latencies, statuses):
        if value is None:
            _, color, marker, _ = _status_style(status)
            ax0.scatter(i, -0.08, color=color, marker=marker, s=45,
                        transform=ax0.get_xaxis_transform(), clip_on=False)
    ax0.set_title("候选延迟与接受版本：越低表示本轮记录越短", loc="left", fontsize=11, pad=12)
    ax0.set_ylabel("本轮记录延迟（ms）")
    ax0.grid(True, axis="y", alpha=0.65)
    ax0.legend(handles=status_handles + [Line2D(
        [], [], color=current_color, linewidth=1.8, label=current_label,
    )], loc="lower left", bbox_to_anchor=(0, 1.14), ncol=3, fontsize=9)
    ax0.text(0, -0.17, "轴下方的状态点＝该轮无有效延迟，不能读成 0 ms。",
             transform=ax0.transAxes, fontsize=9, color="#475569")

    ax1 = axes[1]
    threshold_label = f"接受阈值 {threshold:.3g}（{threshold * 100:g}%）"
    if any(v is not None for v in improvements):
        ax1.axhline(threshold * 100, color="#b64b4b", linestyle="--", linewidth=1.2)
        ax1.axhline(0, color="#64748b", linewidth=0.8)
        for i, value, status in zip(rounds, improvements, statuses):
            if value is not None:
                _, color, _, hatch = _status_style(status)
                ax1.bar(i, value * 100, color=color, hatch=hatch, edgecolor="#334155",
                        linewidth=0.6, width=0.65)
    else:
        ax1.text(0.5, 0.5, "未记录成对比较改进率", ha="center", va="center", transform=ax1.transAxes)
    ax1.set_title("成对比较改进率：相对本轮重新测量的当前版本", loc="left", fontsize=11, pad=12)
    ax1.set_xlabel("尝试轮次（按 trajectory.jsonl 的记录顺序）")
    ax1.set_ylabel("本轮成对比较改进率（%）")
    ax1.grid(True, axis="y", alpha=0.65)
    ax1.set_axisbelow(True)
    ax1.xaxis.set_major_locator(MaxNLocator(integer=True))
    ax1.set_xlim(0.4, len(rows) + 0.6)
    ax1.legend(handles=hatch_handles + [Line2D(
        [], [], color="#b64b4b", linestyle="--", linewidth=1.2, label=threshold_label,
    )], loc="lower left", bbox_to_anchor=(0, 1.14), ncol=3, fontsize=9)

    fig.text(0.06, 0.055,
             "实线仅在接受时更新，拒绝时沿用；首次接受前及接受版本缺少延迟时留空，不推断 baseline。",
             fontsize=9, color="#475569")
    fig.text(0.06, 0.03,
             "跨轮记录延迟不保证单调下降，也不等于独立最终基准测试；最终收益须重新成对评测确认。",
             fontsize=9, color="#475569")
    fig.tight_layout(rect=(0, 0.085, 1, 0.98), h_pad=4)
    p1 = out_dir / "rounds_overview.png"
    fig.savefig(p1, dpi=150)
    plt.close(fig)
    saved.append(p1)

    # ── 2) 状态分布（饼图 + 条形，中文标签）────────────────────────
    from collections import Counter

    counts = Counter(statuses)
    ordered = ordered_statuses
    labels_zh = [_status_style(k)[0] for k in ordered]
    values = [counts[k] for k in ordered]
    bar_colors = [_status_style(k)[1] for k in ordered]

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.8))
    fig.suptitle(f"{title}\n状态分布（n={len(rows)}）", fontsize=13, fontweight=600)

    # 饼图
    ax_pie = axes[0]
    wedges, texts, autotexts = ax_pie.pie(
        values,
        labels=labels_zh,
        colors=bar_colors,
        autopct=lambda pct: f"{pct:.0f}%\n({int(round(pct / 100.0 * len(rows)))})",
        startangle=90,
        pctdistance=0.65,
        wedgeprops={"linewidth": 0.8, "edgecolor": "#334155"},
    )
    for wedge, status in zip(wedges, ordered):
        wedge.set_hatch(_status_style(status)[3])
    for t in texts:
        t.set_fontsize(10)
    for t in autotexts:
        t.set_fontsize(9)
        t.set_color("#222222")
        t.set_bbox({"facecolor": "white", "edgecolor": "none", "alpha": 0.85, "pad": 2})
    ax_pie.set_title("占比", fontsize=11)

    # 条形图
    ax_bar = axes[1]
    bars = ax_bar.bar(labels_zh, values, color=bar_colors, width=0.55,
                      edgecolor="#334155", linewidth=0.6)
    for bar, status in zip(bars, ordered):
        bar.set_hatch(_status_style(status)[3])
    ax_bar.set_ylabel("次数")
    ax_bar.set_title("计数", fontsize=11)
    ax_bar.set_ylim(0, max(values) * 1.25 if values else 1)
    for bar, val in zip(bars, values):
        ax_bar.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.08,
            str(val),
            ha="center",
            va="bottom",
            fontsize=11,
            fontweight=600,
        )
    ax_bar.grid(True, axis="y", alpha=0.65)
    ax_bar.set_axisbelow(True)
    ax_bar.yaxis.set_major_locator(MaxNLocator(integer=True))

    fig.legend(handles=hatch_handles, loc="lower center", ncol=3, fontsize=9)
    fig.tight_layout(rect=(0, 0.12, 1, 1))
    p2 = out_dir / "status_breakdown.png"
    fig.savefig(p2, dpi=150, bbox_inches="tight")
    plt.close(fig)
    saved.append(p2)

    # ── 3) 时间线（每轮改动） ────────────────────────────────────
    fig_h = max(4.5, 0.55 * len(rows) + 1.5)
    fig, ax = plt.subplots(figsize=(12, fig_h))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, len(rows) + 1)
    ax.invert_yaxis()
    ax.axis("off")
    ax.set_title(f"{title}\n逐轮改动与评测状态", fontsize=13, fontweight=600, pad=12)

    for idx, (round_i, status, change, imp, lat) in enumerate(
        zip(rounds, statuses, changes, improvements, latencies), start=1
    ):
        y = idx
        label, color, marker, _ = _status_style(status)
        box = FancyBboxPatch(
            (0.3, y - 0.35),
            9.3,
            0.7,
            boxstyle="round,pad=0.02,rounding_size=0.15",
            linewidth=1.0,
            edgecolor=color,
            facecolor=color,
            alpha=0.12,
        )
        ax.add_patch(box)
        ax.plot(0.55, y, marker=marker, color=color, markersize=10)
        meta = []
        if lat is not None:
            meta.append(f"{lat:.4f} ms")
        else:
            meta.append("无有效延迟")
        if imp is not None:
            meta.append(f"本轮改进 {float(imp) * 100:+.2f}%")
        meta.append(f"{label}（{status}）")
        wrapped = textwrap.fill(change or "（未记录改动说明）", width=70)
        ax.text(0.85, y - 0.08, f"第 {round_i} 轮  {' · '.join(meta)}", fontsize=9, fontweight=600, va="center")
        ax.text(0.85, y + 0.22, wrapped, fontsize=8, color="#333333", va="center")

    fig.legend(handles=status_handles, loc="lower center", bbox_to_anchor=(0.5, 0.025), ncol=3, fontsize=9)
    fig.text(0.06, 0.01, "延迟与改进率均为本轮记录；最终收益须重新成对评测确认。",
             fontsize=9, color="#475569")
    fig.tight_layout(rect=(0, 0.12, 1, 1))
    p3 = out_dir / "process_timeline.png"
    fig.savefig(p3, dpi=150, bbox_inches="tight")
    plt.close(fig)
    saved.append(p3)

    return saved


def print_trajectory_table(rows: list[dict[str, Any]], threshold: float = 0.01) -> None:
    print("\n═══ 优化轨迹表 ═══")
    print(f"{'#':>3}  {'acc':^3}  {'status':<16}  {'lat(ms)':>10}  {'imp%':>8}  change")
    print("-" * 100)
    for i, row in enumerate(rows, 1):
        acc = "✓" if row.get("accepted") else "✗"
        status = _status_key(row)
        lat = row.get("latencyMs")
        imp = row.get("improvementFraction")
        lat_s = f"{lat:.4f}" if lat is not None else "-"
        imp_s = f"{float(imp) * 100:+.2f}" if imp is not None else "-"
        change = (row.get("change") or "")[:48]
        print(f"{i:>3}  {acc:^3}  {status:<16}  {lat_s:>10}  {imp_s:>8}  {change}")
    accepted = sum(1 for r in rows if r.get("accepted"))
    print("-" * 100)
    print(f"轮次={len(rows)}  接受={accepted}  阈值={threshold:.0%}")
