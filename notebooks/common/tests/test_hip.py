"""Behavior tests; GPU fixtures explicitly skip without a real ROCm device.

The small HIP fixture exercises the adapter contract independently of authored
chapters. Full notebook execution separately verifies the pedagogical source.
"""

from pathlib import Path
import re
from types import SimpleNamespace

import pytest
import torch

from hello_gpu.hip import HIPKernel, compile_kernel
from hello_gpu import hip
from hello_gpu.paths import artifact_root


SOURCE = r"""
__global__ void kernel(const float* a, const float* b, float* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = a[i] + b[i];
}
"""


@pytest.fixture(scope="module")
def kernels():
    if torch.version.hip is None or not torch.cuda.is_available():
        pytest.skip("requires ROCm PyTorch and a real GPU; GPU behavior was not exercised")
    return {"vector_add": compile_kernel("vector_add", SOURCE)}


@pytest.fixture
def add(kernels):
    return kernels["vector_add"]


@pytest.mark.parametrize(
    "size,block", [(0, 256), (1, 1), (257, 64), (4097, 256), (131073, 512)]
)
def test_tail_lengths_and_blocks(add, size, block):
    a = torch.randn(size, device="cuda")
    b = torch.randn_like(a)
    result = add(a, b, block=block)
    assert result.shape == a.shape
    assert result.dtype == a.dtype
    assert result.device == a.device
    torch.testing.assert_close(result, a + b, rtol=0, atol=0)


@pytest.mark.parametrize("shape", [(), (3, 17), (2, 3, 5)])
def test_dense_shapes_are_preserved(add, shape):
    a = torch.randn(shape, device="cuda")
    b = torch.randn_like(a)
    torch.testing.assert_close(add(a, b), a + b, rtol=0, atol=0)


def test_storage_offsets_and_preallocated_output(add):
    # Different, deliberately unaligned offsets must not trigger hidden copies.
    a_storage = torch.randn(4102, device="cuda")
    b_storage = torch.randn(4102, device="cuda")
    output_storage = torch.full((4102,), -123.0, device="cuda")
    a, b, out = a_storage[1:4098], b_storage[2:4099], output_storage[3:4100]
    assert a.is_contiguous() and b.is_contiguous() and out.is_contiguous()
    assert a.storage_offset() == 1 and b.storage_offset() == 2
    pointer = out.data_ptr()
    for _ in range(2):
        result = add(a, b, out=out, block=64)
        assert result.data_ptr() == pointer
        torch.testing.assert_close(result, a + b, rtol=0, atol=0)
    torch.testing.assert_close(output_storage[:3], torch.full_like(output_storage[:3], -123.0))
    torch.testing.assert_close(output_storage[4100:], torch.full_like(output_storage[4100:], -123.0))


@pytest.mark.parametrize(
    "kind,expected",
    [
        ("cpu", "ROCm GPU Tensor"),
        ("fp16", "float32"),
        ("noncontiguous", "contiguous"),
        ("mismatch", "same shape"),
        ("grad", "forward-only"),
    ],
)
def test_invalid_inputs_are_rejected(kernels, kind, expected):
    add = kernels["vector_add"]
    a = torch.randn((3, 5), device="cuda")
    b = torch.randn_like(a)
    if kind == "cpu":
        a = a.cpu()
    elif kind == "fp16":
        a = a.half()
    elif kind == "noncontiguous":
        a, b = a.t(), b.t()
    elif kind == "mismatch":
        b = b.reshape(15)
    elif kind == "grad":
        a.requires_grad_(True)
    with pytest.raises((ValueError, RuntimeError), match=expected):
        add(a, b)


@pytest.mark.parametrize("kind", ["same_a", "same_b", "partial", "shape", "fp16", "cpu", "grad"])
def test_output_validation(kernels, kind):
    storage = torch.randn(40, device="cuda")
    a, b = storage[:16], torch.randn(16, device="cuda")
    if kind == "same_a":
        out, expected = a, "overlap"
    elif kind == "same_b":
        out, expected = b, "overlap"
    elif kind == "partial":
        out, expected = storage[8:24], "overlap"
    elif kind == "shape":
        out, expected = torch.empty((4, 4), device="cuda"), "same shape"
    elif kind == "fp16":
        out, expected = torch.empty_like(a, dtype=torch.float16), "float32"
    elif kind == "cpu":
        out, expected = torch.empty_like(a, device="cpu"), "ROCm GPU Tensor"
    else:
        out, expected = torch.empty_like(a, requires_grad=True), "forward-only"
    with pytest.raises((ValueError, RuntimeError), match=expected):
        kernels["vector_add"](a, b, out=out)


@pytest.mark.parametrize("block", [0, -1, 2**31 - 1, 1.5, True])
def test_invalid_block_is_rejected(kernels, block):
    a = torch.ones(16, device="cuda")
    with pytest.raises((TypeError, ValueError, RuntimeError), match="block"):
        kernels["vector_add"](a, a, block=block)


