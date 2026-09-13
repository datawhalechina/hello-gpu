import importlib.util
import hashlib
import io
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


CHAPTER_DIR = Path(__file__).resolve().parent
if str(CHAPTER_DIR) not in sys.path:
    sys.path.insert(0, str(CHAPTER_DIR))

from evaluate import MAX_CAPTURE_BYTES, _drain_bounded, evaluate
from source_policy import validate_candidate, validate_reference
from task_spec import load_task


FIXTURES = CHAPTER_DIR.parent / "chapter15" / "fixtures" / "vector_add"


class FakeTensor:
    pass


def _load_worker_with_stubs():
    fake_torch = types.ModuleType("torch")
    fake_torch.Tensor = FakeTensor
    fake_triton = types.ModuleType("triton")
    fake_triton.__version__ = "test"
    module_name = "chapter14_worker_cpu_test"
    module_spec = importlib.util.spec_from_file_location(
        module_name, CHAPTER_DIR / "worker.py"
    )
    assert module_spec is not None and module_spec.loader is not None
    module = importlib.util.module_from_spec(module_spec)
    with mock.patch.dict(
        sys.modules,
        {module_name: module, "torch": fake_torch, "triton": fake_triton},
    ):
        module_spec.loader.exec_module(module)
    return module


WORKER = _load_worker_with_stubs()


def _base_payload(*, with_cost_model: bool = False) -> dict:
    payload = json.loads((FIXTURES / "task.json").read_text(encoding="utf-8"))
    # Most tests change the ABI or shapes; the original vector-add traffic
    # budget no longer describes those contracts. Cost-model tests opt in.
    if not with_cost_model:
        payload.pop("costModel", None)
    return payload


def _load_payload(payload: dict):
    with tempfile.TemporaryDirectory() as temporary_dir:
        path = Path(temporary_dir) / "task.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return load_task(path)


class DeclarativeSchemaTest(unittest.TestCase):
    def test_explicit_cost_model_round_trips_through_task_schema(self) -> None:
        payload = _base_payload()
        payload["costModel"] = {
            "flops": 8_388_608,
            "bytes": 50_331_648,
            "label": "one add per element",
        }
        task = _load_payload(payload)
        self.assertEqual(task.cost_model.flops, 8_388_608)
        self.assertEqual(task.cost_model.bytes, 50_331_648)

        payload["costModel"]["bytes"] -= 1
        with self.assertRaisesRegex(ValueError, "logical input/output traffic"):
            _load_payload(payload)

    def test_dimensions_scalar_expressions_and_return(self) -> None:
        payload = _base_payload()
        payload["shape"] = {"rows": 3, "cols": 5}
        payload["dimensions"] = {"rows": 3, "cols": 5, "M": 3}
        payload["reference"]["selfCheckPassed"] = False
        payload["tensors"] = [
            {"name": "returned", "kind": "return", "dtype": "float32", "shape": ["M"]},
            {"name": "x", "kind": "input", "dtype": "float16", "shape": ["rows", "cols"]},
            {"name": "out", "kind": "output", "dtype": "float32", "shape": ["rows", "cols"]},
            {"name": "m", "kind": "scalar", "expression": {"op": "dimension", "name": "M"}},
            {"name": "n", "kind": "scalar", "expression": {"op": "numel", "tensor": "x"}},
            {"name": "stride", "kind": "scalar", "expression": {"op": "stride", "tensor": "x", "axis": 0}},
        ]
        payload["launchArguments"] = ["stride", "x", "out", "m", "n"]
        task = _load_payload(payload)
        self.assertEqual(task.dimensions["M"], 3)
        self.assertEqual(task.tensors[0].kind, "return")
        self.assertEqual(task.tensors[1].shape, (3, 5))
        self.assertEqual(task.tensors[-1].expression.op, "stride")

    def test_rejects_unknown_or_non_positive_shape_dimension(self) -> None:
        for bad_shape in (["missing"], [True], [0], [2.5]):
            with self.subTest(shape=bad_shape):
                payload = _base_payload()
                payload["tensors"][0]["shape"] = bad_shape
                with self.assertRaises(ValueError):
                    _load_payload(payload)

    def test_active_contract_rejects_unused_target_shape(self) -> None:
        payload = _base_payload()
        payload["dimensions"] = {"rows": 4096, "cols": 2048, "small": 128}
        payload["reference"]["selfCheckPassed"] = False
        for tensor in payload["tensors"]:
            if tensor["kind"] != "scalar":
                tensor["shape"] = ["small", "small"]
        with self.assertRaisesRegex(ValueError, "unused"):
            _load_payload(payload)

    def test_active_contract_rejects_unused_or_literal_extra_dimensions(self) -> None:
        unused = _base_payload()
        unused["dimensions"] = {"rows": 4096, "cols": 2048, "K": 2048}
        with self.assertRaisesRegex(ValueError, "unused=.*K"):
            _load_payload(unused)

        literal = _base_payload()
        literal["dimensions"] = {"rows": 4096, "cols": 2048, "K": 2048}
        literal["tensors"][0]["shape"] = ["rows", 128]
        with self.assertRaisesRegex(ValueError, "literal extents"):
            _load_payload(literal)

    def test_launch_arguments_are_unique_exact_and_exclude_returns(self) -> None:
        payload = _base_payload()
        payload["tensors"].append(
            {"name": "returned", "kind": "return", "dtype": "float16", "shape": "input"}
        )
        for launch_arguments in (
            ["x", "y", "output", "n_elements", "x"],
            ["x", "y", "output"],
            ["x", "y", "output", "n_elements", "returned"],
        ):
            with self.subTest(arguments=launch_arguments):
                payload["launchArguments"] = launch_arguments
                with self.assertRaises(ValueError):
                    _load_payload(payload)

    def test_rejects_unvalidated_entrypoint_and_distribution(self) -> None:
        payload = _base_payload()
        payload["entrypoint"] = "bad-name"
        with self.assertRaisesRegex(ValueError, "entrypoint"):
            _load_payload(payload)
        payload = _base_payload()
        payload["input"]["distribution"] = "python-expression"
        with self.assertRaisesRegex(ValueError, "distribution"):
            _load_payload(payload)

    def test_active_integer_input_requires_and_resolves_initializer(self) -> None:
        payload = _base_payload()
        payload["dimensions"] = {"rows": 4096, "cols": 2048}
        payload["reference"]["selfCheckPassed"] = False
        payload["tensors"][0]["dtype"] = "int32"
        with self.assertRaisesRegex(ValueError, "explicit initializer"):
            _load_payload(payload)

        payload["tensors"][0]["initializer"] = {
            "kind": "integer",
            "low": 0,
            "high": "cols",
        }
        task = _load_payload(payload)
        initializer = task.tensors[0].initializer
        self.assertEqual(initializer.kind, "integer")
        self.assertEqual((initializer.low, initializer.high), (0, 2048))


