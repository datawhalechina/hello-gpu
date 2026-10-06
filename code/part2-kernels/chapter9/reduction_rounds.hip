// Controlled Chapter 9 rounds. Historical implementations remain separate.
#include <hip/hip_runtime.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <numeric>
#include <stdexcept>
#include <string>
#include <vector>

#define HIP_CHECK(call) do { hipError_t e = (call); if (e != hipSuccess) \
    throw std::runtime_error(hipGetErrorString(e)); } while (0)

namespace {
struct Args {
    std::string version = "partials", input = "random", samples, config_id;
    std::size_t size = 16777216;
    int block = 256, grid = 256, warmup = 10, repeat = 50, process = 1;
    uint32_t seed = 20260920;
};

// Both block-atomic and exclusive-partial kernels call this same tree.
__device__ float block_tree(float value, float* shared) {
    const unsigned t = threadIdx.x;
    shared[t] = value;
    __syncthreads();
    for (unsigned stride = blockDim.x / 2; stride > 0; stride >>= 1) {
        if (t < stride) shared[t] += shared[t + stride];
        __syncthreads();
    }
    return shared[0];
}

__global__ void reduction_element_atomic(const float* x, std::size_t n, float* out) {
    const std::size_t i = std::size_t(blockIdx.x) * blockDim.x + threadIdx.x;
    if (i < n) atomicAdd(out, x[i]);
}

__global__ void reduction_block_atomic(const float* x, std::size_t n, float* out) {
    extern __shared__ float shared[];
    const std::size_t i = std::size_t(blockIdx.x) * blockDim.x + threadIdx.x;
    const float sum = block_tree(i < n ? x[i] : 0.0f, shared);
    if (threadIdx.x == 0) atomicAdd(out, sum);
}

__global__ void reduction_partials(const float* x, std::size_t n, float* partials) {
    extern __shared__ float shared[];
    const std::size_t i = std::size_t(blockIdx.x) * blockDim.x + threadIdx.x;
    const float sum = block_tree(i < n ? x[i] : 0.0f, shared);
    if (threadIdx.x == 0) partials[blockIdx.x] = sum;
}

__device__ float local_accumulate(const float* x, std::size_t n) {
    float value = 0.0f;
    const std::size_t stride = std::size_t(gridDim.x) * blockDim.x;
    for (std::size_t i = std::size_t(blockIdx.x) * blockDim.x + threadIdx.x;
         i < n; i += stride) value += x[i];
    return value;
}

__global__ void reduction_local_lds(const float* x, std::size_t n, float* partials) {
    extern __shared__ float shared[];
    const float sum = block_tree(local_accumulate(x, n), shared);
    if (threadIdx.x == 0) partials[blockIdx.x] = sum;
}

__device__ float wave_sum(float value) {
    for (int offset = 16; offset > 0; offset >>= 1)
        value += __shfl_down(value, offset, 32);
    return value;
}

__global__ void reduction_local_wave(const float* x, std::size_t n, float* partials) {
    extern __shared__ float wave_sums[];
    const unsigned lane = threadIdx.x % 32, wave = threadIdx.x / 32;
    float value = wave_sum(local_accumulate(x, n));
    if (lane == 0) wave_sums[wave] = value;
    __syncthreads();
    if (wave == 0) {
        value = wave_sum(lane < blockDim.x / 32 ? wave_sums[lane] : 0.0f);
        if (lane == 0) partials[blockIdx.x] = value;
    }
}

// This final kernel and its one-block launch are identical for all staged HIP versions.
__global__ void reduction_final(const float* partials, std::size_t count, float* out) {
    extern __shared__ float shared[];
    float value = 0.0f;
    for (std::size_t i = threadIdx.x; i < count; i += blockDim.x) value += partials[i];
    const float sum = block_tree(value, shared);
    if (threadIdx.x == 0) out[0] = sum;
}

Args parse(int argc, char** argv) {
    Args a;
    for (int i = 1; i < argc; ++i) {
        std::string flag = argv[i];
        if (i + 1 == argc) throw std::runtime_error("missing value: " + flag);
        std::string value = argv[++i];
        if (flag == "--version") a.version = value;
        else if (flag == "--input") a.input = value;
        else if (flag == "--samples") a.samples = value;
        else if (flag == "--config-id") a.config_id = value;
        else {
            if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos)
                throw std::runtime_error("expected nonnegative integer: " + flag);
            const auto n = std::stoull(value);
            if (flag == "--size") a.size = n;
            else if (flag == "--seed" && n <= UINT32_MAX) a.seed = uint32_t(n);
            else if (n > 2147483647) throw std::runtime_error("integer too large");
            else if (flag == "--block") a.block = int(n);
            else if (flag == "--grid") a.grid = int(n);
            else if (flag == "--warmup") a.warmup = int(n);
            else if (flag == "--repeat") a.repeat = int(n);
            else if (flag == "--process") a.process = int(n);
            else throw std::runtime_error("unknown option: " + flag);
        }
    }
    const std::vector<std::string> versions = {"element-atomic", "block-atomic", "partials", "local-lds", "local-wave"};
    if (std::find(versions.begin(), versions.end(), a.version) == versions.end()) throw std::runtime_error("unknown version");
    if (a.input != "ones" && a.input != "weighted" && a.input != "random") throw std::runtime_error("unknown input");
    if (!a.size || a.size > 16777216 || a.block < 32 || a.block > 1024 || (a.block & (a.block - 1)) || a.grid <= 0 || a.repeat <= 0 || a.process <= 0)
        throw std::runtime_error("require 0<N<=2^24, power-of-two block32..1024, positive grid/repeat/process");
    if (a.config_id.empty()) a.config_id = "hip-" + a.version;
    if (a.config_id.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.") != std::string::npos)
        throw std::runtime_error("invalid config-id");
    return a;
}

float input_at(std::size_t i, const Args& a) {
    if (a.input == "ones") return 1.0f;
    if (a.input == "weighted") return float(int((i * 17 + (i / 251) * 7 + a.seed) % 31) - 15) / 32.0f;
    uint32_t q = uint32_t(i) ^ a.seed;
    q ^= q >> 16; q *= 0x7feb352dU; q ^= q >> 15; q *= 0x846ca68bU; q ^= q >> 16;
    return float(int(q % 33) - 16) / 32.0f;
}

void launch(const Args& a, unsigned grid, const float* x, float* partials, float* out) {
    const dim3 g(grid), b(a.block);
    const auto bytes = std::size_t(a.block) * sizeof(float);
    if (a.version == "element-atomic" || a.version == "block-atomic") {
        HIP_CHECK(hipMemsetAsync(out, 0, sizeof(float)));
        if (a.version == "element-atomic")
            hipLaunchKernelGGL(reduction_element_atomic, g, b, 0, 0, x, a.size, out);
        else hipLaunchKernelGGL(reduction_block_atomic, g, b, bytes, 0, x, a.size, out);
    } else {
        if (a.version == "partials") hipLaunchKernelGGL(reduction_partials, g, b, bytes, 0, x, a.size, partials);
        else if (a.version == "local-lds") hipLaunchKernelGGL(reduction_local_lds, g, b, bytes, 0, x, a.size, partials);
        else hipLaunchKernelGGL(reduction_local_wave, g, b, (a.block / 32) * sizeof(float), 0, x, a.size, partials);
        HIP_CHECK(hipGetLastError());
        hipLaunchKernelGGL(reduction_final, dim3(1), b, bytes, 0, partials, std::size_t(grid), out);
    }
    HIP_CHECK(hipGetLastError());
}

void check(const Args& a, unsigned grid, float* partials, float* out,
           const std::vector<double>& references, double reference) {
    float actual;
    HIP_CHECK(hipMemcpy(&actual, out, sizeof(float), hipMemcpyDeviceToHost));
    if (!std::isfinite(actual) || double(actual) != reference)
        throw std::runtime_error("final mismatch: got=" + std::to_string(actual) + " expected=" + std::to_string(reference));
    if (a.version == "element-atomic" || a.version == "block-atomic") return;
    std::vector<float> host(grid);
    HIP_CHECK(hipMemcpy(host.data(), partials, grid * sizeof(float), hipMemcpyDeviceToHost));
    for (unsigned i = 0; i < grid; ++i)
        if (!std::isfinite(host[i]) || double(host[i]) != references[i])
            throw std::runtime_error("partial mismatch at " + std::to_string(i));
}

int run(int argc, char** argv) {
    const Args a = parse(argc, argv);
    hipDeviceProp_t p{}; HIP_CHECK(hipGetDeviceProperties(&p, 0));
    if (p.warpSize != 32 || a.block > p.maxThreadsPerBlock) throw std::runtime_error("requires wave32 and supported block");
    const unsigned full = (a.size + a.block - 1) / a.block;
    const bool local = a.version == "local-lds" || a.version == "local-wave";
    const bool atomic = a.version == "element-atomic" || a.version == "block-atomic";
    const unsigned grid = local ? std::min(full, unsigned(a.grid)) : full;
    std::printf("ENV gpu=\"%s\" arch=%s wave_size=%d multi_processor_count=%d\n", p.name, p.gcnArchName, p.warpSize, p.multiProcessorCount);
    std::vector<float> host(a.size);
    std::vector<double> partial_ref(grid, 0.0);
    double reference = 0.0;
    for (std::size_t i = 0; i < a.size; ++i) {
        host[i] = input_at(i, a); reference += double(host[i]);
        partial_ref[(i / a.block) % grid] += double(host[i]);
    }
    if (double(float(reference)) != reference) throw std::runtime_error("input reference is outside exact FP32 checking range");
    float *x, *partials, *out;
    HIP_CHECK(hipMalloc(&x, a.size * sizeof(float))); HIP_CHECK(hipMalloc(&partials, grid * sizeof(float))); HIP_CHECK(hipMalloc(&out, sizeof(float)));
    HIP_CHECK(hipMemcpy(x, host.data(), a.size * sizeof(float), hipMemcpyHostToDevice));
    HIP_CHECK(hipMemset(partials, 0xFF, grid * sizeof(float))); HIP_CHECK(hipMemset(out, 0xFF, sizeof(float)));
    launch(a, grid, x, partials, out); HIP_CHECK(hipDeviceSynchronize());
    check(a, grid, partials, out, partial_ref, reference);
    for (int i = 0; i < a.warmup; ++i) launch(a, grid, x, partials, out);
    HIP_CHECK(hipDeviceSynchronize());
    std::vector<hipEvent_t> start(a.repeat), stop(a.repeat);
    for (int i = 0; i < a.repeat; ++i) { HIP_CHECK(hipEventCreate(&start[i])); HIP_CHECK(hipEventCreate(&stop[i])); }
    for (int i = 0; i < a.repeat; ++i) { HIP_CHECK(hipEventRecord(start[i])); launch(a, grid, x, partials, out); HIP_CHECK(hipEventRecord(stop[i])); }
    HIP_CHECK(hipDeviceSynchronize());
    check(a, grid, partials, out, partial_ref, reference);
    std::vector<float> times(a.repeat);
    for (int i = 0; i < a.repeat; ++i) { HIP_CHECK(hipEventElapsedTime(&times[i], start[i], stop[i])); HIP_CHECK(hipEventDestroy(start[i])); HIP_CHECK(hipEventDestroy(stop[i])); }
    if (!a.samples.empty()) {
        FILE* f = std::fopen(a.samples.c_str(), "w"); if (!f) throw std::runtime_error("cannot create samples");
        std::fprintf(f, "config_id,implementation,runtime,shape,dtype,block,grid,num_warps,input,warmup,repeat,seed,process,stages,scope,sample,ms\n");
        for (int i = 0; i < a.repeat; ++i) std::fprintf(f, "%s,hip-%s,hip,%zu,float32,%d,%u,0,%s,%d,%d,%u,%d,%d,gpu-event-full-operator,%d,%.12g\n", a.config_id.c_str(), a.version.c_str(), a.size, a.block, grid, a.input.c_str(), a.warmup, a.repeat, a.seed, a.process, atomic ? 1 : 2, i, times[i]);
        if (std::ferror(f)) { std::fclose(f); throw std::runtime_error("sample write failed"); }
        if (std::fclose(f)) throw std::runtime_error("sample close failed");
    }
    std::sort(times.begin(), times.end());
    const double median = times.size() % 2 ? times[times.size()/2] : (double(times[times.size()/2-1]) + times[times.size()/2]) / 2;
    std::printf("RESULT config_id=%s implementation=hip-%s runtime=hip shape=%zu dtype=float32 block=%d grid=%u num_warps=0 input=%s warmup=%d repeat=%d seed=%u stages=%d scope=gpu-event-full-operator correct=OK precheck=OK postcheck=OK partial_check=%s median_ms=%.9f result=%.9g reference=%.17g max_abs_error=0\n", a.config_id.c_str(), a.version.c_str(), a.size, a.block, grid, a.input.c_str(), a.warmup, a.repeat, a.seed, atomic ? 1 : 2, atomic ? "not-observable" : "OK", median, float(reference), reference);
    HIP_CHECK(hipFree(x)); HIP_CHECK(hipFree(partials)); HIP_CHECK(hipFree(out));
    return 0;
}
}
int main(int argc, char** argv) { try { return run(argc, argv); } catch (const std::exception& e) { std::fprintf(stderr, "ERROR: %s\n", e.what()); return 1; } }
