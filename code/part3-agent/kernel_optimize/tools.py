"""工具层：agent 的「手」。每个工具是一个小函数，输入输出都是字符串。

设计原则（自由度光谱）：
- **权威三件套**（对齐线上 chapter15）：``compile_kernel`` / ``bench_kernel`` / ``profile_kernel``
  返回结构化 JSON，是 ground truth——LLM 不能改规则、不能自报数字。
- **确定性晋升**：``accept_candidate`` 负责配对裁决、写 trajectory、更新 best.py。
- **自由工具**（ask_user / convert_kernel / run_code）是 LLM 的发挥空间。

工具用 ``ToolExecutor`` 按名注册（hello-agents 范式）：描述拼进提示词让模型「看见」，
函数本体留在字典里按名调用。
"""

from __future__ import annotations

import json
import math
import re
import statistics
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from prompt_toolkit import PromptSession
from prompt_toolkit.history import InMemoryHistory
from prompt_toolkit.key_binding import KeyBindings

from . import llm

# ---------------------------------------------------------------------------
# ToolExecutor：按名注册工具（描述给模型看，函数按名调用）
# ---------------------------------------------------------------------------


class ToolExecutor:
    def __init__(self, log_path: Path | None = None) -> None:
        self.tools: dict[str, dict[str, Any]] = {}
        self.log_path = log_path

    def register(self, name: str, description: str, func: Callable[..., str],
                 parameters: dict[str, Any] | None = None) -> None:
        self.tools[name] = {
            "description": description,
            "func": func,
            "parameters": parameters or {"type": "object", "properties": {}},
        }

    def call(self, name: str, arguments: dict[str, Any]) -> str:
        started_at = datetime.now(timezone.utc).isoformat()
        tool = self.tools.get(name)
        if tool is None:
            observation = f"✗ 未知工具：{name}。可用工具：{', '.join(self.tools)}"
        else:
            try:
                observation = str(tool["func"](**arguments))
            except Exception as error:  # noqa: BLE001
                observation = f"✗ 工具 {name} 执行出错：{error}"
        if self.log_path is not None:
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({
                    "startedAt": started_at,
                    "finishedAt": datetime.now(timezone.utc).isoformat(),
                    "name": name,
                    "arguments": arguments,
                    "observation": observation,
                }, ensure_ascii=False) + "\n")
        return observation

    def schema(self) -> list[dict[str, Any]]:
        """拼成 LiteLLM function-calling 的 tools 参数。"""
        return [
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": info["description"],
                    "parameters": info["parameters"],
                },
            }
            for name, info in self.tools.items()
        ]


# ---------------------------------------------------------------------------
# Workspace：agent 的工作目录（task.json + reference.py + best.py + 轨迹）
# ---------------------------------------------------------------------------

_PART_ROOT = Path(__file__).resolve().parent.parent
_CHAPTER14 = _PART_ROOT / "chapter14"
_SKILL_DIR = _PART_ROOT / "skills" / "rocm-kernel-optimize"


def _evaluator() -> Callable[..., dict[str, Any]]:
    """懒加载 chapter14 的 evaluate()（权威评测后端，不重写）。"""
    if str(_CHAPTER14) not in sys.path:
        sys.path.insert(0, str(_CHAPTER14))
    from evaluate import evaluate  # type: ignore[import-not-found]

    return evaluate