class BindingAndOutputTest(unittest.TestCase):
    def test_return_allocation_guard_enforces_declared_budget(self) -> None:
        guard = WORKER._GuardedTorch(4)
        guard._charge(1, "torch.float32")
        with self.assertRaisesRegex(RuntimeError, "declared return-tensor budget"):
            guard._charge(1, "torch.float32")
        fresh_guard = WORKER._GuardedTorch(4)
        with (
            mock.patch.object(
                WORKER.torch,
                "get_default_dtype",
                return_value="torch.float32",
                create=True,
            ),
            self.assertRaisesRegex(RuntimeError, "declared return-tensor budget"),
        ):
            fresh_guard.empty(size=(2,))
        self.assertEqual(
            WORKER._GuardedReferenceTorch._arange_length(end=8), 8
        )

    def test_return_abi_claims_only_prepared_contract_buffers(self) -> None:
        spec = types.SimpleNamespace(shape=(2,), dtype="int32")
        buffer = types.SimpleNamespace(shape=(2,), dtype="torch.int32")
        guard = WORKER._GuardedTorch(8, return_specs=(spec,))
        guard._return_buffers = [buffer]
        guard.reset()
        self.assertIs(
            guard.empty((2,), dtype="torch.int32"),
            buffer,
        )
        guard.finish_return_allocations()

        guard.reset()
        with self.assertRaisesRegex(RuntimeError, "did not allocate"):
            guard.finish_return_allocations()

        guard.reset()
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            guard.empty((1,), dtype="torch.int32")

    def test_integral_reference_must_be_stable_across_poison_generations(self) -> None:
        task = types.SimpleNamespace(
            tensors=(types.SimpleNamespace(kind="output", dtype="int32"),)
        )
        with (
            mock.patch.object(
                WORKER,
                "_run_reference_once",
                side_effect=[("poison-max",), ("poison-min",)],
            ) as run_once,
            mock.patch.object(WORKER.torch, "equal", return_value=False, create=True),
            self.assertRaisesRegex(WORKER.LaunchValidationError, "not fully written"),
        ):
            WORKER._build_oracle(lambda *args: None, task, 17)
        self.assertEqual(run_once.call_count, 2)

    def test_integer_outputs_use_exact_comparison(self) -> None:
        class ContractTensor(FakeTensor):
            shape = (1,)
            dtype = "int64"
            device = "cuda:0"

            def __init__(self, value):
                self.value = value

            def is_contiguous(self):
                return True

            def is_floating_point(self):
                return False

        tensor_spec = types.SimpleNamespace(
            name="returned", kind="return", shape=(1,), dtype="int64"
        )
        task = types.SimpleNamespace(
            tensors=(tensor_spec,),
            correctness=types.SimpleNamespace(atol=1.0, rtol=1.0),
        )
        case = WORKER._V2Case(values={}, input_snapshots={}, device="cuda:0")
        output = ContractTensor(10**12 + 1)
        oracle = ContractTensor(10**12)
        with (
            mock.patch.object(WORKER.torch, "int64", "int64", create=True),
            mock.patch.object(
                WORKER.torch,
                "equal",
                side_effect=lambda left, right: left.value == right.value,
                create=True,
            ),
        ):
            result = WORKER._validate_outputs(
                case, (output,), (oracle,), task, 17, "candidate"
            )
        self.assertFalse(result["passed"])
        self.assertIn("differs exactly", result["reason"])
        self.assertIsNone(result["maxAbsError"])

    def test_output_contract_requires_contiguous_layout(self) -> None:
        class NonContiguousTensor(FakeTensor):
            shape = (2, 2)
            dtype = "float16"
            device = "cuda:0"

            def is_contiguous(self):
                return False

            def stride(self):
                return (1, 2)

        spec = types.SimpleNamespace(name="out", shape=(2, 2), dtype="float16")
        with mock.patch.object(WORKER.torch, "float16", "float16", create=True):
            error = WORKER._tensor_contract_error(
                NonContiguousTensor(), spec, "cuda:0", "candidate"
            )
        self.assertIn("contiguous", error)

    def test_integral_poison_changes_between_repeated_launches(self) -> None:
        integer_values = [
            WORKER._integral_poison_value(
                generation,
                minimum=-8,
                maximum=7,
                is_bool=False,
            )
            for generation in range(3)
        ]
        boolean_values = [
            WORKER._integral_poison_value(
                generation,
                minimum=0,
                maximum=1,
                is_bool=True,
            )
            for generation in range(2)
        ]
        self.assertEqual(integer_values, [7, -8, 0])
        self.assertEqual(boolean_values, [True, False])

    def test_binds_values_by_launch_argument_name(self) -> None:
        task = _load_payload(_base_payload())
        case = WORKER._V2Case(
            values={"output": "out", "n_elements": 7, "y": "Y", "x": "X"},
            input_snapshots={},
            device="cuda:0",
        )
        self.assertEqual(
            WORKER._bind_launch_arguments(case, task), ("X", "Y", "out", 7)
        )

    def test_collects_output_arguments_and_multiple_returns_in_contract_order(self) -> None:
        payload = _base_payload()
        payload["tensors"] = [
            {"name": "first", "kind": "return", "dtype": "float16", "shape": "input"},
            {"name": "x", "kind": "input", "dtype": "float16", "shape": "input"},
            {"name": "out", "kind": "output", "dtype": "float16", "shape": "input"},
            {"name": "n", "kind": "scalar", "value": 8},
            {"name": "last", "kind": "return", "dtype": "float16", "shape": "input"},
        ]
        payload["launchArguments"] = ["n", "out", "x"]
        task = _load_payload(payload)
        out, first, last = FakeTensor(), FakeTensor(), FakeTensor()
        case = WORKER._V2Case(
            values={"x": FakeTensor(), "out": out, "n": 8},
            input_snapshots={},
            device="cuda:0",
        )
        outputs = WORKER._collect_candidate_outputs(
            case, task, (first, last), "candidate"
        )
        self.assertEqual(outputs, (first, out, last))
        with self.assertRaises(WORKER.OutputContractError):
            WORKER._collect_candidate_outputs(case, task, first, "candidate")