def test_repeated_source_and_edited_source_have_separate_callable_and_torch_ops(kernels):
    original = kernels["vector_add"]
    repeated = compile_kernel("vector_add", original.source)
    assert repeated.cache_hit
    assert repeated.build_id == original.build_id
    assert repeated.module is original.module
    assert repeated.op is original.op
    assert original.op is getattr(getattr(torch.ops, original.module_name), "binary_f32").default

    edited_source, count = re.subn(r"a\[i\]\s*\+\s*b\[i\]", "a[i] - b[i]", original.source)
    assert count == 1, "Update this test if the notebook's baseline expression changes"
    edited = compile_kernel("vector_add", edited_source)
    assert edited.build_id != original.build_id
    assert edited.module is not original.module
    assert edited.op is not original.op
    assert edited.op._schema.name != original.op._schema.name

    a = torch.arange(257, device="cuda", dtype=torch.float32)
    b = torch.full_like(a, 3.0)
    for function in (original, repeated, original.op, repeated.op):
        torch.testing.assert_close(function(a, b, block=64), a + b, rtol=0, atol=0)
    for function in (edited, edited.op):
        torch.testing.assert_close(function(a, b, block=64), a - b, rtol=0, atol=0)


@pytest.mark.parametrize("entry", ["callable", "torch_ops", "prepared"])
def test_nondefault_stream_obeys_producer_and_consumer_dependencies(kernels, entry):
    add = kernels["vector_add"]
    operation = add.op if entry == "torch_ops" else add
    # Warm up custom-op registration and dispatch before creating the race window.
    warm = torch.ones(16, device="cuda")
    operation(warm, warm)
    default = torch.cuda.current_stream()
    side = torch.cuda.Stream()

    def chain(force_wrong_stream):
        a = torch.zeros(4097, device="cuda")
        b = torch.ones_like(a)
        prepared = add.prepare(a, b) if entry == "prepared" else None
        run = prepared if prepared is not None else lambda: operation(a, b)
        default.synchronize()  # Only setup; never synchronize globally inside the chain.
        producer_ready = torch.cuda.Event()
        consumer_done = torch.cuda.Event()
        with torch.cuda.stream(side):
            # A one-block GPU delay leaves other compute units free for a wrongly
            # default-stream launch. The negative control below verifies the window.
            torch.cuda._sleep(200_000_000)
            a.fill_(9.0)
            producer_ready.record()
            if force_wrong_stream:
                with torch.cuda.stream(default):
                    result = run()
                    wrong_done = torch.cuda.Event()
                    wrong_done.record()
                wrong_done.synchronize()
                race_exposed = not producer_ready.query()
            else:
                result = run()
                race_exposed = None
            observed = result.clone()  # A consumer on the same non-default stream.
            consumer_done.record()
        consumer_done.synchronize()
        return observed.cpu(), race_exposed

    wrong, race_exposed = chain(force_wrong_stream=True)
    assert race_exposed, "GPU delay did not expose a race; the stream test would be inconclusive"
    torch.testing.assert_close(wrong, torch.ones_like(wrong), rtol=0, atol=0)
    correct, _ = chain(force_wrong_stream=False)
    torch.testing.assert_close(correct, torch.full_like(correct, 10.0), rtol=0, atol=0)


def test_compiler_error_reports_kernel_location_and_allows_recovery(kernels):
    source = kernels["vector_add"].source
    broken = source + "\nthis is deliberately invalid HIP syntax;\n"
    with pytest.raises(RuntimeError) as captured:
        compile_kernel("recovery_demo", broken)
    diagnostic = str(captured.value)
    assert "HIP compilation failed" in diagnostic
    assert "notebook_kernel.hip" in diagnostic
    match = re.search(r"Full output: (.+build\.log)", diagnostic)
    assert match, diagnostic
    log = Path(match.group(1))
    assert log.is_file()
    assert "error:" in log.read_text().lower()

    # Use fresh valid source so this exercises a build after failure, not only
    # retrieving an already loaded module. Reusing the display name is intentional.
    recovered = compile_kernel("recovery_demo", source + "\n// Recovered after compiler error.\n")
    a = torch.arange(17, dtype=torch.float32, device="cuda")
    torch.testing.assert_close(recovered(a, a), a + a, rtol=0, atol=0)



def test_preparation_is_lazy_reuses_output_and_reads_updated_inputs(add):
    a = torch.arange(257, dtype=torch.float32, device="cuda")
    b = torch.full_like(a, 3.0)
    out = torch.full_like(a, -123.0)
    run = add.prepare(a, b, block=64, out=out)
    torch.testing.assert_close(out, torch.full_like(a, -123.0), rtol=0, atol=0)
    for delta in (0.0, 2.0):
        a.add_(delta)
        result = run()
        assert result.data_ptr() == out.data_ptr()
        torch.testing.assert_close(result, a + b, rtol=0, atol=0)