class Workspace:
    """一个优化任务的工作目录。

    存放 task.json（v2 任务合同）、reference.py（PyTorch 正确性裁判）、
    best.py（当前最优实现）与 trajectory.jsonl（每轮轨迹，含失败）。
    """

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.last_evaluation: Path | None = None

    @property
    def task_path(self) -> Path:
        return self.root / "task.json"

    @property
    def reference_path(self) -> Path:
        return self.root / "reference.py"

    @property
    def best_path(self) -> Path:
        return self.root / "best.py"

    def task(self) -> dict[str, Any]:
        return json.loads(self.task_path.read_text(encoding="utf-8"))

    def write_candidate(self, source: str) -> Path:
        """把候选源码写到临时文件，返回路径（供 evaluator 执行）。"""
        fd = tempfile.NamedTemporaryFile(
            "w", suffix=".py", delete=False, encoding="utf-8", dir=self.root
        )
        fd.write(source if source.endswith("\n") else source + "\n")
        fd.close()
        return Path(fd.name)

    def record(self, entry: dict[str, Any]) -> None:
        """把一轮轨迹追加到 trajectory.jsonl（失败也记——失败比成功更值钱）。"""
        with (self.root / "trajectory.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# 权威工具：裹住 chapter14 evaluator（正确性 / 计时 / 裁决）
# ---------------------------------------------------------------------------


def _run_eval(workspace: Workspace, source: str, *, incumbent: Path | None,
              correctness_only: bool = False) -> dict[str, Any]:
    # 每次评测冻结一份输入。后续更新 best.py，不会覆盖此次配对的 incumbent。
    evaluations = workspace.root / "evaluations"
    evaluations.mkdir(exist_ok=True)
    index = 1
    while True:
        artifact = evaluations / f"evaluation-{index:04d}"
        try:
            artifact.mkdir()
            break
        except FileExistsError:
            index += 1
    workspace.last_evaluation = artifact
    candidate = artifact / "candidate.py"
    candidate.write_text(source if source.endswith("\n") else source + "\n", encoding="utf-8")
    task = artifact / "task.json"
    task.write_bytes(workspace.task_path.read_bytes())
    reference = artifact / "reference.py"
    if workspace.reference_path.is_file():
        reference.write_bytes(workspace.reference_path.read_bytes())
    paired_source = None
    if incumbent is not None:
        paired_source = artifact / "incumbent.py"
        paired_source.write_bytes(incumbent.read_bytes())
    request = {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "candidate": "candidate.py",
        "task": "task.json",
        "reference": "reference.py",
        "incumbent": "incumbent.py" if paired_source is not None else None,
        "correctnessOnly": correctness_only,
    }
    (artifact / "request.json").write_text(
        json.dumps(request, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    try:
        evaluation = _evaluator()(
            task,
            candidate,
            incumbent_path=paired_source,
            reference_path=reference,
            correctness_only=correctness_only,
        )
    except Exception as error:
        (artifact / "result.json").write_text(
            json.dumps({"status": "evaluation_error", "details": str(error)},
                       ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
        )
        raise
    (artifact / "result.json").write_text(
        json.dumps(evaluation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )
    return evaluation


def _parse_compile_errors(text: str) -> list[dict[str, Any]]:
    """从编译/运行捕获输出里尽量抽出 {line, msg} 列表。"""
    errors: list[dict[str, Any]] = []
    if not text:
        return errors
    patterns = (
        re.compile(r"(?:File \".*?\", line |:)(\d+)(?::\d+)?(?::\s*|\s+)(.+)"),
        re.compile(r"line\s+(\d+)\s*[:：]\s*(.+)", re.IGNORECASE),
        re.compile(r"^(\d+)\s*\|\s*(.+)$"),
    )
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        matched = False
        for pattern in patterns:
            hit = pattern.search(line)
            if not hit:
                continue
            try:
                lineno = int(hit.group(1))
            except ValueError:
                continue
            msg = hit.group(2).strip()
            if msg:
                errors.append({"line": lineno, "msg": msg[:500]})
                matched = True
                break
        if not matched and any(
            key in line.lower() for key in ("error", "traceback", "exception", "failed")
        ):
            errors.append({"line": None, "msg": line[:500]})
    # 去重保序
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in errors:
        key = f"{item.get('line')}:{item.get('msg')}"
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique[:40]


def _compile_payload(evaluation: dict[str, Any]) -> dict[str, Any]:
    status = evaluation.get("status")
    details = str(evaluation.get("details") or "")
    captured = str(evaluation.get("capturedOutput") or "")
    blob = f"{details}\n{captured}".strip()
    if status == "ok":
        return {"ok": True, "stage": "run", "errors": [], "warnings": []}
    if status == "compile_error":
        errors = _parse_compile_errors(blob) or [{"line": None, "msg": details or "compile_error"}]
        return {"ok": False, "stage": "compile", "errors": errors, "warnings": []}
    if status == "wrong_answer":
        return {
            "ok": False,
            "stage": "run",
            "errors": [{"line": None, "msg": details or "wrong_answer"}],
            "warnings": [],
        }
    return {
        "ok": False,
        "stage": "run",
        "errors": [{"line": None, "msg": details or str(status)}],
        "warnings": [],
    }


def _percentile(sorted_vals: list[float], pct: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = (len(sorted_vals) - 1) * pct
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return sorted_vals[low]
    weight = rank - low
    return sorted_vals[low] * (1 - weight) + sorted_vals[high] * weight


def _bench_payload(workspace: Workspace, evaluation: dict[str, Any]) -> dict[str, Any]:
    if evaluation.get("status") != "ok":
        return {
            "ok": False,
            "status": evaluation.get("status"),
            "details": evaluation.get("details"),
            "mean_ms": None,
            "median_ms": None,
            "p95_ms": None,
            "std_ms": None,
            "bandwidth_gbps": None,
            "tflops": None,
        }
    bench = evaluation.get("benchmark") or {}
    samples = [float(x) for x in bench.get("samplesMs") or [] if isinstance(x, (int, float))]
    median = evaluation.get("latencyMs")
    if median is None and samples:
        median = statistics.median(samples)
    mean = statistics.mean(samples) if samples else median
    std = statistics.pstdev(samples) if len(samples) >= 2 else 0.0
    p95 = _percentile(sorted(samples), 0.95) if samples else median

    bandwidth_gbps = None
    tflops = None
    try:
        cost = workspace.task().get("costModel") or {}
        flops = cost.get("flops")
        bytes_ = cost.get("bytes")
        if isinstance(median, (int, float)) and median > 0:
            seconds = median / 1000.0
            if isinstance(bytes_, int) and bytes_ > 0:
                bandwidth_gbps = (bytes_ / seconds) / 1e9
            if isinstance(flops, int) and flops > 0:
                tflops = (flops / seconds) / 1e12
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        pass

    return {
        "ok": True,
        "status": "ok",
        "mean_ms": mean,
        "median_ms": median,
        "p95_ms": p95,
        "std_ms": std,
        "bandwidth_gbps": bandwidth_gbps,
        "tflops": tflops,
    }


def _decide(evaluation: dict[str, Any], threshold: float) -> tuple[bool, str]:
    """确定性裁决：正确 且 配对改进的中位数 ≥ 阈值 且 多数配对样本为正，才接受。

    用「中位数改进」而非「最差配对」对比阈值：kernel 很快时（如 0.05ms），测量噪声
    （MAD）相对占比大，最差配对样本极易被噪声拉到阈值以下，导致真实加速被误拒。
    中位数对个别噪声样本稳健；再要求多数配对为正，避免靠少数幸运样本蒙混。
    """
    if evaluation.get("status") != "ok":
        return False, evaluation.get("status", "not_ok")
    comparison = evaluation.get("comparison")
    if not comparison:
        return False, "missing_paired_comparison"
    pairs = [p for p in comparison.get("pairedImprovements", []) if isinstance(p, (int, float))]
    if len(pairs) < 5:
        return False, "insufficient_benchmark_evidence"
    improvement = comparison.get("improvementFraction", 0.0)  # 配对改进的中位数
    worst = min(pairs)
    positive_ratio = sum(1 for p in pairs if p > 0) / len(pairs)
    if improvement < threshold:
        return False, (
            f"below_threshold（中位改进 {improvement:.4f} < 阈值 {threshold}；"
            f"最差配对 {worst:.4f}）"
        )
    if positive_ratio < 0.6:
        return False, (
            f"unstable（仅 {positive_ratio:.0%} 配对样本为正，中位改进 {improvement:.4f}；"
            f"改进可能被噪声主导）"
        )
    return True, (
        f"improved（中位改进 {improvement:.4f}，{positive_ratio:.0%} 配对为正，"
        f"最差配对 {worst:.4f}）"
    )


# ---------------------------------------------------------------------------
# 多行输入：用 prompt_toolkit 让用户可靠地粘贴多行代码（不会漏行给 shell）
# ---------------------------------------------------------------------------


def _make_ask_session() -> PromptSession:
    """多行输入会话：多行代码直接粘贴，回车提交（无需 /paste、/end、Esc+Enter）。

    依赖终端的 bracketed paste（现代终端默认支持，prompt_toolkit 自动启用）：
    粘贴的多行内容会**整段**进入输入缓冲、不触发回车；用户粘贴/输入完按一次回车即提交。
    所以回车键设为「始终提交」——单行回答、多行粘贴，都是完成后按回车。
    """
    bindings = KeyBindings()

    @bindings.add("enter")
    def _on_enter(event: Any) -> None:
        event.current_buffer.validate_and_handle()  # 回车始终提交（多行靠粘贴输入）

    return PromptSession(multiline=True, key_bindings=bindings, history=InMemoryHistory())


_ASK_SESSION: PromptSession | None = None


def _get_ask_session() -> PromptSession:
    global _ASK_SESSION
    if _ASK_SESSION is None:
        _ASK_SESSION = _make_ask_session()
    return _ASK_SESSION


# ---------------------------------------------------------------------------
# build_tools：注册全部工具，返回 (ToolExecutor, tools_schema)
# ---------------------------------------------------------------------------


def build_tools(
    workspace: Workspace,
    *,
    batch: bool = False,
) -> tuple[ToolExecutor, list[dict[str, Any]]]:
    executor = ToolExecutor(workspace.root / "tool-calls.jsonl")

    # --- 多轮对话（prompt_toolkit 多行，可靠接收粘贴）---------------------
    def ask_user(question: str) -> str:
        if batch:
            return (
                "【非交互模式】无法回答用户问题。请不要再调用 ask_user，"
                "直接基于工作区已有的 task.json / reference.py / best.py 继续优化闭环。"
                f"（你刚才问的是：{question[:200]}）"
            )
        print(f"\n\033[36m[agent 提问]\033[0m {question}")
        print("\033[90m（多行代码直接粘贴即可；输入/粘贴完成后按回车提交。）\033[0m")
        try:
            text = _get_ask_session().prompt("你的回答 > ")
        except (EOFError, KeyboardInterrupt):
            return "（用户未回答）"
        except Exception:  # noqa: BLE001  无 TTY 等环境 → 退回简单 input
            try:
                text = input("你的回答 > ")
            except (EOFError, KeyboardInterrupt):
                return "（用户未回答）"
        return text.strip() or "（无回答）"

    executor.register(
        "ask_user",
        "向用户提问并等待回答。用于：缺少参数（如目标 size）、确认设备、"
        "询问是否把 kernel 转换成当前设备可执行的语言等。多轮对话靠它。",
        ask_user,
        {"type": "object", "properties": {"question": {"type": "string"}}, "required": ["question"]},
    )

    # --- 环境探测 ---------------------------------------------------------
    def get_environment() -> str:
        try:
            import torch

            cuda = torch.cuda.is_available()
            name = torch.cuda.get_device_name(0) if cuda else "无 GPU"
            arch = ""
            if cuda:
                arch = str(getattr(torch.cuda.get_device_properties(0), "gcnArchName", "")).split(":", 1)[0]
            rocm = str(getattr(torch.version, "hip", "") or "")
            return json.dumps(
                {"device": name, "gpu_arch": arch, "rocm": rocm, "torch": torch.__version__},
                ensure_ascii=False,
            )
        except ImportError:
            return json.dumps({"device": "unknown", "error": "torch 未安装"}, ensure_ascii=False)

    executor.register(
        "get_environment",
        "探测当前 GPU/ROCm/torch 环境，返回 JSON。判断 kernel 语言是否匹配设备时用。",
        get_environment,
    )

    # --- 硬件峰值测量（权威，缓存）----------------------------------------
    def measure_peak() -> str:
        from .measure import ensure_peak

        profile = ensure_peak(workspace.root)
        if profile is None:
            return "✗ 未能测量硬件峰值（无 GPU 或未就绪）。Roofline 方向将跳过。"
        return json.dumps(
            {
                "name": profile.get("name"),
                "bandwidth_gb_s": profile.get("bandwidthGbS"),
                "fp32_tflops": profile.get("fp32Tflops"),
                "fp16_tflops": profile.get("fp16Tflops"),
            },
            ensure_ascii=False,
        )

    executor.register(
        "measure_peak",
        "实测本机硬件峰值（带宽 GB/s + fp32/fp16 TFLOPS），按设备缓存。"
        "用于 Roofline 分析、判断优化方向。结果权威。",
        measure_peak,
    )

    # --- compile_kernel（对齐线上 chapter15）-------------------------------
    def compile_kernel(source: str, arch: str = "") -> str:
        del arch  # 当前 evaluator 按本机 ROCm/Triton 编译；保留参数以对齐 schema
        evaluation = _run_eval(workspace, source, incumbent=None, correctness_only=True)
        return json.dumps(_compile_payload(evaluation), ensure_ascii=False)

    executor.register(
        "compile_kernel",
        "编译并对 reference 做正确性自检（对齐线上 compile_kernel）。"
        "返回 JSON：ok/stage/errors[{line,msg}]/warnings。"
        "compile 失败看 stage=compile；数值不对看 stage=run。结果权威。",
        compile_kernel,
        {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "kernel 源码"},
                "arch": {"type": "string", "description": "目标架构，可选（如 gfx1151）"},
            },
            "required": ["source"],
        },
    )

    # --- bench_kernel（对齐线上 chapter15）--------------------------------
    def bench_kernel(source: str, repeats: int = 0) -> str:
        del repeats  # 次数由 task.json benchmark 合同决定；保留参数对齐线上接口
        evaluation = _run_eval(workspace, source, incumbent=None)
        return json.dumps(_bench_payload(workspace, evaluation), ensure_ascii=False)

    executor.register(
        "bench_kernel",
        "可信计时（warmup + GPU event + median/MAD）。返回 JSON："
        "mean_ms/median_ms/p95_ms/std_ms/bandwidth_gbps/tflops。"
        "编译或正确性失败时 ok=false 且无性能数字。结果权威。",
        bench_kernel,
        {
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "repeats": {"type": "integer", "description": "可选；默认用 task.json 合同"},
            },
            "required": ["source"],
        },
    )

    # --- profile_kernel（对齐线上 chapter15）------------------------------
    def profile_kernel(source: str) -> str:
        from .measure import profile_kernel_payload

        return json.dumps(profile_kernel_payload(workspace, source), ensure_ascii=False)

    executor.register(
        "profile_kernel",
        "对 kernel 做 profiling，返回瓶颈信号 JSON："
        "bottleneck / bandwidth_utilization_pct / sm_saturation_pct / ai / bound 等。"
        "优先 rocprof，缺条件用 Roofline。结果权威。",
        profile_kernel,
        {"type": "object", "properties": {"source": {"type": "string"}}, "required": ["source"]},
    )

    # --- accept_candidate：唯一晋升入口（写轨迹 / 更新 best）--------------
    def accept_candidate(source: str, change: str = "") -> str:
        task = workspace.task()
        threshold = task.get("optimization", {}).get("minImprovementFraction", 0.01)
        incumbent = workspace.best_path if workspace.best_path.exists() else None
        evaluation = _run_eval(workspace, source, incumbent=incumbent)
        if incumbent is None and evaluation.get("status") == "ok":
            accepted, reason = True, "baseline"
        else:
            accepted, reason = _decide(evaluation, threshold)
        entry = {
            "change": change,
            "status": evaluation.get("status"),
            "latencyMs": evaluation.get("latencyMs"),
            "accepted": accepted,
            "reason": reason,
        }
        if workspace.last_evaluation is not None:
            entry["evaluation"] = str(workspace.last_evaluation.relative_to(workspace.root))
        comparison = evaluation.get("comparison")
        if comparison:
            entry["improvementFraction"] = comparison.get("improvementFraction")
        workspace.record(entry)
        if accepted:
            workspace.best_path.write_text(
                source if source.endswith("\n") else source + "\n",
                encoding="utf-8",
            )
        return json.dumps(
            {
                "accepted": accepted,
                "reason": reason,
                "status": evaluation.get("status"),
                "latencyMs": evaluation.get("latencyMs"),
                "improvementFraction": entry.get("improvementFraction"),
                "details": evaluation.get("details"),
            },
            ensure_ascii=False,
        )

    executor.register(
        "accept_candidate",
        "确定性晋升：与当前 best 配对计时比较，按阈值接受/拒绝；"
        "无论成败写入 trajectory.jsonl；仅接受时更新 best.py。"
        "这是唯一能晋升候选的入口——不要用 run_code 改 best。"
        "change 用一句话说明本轮改了什么。结果权威。",
        accept_candidate,
        {
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "change": {"type": "string"},
            },
            "required": ["source"],
        },
    )

    # --- 语言转换（LLM 自由发挥）------------------------------------------
    def convert_kernel(source: str, to_language: str) -> str:
        prompt = (
            f"把下面这段 kernel 转换成等价的可执行 {to_language} 实现，"
            "保持数学语义和入口签名不变，只输出完整源码，不要解释、不要 markdown 围栏。\n\n"
            f"{source}"
        )
        message = llm.chat([{"role": "user", "content": prompt}], temperature=0.0)
        return (message.content or "").strip()

    executor.register(
        "convert_kernel",
        "把一段 kernel 翻译成目标语言（如 CUDA→Triton/HIP）的等价实现。"
        "转换后务必用 compile_kernel 校验正确性。",
        convert_kernel,
        {
            "type": "object",
            "properties": {"source": {"type": "string"}, "to_language": {"type": "string"}},
            "required": ["source", "to_language"],
        },
    )

    # --- 自由写代码（沙箱）------------------------------------------------
    def run_code(code: str) -> str:
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as fd:
            fd.write(code)
            path = fd.name
        try:
            result = subprocess.run(
                [sys.executable, path],
                capture_output=True,
                text=True,
                timeout=120,
                cwd=str(workspace.root),
            )
            out = (result.stdout or "")[-3000:]
            err = (result.stderr or "")[-1500:]
            return f"exit={result.returncode}\nstdout:\n{out}\nstderr:\n{err}"
        except subprocess.TimeoutExpired:
            return "✗ 代码执行超时（>120s）"
        finally:
            Path(path).unlink(missing_ok=True)

    executor.register(
        "run_code",
        "在沙箱子进程里执行一段 Python 代码（120s 超时），返回 stdout/stderr。"
        "用于自己写测量脚本、复现问题或修复。性能结论仍只认 bench_kernel / accept_candidate。",
        run_code,
        {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]},
    )

    # --- 读参考资料（Skill 渐进式披露）------------------------------------
    def read_reference(name: str) -> str:
        path = _SKILL_DIR / "references" / f"{name}.md"
        if not path.is_file():
            available = [p.stem for p in (_SKILL_DIR / "references").glob("*.md")] if (_SKILL_DIR / "references").is_dir() else []
            return f"✗ 没有参考资料 {name}。可用：{', '.join(available)}"
        return path.read_text(encoding="utf-8")

    executor.register(
        "read_reference",
        "按需读一份参考资料（如 hardware-aimax395 硬件规格、optimization-patterns 优化套路库）。"
        "name 不带 .md 后缀。",
        read_reference,
        {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
    )

    # --- 建立任务（从用户给的原始 kernel）--------------------------------
    def setup_task(kernel_source: str, description: str, rows: int, cols: int,
                   dtype: str = "float32") -> str:
        from .intake import setup_task as _setup

        return _setup(workspace, kernel_source, description, int(rows), int(cols), dtype)

    executor.register(
        "setup_task",
        "从用户给的原始 kernel 建立优化任务：自动生成 reference.py（PyTorch 正确性裁判）"
        "和 task.json（合同），并用 evaluator 自检 baseline（失败会自动重试）。"
        "需要：kernel 源码、算子描述、目标 rows、cols、dtype。"
        "这是把『用户粘贴的 kernel』变成可优化任务的入口；建好后就能跑优化闭环。",
        setup_task,
        {
            "type": "object",
            "properties": {
                "kernel_source": {"type": "string"},
                "description": {"type": "string"},
                "rows": {"type": "integer"},
                "cols": {"type": "integer"},
                "dtype": {"type": "string"},
            },
            "required": ["kernel_source", "description", "rows", "cols"],
        },
    )

    return executor, executor.schema()
