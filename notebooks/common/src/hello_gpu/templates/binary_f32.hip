

#line 1 "hello_gpu_generated_wrapper"
namespace {
void check_tensor(const torch::Tensor& t, const char* name) {
    TORCH_CHECK(t.is_cuda(), name, " must be a ROCm GPU Tensor");
    TORCH_CHECK(t.scalar_type() == torch::kFloat32, name, " must have dtype torch.float32");
    TORCH_CHECK(t.layout() == torch::kStrided && t.is_contiguous(),
                name, " must be a contiguous strided Tensor");
    TORCH_CHECK(!t.requires_grad(), name, " must not require gradients: this adapter is forward-only");
    TORCH_CHECK(!t.is_neg() && !t.is_conj(), name, " must not have unresolved view bits");
}
bool overlaps(const torch::Tensor& a, const torch::Tensor& b) {
    if (a.numel() == 0 || b.numel() == 0) return false;
    const auto x = reinterpret_cast<uintptr_t>(a.data_ptr<float>());
    const auto y = reinterpret_cast<uintptr_t>(b.data_ptr<float>());
    const auto nx = static_cast<uintptr_t>(a.numel()) * sizeof(float);
    const auto ny = static_cast<uintptr_t>(b.numel()) * sizeof(float);
    return x < y + ny && y < x + nx;
}
}

void validate(torch::Tensor a, torch::Tensor b, torch::Tensor out, int64_t block, int64_t grid_limit) {
    check_tensor(a, "a");
    check_tensor(b, "b");
    check_tensor(out, "out");
    TORCH_CHECK(a.device() == b.device() && a.device() == out.device(),
                "a, b and out must be on the same GPU");
    TORCH_CHECK(a.sizes() == b.sizes() && a.sizes() == out.sizes(),
                "a, b and out must have the same shape");
    TORCH_CHECK(a.numel() <= std::numeric_limits<int>::max(), "n exceeds the int32 kernel ABI");
    TORCH_CHECK(!overlaps(out, a) && !overlaps(out, b), "out must not overlap either input");

    TORCH_CHECK(grid_limit >= 0 && grid_limit <= std::numeric_limits<int>::max(),
                "grid_limit must be zero (full grid) or a positive int32");
    // ROCm PyTorch keeps the public CUDA namespace in HIPGuard.h.
    const c10::cuda::CUDAGuard guard(a.device());
    int max_threads = 0;
    auto status = hipDeviceGetAttribute(&max_threads, hipDeviceAttributeMaxThreadsPerBlock,
                                        a.get_device());
    TORCH_CHECK(status == hipSuccess, "Cannot query HIP device: ", hipGetErrorString(status));
    TORCH_CHECK(block > 0 && block <= max_threads,
                "block must be between 1 and ", max_threads, " on this GPU");
}

torch::Tensor launch(torch::Tensor a, torch::Tensor b, torch::Tensor out, int64_t block, int64_t grid_limit) {
    // Recheck tensor metadata because callers may resize/rebind tensors after prepare().
    validate(a, b, out, block, grid_limit);
    const c10::cuda::CUDAGuard guard(a.device());
    const int n = static_cast<int>(a.numel());
    if (n == 0) return out;
    const auto stream = c10::hip::getCurrentHIPStream(a.get_device()).stream();
    const auto full_grid = (a.numel() + block - 1) / block;
    const unsigned int grid = static_cast<unsigned int>(
        grid_limit > 0 && grid_limit < full_grid ? grid_limit : full_grid);
    hipLaunchKernelGGL(__HELLO_GPU_KERNEL_ENTRY__, dim3(grid), dim3(static_cast<unsigned int>(block)), 0, stream,
                       a.data_ptr<float>(), b.data_ptr<float>(), out.data_ptr<float>(), n);
    const auto status = hipGetLastError();
    TORCH_CHECK(status == hipSuccess, "HIP kernel launch failed: ", hipGetErrorString(status));
    return out;
}