class PolicyAndBoundaryTest(unittest.TestCase):
    def test_worker_output_capture_is_bounded(self) -> None:
        captured = bytearray()
        _drain_bounded(io.BytesIO(b"a" * (MAX_CAPTURE_BYTES * 3)), captured)
        self.assertEqual(len(captured), MAX_CAPTURE_BYTES)

    def test_v2_candidate_and_reference_policies(self) -> None:
        task = load_task(FIXTURES / "task.json")
        self.assertEqual(
            validate_candidate(
                FIXTURES / "baseline.py",
                50_000,
                expected_launch_args=task.launch_arguments,
                entrypoint=task.entrypoint,
                allow_torch=True,
            ),
            [],
        )

    def test_host_policy_allows_pure_grid_lambda_only(self) -> None:
        allowed = """\
import triton
import triton.language as tl

@triton.jit
def _kernel(x, output, n, BLOCK: tl.constexpr):
    pass

def launch(x, output, n):
    grid = lambda meta: (triton.cdiv(n, meta["BLOCK"]),)
    _kernel[grid](x, output, n, BLOCK=256)
"""
        rejected = allowed.replace(
            "import triton\n",
            "import torch\nimport triton\n",
        ).replace(
            'lambda meta: (triton.cdiv(n, meta["BLOCK"]),)',
            "lambda meta: (torch.empty_like(x),)",
        )
        with tempfile.TemporaryDirectory() as temporary_dir:
            allowed_path = Path(temporary_dir) / "allowed.py"
            rejected_path = Path(temporary_dir) / "rejected.py"
            allowed_path.write_text(allowed, encoding="utf-8")
            rejected_path.write_text(rejected, encoding="utf-8")
            kwargs = {
                "max_source_chars": 50_000,
                "expected_launch_args": ("x", "output", "n"),
                "entrypoint": "launch",
                "allow_torch": True,
                "tensor_arguments": ("x", "output"),
            }
            self.assertEqual(validate_candidate(allowed_path, **kwargs), [])
            self.assertTrue(validate_candidate(rejected_path, **kwargs))

    def test_host_policy_rejects_framework_tensor_math_and_dead_dispatch(self) -> None:
        task = load_task(FIXTURES / "task.json")
        sources = {
            "tensor_math": """\
import triton
import triton.language as tl

@triton.jit
def _kernel(x, y):
    pass

def launch(x, y):
    result = x + y
    _kernel[(1,)](x, y)
    return result
""",
            "dead_dispatch": """\
import torch
import triton
import triton.language as tl

@triton.jit
def _kernel(x):
    pass

def launch(x):
    if False:
        _kernel[(1,)](x)
    return torch.empty_like(x)
""",
            "constant_framework_output": """\
import torch
import triton
import triton.language as tl

@triton.jit
def _kernel(x):
    pass

def launch(x):
    _kernel[(1,)](x)
    return torch.zeros_like(x)
""",
            "host_container_dos": """\
import triton
import triton.language as tl

@triton.jit
def _kernel(x):
    pass

def launch(x):
    junk = [0] * 1000000000
    _kernel[(1,)](x)
""",
            "host_bigint_dos": """\
import triton
import triton.language as tl

@triton.jit
def _kernel(x):
    pass

def launch(x):
    n = 2147483647
    n = n * n
    n = n * n
    _kernel[(1,)](x)
""",
        }
        with tempfile.TemporaryDirectory() as temporary_dir:
            for name, source in sources.items():
                with self.subTest(name=name):
                    path = Path(temporary_dir) / f"{name}.py"
                    path.write_text(source, encoding="utf-8")
                    arguments = ("x", "y") if name == "tensor_math" else ("x",)
                    errors = validate_candidate(
                        path,
                        50_000,
                        expected_launch_args=arguments,
                        entrypoint="launch",
                        allow_torch=True,
                        tensor_arguments=arguments,
                    )
                    self.assertTrue(errors)

        malicious_references = {
            "container": """\
import torch

def reference(x):
    junk = [0]
    boom = junk * 2147483647
    return x
""",
            "branch": """\
import torch

def reference(x):
    if x.numel() > 0:
        junk = [x]
    else:
        junk = x
    boom = junk * 2147483647
    return x
""",
            "cpu_transfer": """\
import torch

def reference(x):
    return x.to("cpu")
""",
        }
        with tempfile.TemporaryDirectory() as temporary_dir:
            for name, source in malicious_references.items():
                with self.subTest(reference=name):
                    path = Path(temporary_dir) / f"reference_{name}.py"
                    path.write_text(source, encoding="utf-8")
                    errors = validate_reference(
                        path,
                        50_000,
                        entrypoint="reference",
                        expected_arguments=("x",),
                    )
                    self.assertTrue(errors)

        malicious = """\
import triton
import triton.language as tl

@triton.jit
def _kernel(x):
    tl.device_print("x", x)

def launch(x, y, output, n_elements):
    _kernel[(1,)](x)
"""
        with tempfile.TemporaryDirectory() as temporary_dir:
            path = Path(temporary_dir) / "candidate.py"
            path.write_text(malicious, encoding="utf-8")
            errors = validate_candidate(
                path,
                50_000,
                expected_launch_args=task.launch_arguments,
                entrypoint=task.entrypoint,
                allow_torch=True,
            )
        self.assertTrue(any("kernel allowlist" in error for error in errors))
        self.assertEqual(
            validate_reference(
                FIXTURES / "reference.py",
                50_000,
                entrypoint=task.reference.entrypoint,
                expected_arguments=task.launch_arguments,
            ),
            [],
        )

    def test_evaluate_v2_uses_worker_reference_and_never_harness(self) -> None:
        result_json = json.dumps({"schemaVersion": 2, "status": "ok"})

        class CompletedProcess:
            pid = 4321
            returncode = 0
            stdout = io.BytesIO(result_json.encode("utf-8"))
            stderr = io.BytesIO()

            def wait(self, timeout=None):
                return 0

        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "secret", "PATH": "/bin"}, clear=True):
            with mock.patch("evaluate.subprocess.Popen", return_value=CompletedProcess()) as popen:
                result = evaluate(
                    FIXTURES / "task.json",
                    FIXTURES / "baseline.py",
                    reference_path=None,
                    harness_path=CHAPTER_DIR / "does-not-exist.py",
                )
        self.assertEqual(result["status"], "ok")
        command = popen.call_args.args[0]
        self.assertIn(str(CHAPTER_DIR / "worker.py"), command)
        self.assertIn("--reference", command)
        self.assertNotIn("--harness", command)
        self.assertNotIn("worker_harness.py", command)
        child_env = popen.call_args.kwargs["env"]
        self.assertNotIn("OPENAI_API_KEY", child_env)
        self.assertNotEqual(child_env["HOME"], os.environ.get("HOME"))
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertIn("hello-gpu-evaluator-", popen.call_args.kwargs["cwd"])

    def test_preflight_uses_correctness_only_worker_mode(self) -> None:
        result_json = json.dumps(
            {
                "schemaVersion": 2,
                "status": "ok",
                "latencyMs": None,
                "benchmark": None,
                "correctness": {"passed": True},
            }
        )

        class CompletedProcess:
            pid = 4321
            returncode = 0
            stdout = io.BytesIO(result_json.encode("utf-8"))
            stderr = io.BytesIO()

            def wait(self, timeout=None):
                return 0

        with mock.patch("evaluate.subprocess.Popen", return_value=CompletedProcess()) as popen:
            result = evaluate(
                FIXTURES / "task.json",
                FIXTURES / "baseline.py",
                correctness_only=True,
            )
        self.assertEqual(result["status"], "ok")
        command = popen.call_args.args[0]
        self.assertIn("--correctness-only", command)

    def test_evaluator_rejects_frozen_reference_hash_mismatch(self) -> None:
        payload = _base_payload(with_cost_model=True)
        payload["dimensions"] = {"rows": 4096, "cols": 2048}
        contract = {
            "dimensions": payload["dimensions"],
            "tensors": payload["tensors"],
            "launchArguments": payload["launchArguments"],
            "costModel": payload["costModel"],
        }
        contract_bytes = json.dumps(
            contract,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        payload["reference"] = {
            **payload["reference"],
            "selfCheckPassed": True,
            "preflightEvidence": {
                "algorithm": "sha256",
                "baselineSha256": hashlib.sha256(
                    (FIXTURES / "baseline.py").read_bytes()
                ).hexdigest(),
                "referenceSha256": "0" * 64,
                "contractSha256": hashlib.sha256(contract_bytes).hexdigest(),
            },
        }
        with tempfile.TemporaryDirectory() as temporary_dir:
            task_path = Path(temporary_dir) / "task.json"
            task_path.write_text(json.dumps(payload), encoding="utf-8")
            with mock.patch("evaluate.subprocess.Popen") as popen:
                result = evaluate(
                    task_path,
                    FIXTURES / "baseline.py",
                    reference_path=FIXTURES / "reference.py",
                )
        self.assertEqual(result["status"], "evaluator_error")
        self.assertIn("referenceSha256", result["details"])
        popen.assert_not_called()

    def test_normal_active_evaluation_requires_preflight_evidence(self) -> None:
        payload = _base_payload()
        payload["dimensions"] = {"rows": 4096, "cols": 2048}
        payload["reference"]["selfCheckPassed"] = False
        with tempfile.TemporaryDirectory() as temporary_dir:
            task_path = Path(temporary_dir) / "task.json"
            task_path.write_text(json.dumps(payload), encoding="utf-8")
            with mock.patch("evaluate.subprocess.Popen") as popen:
                result = evaluate(
                    task_path,
                    FIXTURES / "baseline.py",
                    reference_path=FIXTURES / "reference.py",
                )
        self.assertEqual(result["status"], "evaluator_error")
        self.assertIn("requires preflight evidence", result["details"])
        popen.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