def test_prepared_call_rechecks_metadata_after_resize(add):
    a = torch.ones(16, device="cuda")
    b, out = torch.ones_like(a), torch.empty_like(a)
    run = add.prepare(a, b, out=out)
    out.resize_(8)
    with pytest.raises(RuntimeError, match="same shape"):
        run()


def test_preparation_rejects_invalid_output_without_running(add):
    a = torch.ones(16, device="cuda")
    with pytest.raises(RuntimeError, match="overlap"):
        add.prepare(a, a, out=a)
    torch.testing.assert_close(a, torch.ones_like(a), rtol=0, atol=0)


def test_compile_path_and_named_entry(add, tmp_path):
    source = tmp_path / "addition.hip"
    source.write_text(SOURCE)
    compiled = compile_kernel("from_file", source)
    assert compiled.module is add.module
    renamed = compile_kernel("vector_add", SOURCE.replace("void kernel(", "void vector_add("), entry="vector_add")
    a = torch.arange(257, dtype=torch.float32, device="cuda")
    torch.testing.assert_close(renamed(a, a), a + a, rtol=0, atol=0)


@pytest.mark.parametrize("option,value,expected", [
    ("name", "for", "identifier"),
    ("name", "bad-name", "identifier"),
    ("entry", "x); injected();", "identifier"),
    ("preset", "automatic", "binary_f32"),
    ("source", "", "empty"),
])
def test_compile_contract_errors_do_not_require_gpu(option, value, expected):
    options = {"name": "add", "source": SOURCE}
    options[option] = value
    with pytest.raises(ValueError, match=expected):
        compile_kernel(**options)


@pytest.mark.parametrize("entry", ["call", "prepare"])
def test_cpu_input_is_rejected_before_output_allocation(entry, monkeypatch, tmp_path):
    # A fake module must never be accessed: contract rejection precedes dispatch.
    kernel = HIPKernel("uncompiled", SOURCE, object(), "test", tmp_path, 0.0, False)
    operation = kernel if entry == "call" else kernel.prepare
    def must_not_allocate(*args, **kwargs):
        raise AssertionError("invalid inputs allocated an output")
    monkeypatch.setattr(torch, "empty_like", must_not_allocate)
    with pytest.raises(ValueError, match="ROCm GPU Tensor"):
        operation(torch.ones(3), torch.ones(3))


def test_artifacts_are_independent_of_working_directory(monkeypatch, tmp_path):
    before = artifact_root()
    monkeypatch.chdir(tmp_path)
    assert artifact_root() == before
    override = tmp_path / "generated"
    monkeypatch.setenv("HELLO_GPU_ARTIFACTS", str(override))
    assert artifact_root() == override
    monkeypatch.setenv("HELLO_GPU_ARTIFACTS", "relative")
    with pytest.raises(ValueError, match="absolute"):
        artifact_root()


def test_architecture_defaults_to_visible_gpu_and_override_is_explicit(monkeypatch):
    monkeypatch.delenv("PYTORCH_ROCM_ARCH", raising=False)
    monkeypatch.setattr(torch.cuda, "current_device", lambda: 0)
    monkeypatch.setattr(torch.cuda, "get_device_properties",
                        lambda device: SimpleNamespace(gcnArchName="gfx9999:sramecc-"))
    assert hip._target_architecture() == "gfx9999"
    monkeypatch.setenv("PYTORCH_ROCM_ARCH", "gfx1100;gfx1201")
    monkeypatch.setattr(torch.cuda, "current_device", lambda: pytest.fail("override need not query GPU"))
    assert hip._target_architecture() == "gfx1100;gfx1201"


@pytest.mark.parametrize("cap", [0, -1, 1.5, True, 2**31])
def test_invalid_grid_cap_rejected_before_compilation(cap):
    with pytest.raises((TypeError, ValueError), match="grid_limit"):
        compile_kernel("invalid_cap", SOURCE, grid_limit=cap)


def test_grid_cap_controls_launch_and_prepared_calls(kernels):
    source = r"""
__global__ void kernel(const float* a, const float* b, float* out, int n) {
    for (int i = blockIdx.x * blockDim.x + threadIdx.x;
         i < n; i += blockDim.x * gridDim.x) {
        out[i] = a[i] + b[i] + gridDim.x;
    }
}
"""
    limited = compile_kernel("grid_probe", source, grid_limit=2)
    full = compile_kernel("grid_probe", source)
    assert limited.build_id != full.build_id
    a = torch.arange(1025, dtype=torch.float32, device="cuda")
    b, out = torch.ones_like(a), torch.empty_like(a)
    for fn, blocks in ((lambda: limited(a, b), 2),
                       (limited.prepare(a, b, grid_limit=1, out=out), 1),
                       (lambda: limited.op(a, b, grid_limit=3), 3),
                       (lambda: full(a, b), 5)):
        torch.testing.assert_close(fn(), a + b + blocks, rtol=0, atol=0)
